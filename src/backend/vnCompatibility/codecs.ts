import { spawn } from 'child_process'
import { createHash } from 'crypto'
import { chmod } from 'fs/promises'
import { dirname, join } from 'path'
import { existsSync, mkdirSync, readFileSync, rmSync } from 'graceful-fs'

import { toolsPath } from 'backend/constants/paths'
import { isLinux } from 'backend/constants/environment'
import { GlobalConfig } from 'backend/config'
import { sendFrontendMessage } from 'backend/ipc'
import { logError, logInfo, LogPrefix } from 'backend/logger'
import {
  setupEnvVars,
  setupWineEnvVars,
  verifyWinePrefix
} from 'backend/launcher'
import { libraryManagerMap } from 'backend/storeManagers'
import { sendGameStatusUpdate } from 'backend/utils'
import {
  DAYS,
  downloadFile as downloadFileInet
} from 'backend/utils/inet/downloader'
import type { GameSettings, Runner, WineInstallation } from 'common/types'
import type {
  VnCompatibilityCodecInstallArgs,
  VnCompatibilityCodecInstallResult
} from 'common/types/vnCompatibility'
import {
  getManagedPrefixMetadata,
  isDefaultWinePrefixPath,
  recordInstalledSpecialCodecs
} from './prefixes'

const codecScriptCommit = '26d04af32f7e97e43f49b778397471cfc1c57b48'
const codecScriptHash =
  'c95f0d8ab0c0695cc7cb729cfd98c6336bf6523c7f313553fb1e3e05b2184a17'
const codecScriptUrl = `https://raw.githubusercontent.com/b-fission/vn_winestuff/${codecScriptCommit}/codec.sh`
const codecToolPath = join(toolsPath, 'vn_winestuff')
const codecScriptPath = join(codecToolPath, 'codec.sh')
const supportedCodecs = new Set([
  'lavfilters',
  'mciqtz32',
  'mf',
  'quartz2',
  'quartz_dx',
  'wmp11',
  'xaudio29'
])
let codecInstallActive = false

function getFileHash(path: string): string {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

async function getCodecScript(): Promise<string> {
  if (
    existsSync(codecScriptPath) &&
    getFileHash(codecScriptPath) !== codecScriptHash
  ) {
    rmSync(codecScriptPath)
  }

  if (!existsSync(codecScriptPath)) {
    mkdirSync(codecToolPath, { recursive: true })
    await downloadFileInet(codecScriptUrl, {
      writeToFile: codecScriptPath,
      maxCache: 3650 * DAYS,
      axiosConfig: { responseType: 'text' }
    })
  }

  if (
    !existsSync(codecScriptPath) ||
    getFileHash(codecScriptPath) !== codecScriptHash
  ) {
    throw new Error('The Special Codecs helper failed its integrity check')
  }

  await chmod(codecScriptPath, 0o755)
  return codecScriptPath
}

function getRequestedCodecs(codecs: string[]): string[] {
  const uniqueCodecs = [...new Set(codecs)]
  if (
    uniqueCodecs.length === 0 ||
    uniqueCodecs.some((codec) => !supportedCodecs.has(codec))
  ) {
    throw new Error('The requested Special Codecs recipe is not supported')
  }
  return uniqueCodecs
}

function getWineContext(
  winePrefix: string,
  wineVersion: Pick<WineInstallation, 'bin' | 'type'>
): { winePrefix: string; wineBin: string } {
  if (wineVersion.type === 'wine') {
    return { winePrefix, wineBin: wineVersion.bin }
  }

  if (wineVersion.type === 'proton') {
    const protonBaseDir = dirname(wineVersion.bin)
    for (const distribution of ['files', 'dist']) {
      const wineBin = join(protonBaseDir, distribution, 'bin', 'wine')
      if (existsSync(wineBin)) {
        return { winePrefix: join(winePrefix, 'pfx'), wineBin }
      }
    }
  }

  throw new Error('Heroic could not resolve a Wine executable for this game')
}

function runCodecScript({
  appName,
  runner,
  codecs,
  scriptPath,
  winePrefix,
  wineBin,
  gameSettings
}: {
  appName: string
  runner: Runner
  codecs: string[]
  scriptPath: string
  winePrefix: string
  wineBin: string
  gameSettings: GameSettings
}): Promise<VnCompatibilityCodecInstallResult> {
  const settingsWithWineVersion = {
    ...gameSettings,
    wineVersion: {
      ...gameSettings.wineVersion,
      bin: wineBin,
      type: 'wine' as const
    }
  }
  const winePath = dirname(wineBin)
  const env = {
    ...process.env,
    ...setupEnvVars(settingsWithWineVersion),
    ...setupWineEnvVars(settingsWithWineVersion, appName),
    PATH: `${winePath}:${process.env.PATH}`,
    WINE: wineBin,
    WINE64: wineBin,
    WINEPREFIX: winePrefix
  }
  const messages: string[] = []
  const sendProgress = (chunk: string) => {
    const nextMessages = chunk
      .split(/\r?\n/)
      .map((message) => message.trimEnd())
      .filter(Boolean)
    if (nextMessages.length === 0) return
    messages.push(...nextMessages)
    sendFrontendMessage('vnCompatibility.codecProgress', {
      appName,
      runner,
      messages: nextMessages
    })
  }

  return new Promise((resolve) => {
    let settled = false
    const finish = (result: VnCompatibilityCodecInstallResult) => {
      if (settled) return
      settled = true
      resolve(result)
    }
    const child = spawn('bash', [scriptPath, ...codecs], { env })

    child.stdout.setEncoding('utf8')
    child.stdout.on('data', sendProgress)
    child.stderr.setEncoding('utf8')
    child.stderr.on('data', sendProgress)
    child.on('error', (error) =>
      finish({ status: 'error', error: String(error) })
    )
    child.on('close', (code) => {
      const output = messages.join('\n')
      const reportedFailure =
        /cannot continue|some kind of error occurred|hash mismatch|invalid verb|duplicated verb|does not appear to exist|please run\s+wineboot|there is no usable wine executable|error occurred while downloading/i.test(
          output
        )
      if (code === 0 && !reportedFailure) {
        finish({ status: 'done' })
      } else {
        finish({
          status: 'error',
          error: `Special Codecs exited with code ${code ?? 'unknown'}`
        })
      }
    })
  })
}

export async function installSpecialCodecs({
  appName,
  runner,
  codecs
}: VnCompatibilityCodecInstallArgs): Promise<VnCompatibilityCodecInstallResult> {
  if (!isLinux) {
    return { status: 'error', error: 'Special Codecs requires Linux' }
  }

  if (codecInstallActive) {
    return {
      status: 'error',
      error: 'A Special Codecs installation is already running'
    }
  }

  codecInstallActive = true
  sendGameStatusUpdate({ appName, runner, status: 'winetricks' })
  try {
    const requestedCodecs = getRequestedCodecs(codecs)
    sendFrontendMessage('vnCompatibility.codecProgress', {
      appName,
      runner,
      messages: ['Preparing the commit-pinned Special Codecs helper…']
    })
    const scriptPath = await getCodecScript()
    const gameSettings = await libraryManagerMap[runner]
      .getGame(appName)
      .getSettings()
    const { sharedWinePrefix, winePrefix: defaultWinePrefix } =
      GlobalConfig.get().getSettings()
    const configuredPrefixes = [sharedWinePrefix, defaultWinePrefix].filter(
      Boolean
    )
    if (
      !gameSettings.winePrefix ||
      isDefaultWinePrefixPath(gameSettings.winePrefix, configuredPrefixes)
    ) {
      throw new Error(
        'Choose a dedicated Wine prefix for this game before installing codecs'
      )
    }
    const managedPrefix = getManagedPrefixMetadata(gameSettings.winePrefix)
    const missingCodecs = managedPrefix
      ? requestedCodecs.filter(
          (codec) => !managedPrefix.installedSpecialCodecs.includes(codec)
        )
      : requestedCodecs
    if (missingCodecs.length === 0) {
      sendFrontendMessage('vnCompatibility.codecProgress', {
        appName,
        runner,
        messages: ['This recipe prefix already has the requested codecs.']
      })
      return { status: 'done' }
    }
    const { res: prefixResult } = await verifyWinePrefix(gameSettings)
    if (prefixResult.abort || prefixResult.error) {
      throw new Error(
        prefixResult.error || 'Wine prefix initialization was cancelled'
      )
    }
    const { winePrefix, wineBin } = getWineContext(
      gameSettings.winePrefix,
      gameSettings.wineVersion
    )

    logInfo(
      [`Installing VNWiki Special Codecs for ${appName}:`, requestedCodecs],
      LogPrefix.WineTricks
    )
    const result = await runCodecScript({
      appName,
      runner,
      codecs: missingCodecs,
      scriptPath,
      winePrefix,
      wineBin,
      gameSettings
    })
    if (result.status === 'done') {
      recordInstalledSpecialCodecs(gameSettings.winePrefix, missingCodecs)
    }
    return result
  } catch (error) {
    logError(
      ['Special Codecs installation failed:', error],
      LogPrefix.WineTricks
    )
    return { status: 'error', error: String(error) }
  } finally {
    codecInstallActive = false
    sendGameStatusUpdate({ appName, runner, status: 'done' })
  }
}
