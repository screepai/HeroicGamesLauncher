import {
  ExecResult,
  ExtraInfo,
  GameInfo,
  GameSettings,
  LaunchOption
} from 'common/types'
import { libraryStore } from './electronStores'
import { GameConfig } from '../../game_config'
import {
  getMigratedExecutablePath,
  killPattern,
  moveOnUnix,
  moveOnWindows,
  sendGameStatusUpdate,
  shutdownWine
} from '../../utils'
import { logInfo, LogPrefix, logWarning } from 'backend/logger'
import { dirname } from 'path'
import { existsSync, rmSync } from 'graceful-fs'
import i18next from 'i18next'
import {
  addShortcuts as addShortcutsUtil,
  removeShortcuts as removeShortcutsUtil
} from '../../shortcuts/shortcuts/shortcuts'
import { notify } from '../../dialog/dialog'
import { launchGame } from 'backend/storeManagers/storeManagerCommon/games'
import { Game, InstallResult, RemoveArgs } from 'common/types/game_manager'
import { removePrefix } from 'backend/utils/uninstaller'
import { removeRecentGame } from 'backend/recent_games/recent_games'
import { isLinux, isMac, isWindows } from 'backend/constants/environment'
import { removeNonSteamGame } from 'backend/shortcuts/nonesteamgame/nonesteamgame'
import { getExecutableDir } from './pathStyle'
import { getUnsafeGameFolderReason } from './safeFolders'

import type LogWriter from 'backend/logger/log_writer'

export default class SideloadGame implements Game {
  private readonly id: string

  constructor(id: string) {
    this.id = id
  }

  getGameInfo(): GameInfo {
    const store = libraryStore.get('games', [])
    const info = store.find((app) => app.app_name === this.id)
    if (!info) {
      // @ts-expect-error TODO: As with LegendaryGame and GOGGame, handle this properly
      return {}
    }
    return info
  }

  async getSettings(): Promise<GameSettings> {
    return (
      GameConfig.get(this.id).config ||
      (await GameConfig.get(this.id).getSettings())
    )
  }

  async addShortcuts(fromMenu?: boolean): Promise<void> {
    return addShortcutsUtil(this, fromMenu)
  }

  async removeShortcuts(): Promise<void> {
    return removeShortcutsUtil(this)
  }

  async isGameAvailable(): Promise<boolean> {
    return new Promise((resolve) => {
      const { install } = this.getGameInfo()

      if (install && install.platform === 'Browser') {
        resolve(true)
      }

      if (install && install.executable) {
        resolve(existsSync(install.executable))
      }
    })
  }

  async launch(
    logWriter: LogWriter,
    launchArguments?: LaunchOption,
    args: string[] = []
  ): Promise<boolean> {
    return launchGame(this, logWriter, args)
  }

  async stop(): Promise<void> {
    const {
      install: { executable = undefined }
    } = this.getGameInfo()

    if (executable) {
      const split = executable.split('/')
      const exe = split[split.length - 1]
      killPattern(exe)

      if (!this.isNative()) {
        const gameSettings = await this.getSettings()
        shutdownWine(gameSettings)
      }
    }
  }

  async uninstall({
    shouldRemovePrefix,
    deleteFiles = false
  }: RemoveArgs): Promise<ExecResult> {
    sendGameStatusUpdate({
      appName: this.id,
      runner: 'sideload',
      status: 'uninstalling'
    })

    const old = libraryStore.get('games', [])
    const current = old.filter((a: GameInfo) => a.app_name !== this.id)

    const gameInfo = this.getGameInfo()
    const {
      title,
      install: { executable }
    } = gameInfo

    if (shouldRemovePrefix) {
      removePrefix(this.id, 'sideload')
    }
    libraryStore.set('games', current)

    let keptFolder: string | undefined
    if (deleteFiles && executable !== undefined) {
      const gameFolder = dirname(executable)
      const unsafeReason = getUnsafeGameFolderReason(gameFolder)
      if (unsafeReason) {
        // The executable does not sit in a folder of its own, so removing
        // "its folder" would take unrelated files (or a whole drive) with it.
        keptFolder = gameFolder
        logWarning(
          `Not deleting the files of ${title}: ${unsafeReason}`,
          LogPrefix.Backend
        )
      } else if (existsSync(gameFolder)) {
        rmSync(gameFolder, { recursive: true })
      }
    }

    notify({
      title,
      body: keptFolder
        ? i18next.t('notify.uninstalled-files-kept', {
            defaultValue:
              'Removed from Heroic. Its files were not deleted because {{folder}} is not a game-only folder.',
            folder: keptFolder
          })
        : i18next.t('notify.uninstalled')
    })

    removeShortcutsUtil(this)
    removeRecentGame(this.id)
    removeNonSteamGame(this)

    sendGameStatusUpdate({
      appName: this.id,
      runner: 'sideload',
      status: 'done'
    })

    logInfo('finished uninstalling', LogPrefix.Backend)
    return { stderr: '', stdout: '' }
  }

  isNative(): boolean {
    const {
      install: { platform }
    } = this.getGameInfo()
    if (platform) {
      if (platform === 'Browser') {
        return true
      }

      if (isWindows) {
        return true
      }

      if (isMac && platform === 'Mac') {
        return true
      }

      // small hack, but needs to fix the typings
      const plat = platform.toLowerCase()
      if (isLinux && plat === 'linux') {
        return true
      }
    }

    return false
  }

  async getExtraInfo(): Promise<ExtraInfo> {
    logWarning(
      `getExtraInfo not implemented on Sideload Game Manager. called for ID = ${this.id}`
    )
    return {
      about: {
        description: '',
        shortDescription: ''
      },
      reqs: [],
      storeUrl: ''
    }
  }

  onInstallOrUpdateOutput() {
    logWarning(
      `onInstallOrUpdateOutput not implemented on Sideload Game Manager. called for ID = ${this.id}`
    )
  }

  async moveInstall(newInstallPath: string): Promise<InstallResult> {
    const gameInfo = this.getGameInfo()
    const installPath =
      gameInfo.install.install_path ||
      gameInfo.folder_name ||
      (gameInfo.install.executable
        ? getExecutableDir(gameInfo.install.executable)
        : undefined)

    if (!installPath) {
      return { status: 'error', error: 'No install path found' }
    }

    const unsafeReason = getUnsafeGameFolderReason(installPath)
    if (unsafeReason) {
      return {
        status: 'error',
        error: `Cannot move this game's folder: ${unsafeReason}. Move the game into a folder of its own first.`
      }
    }

    const moveImpl = isWindows ? moveOnWindows : moveOnUnix
    const moveResult = await moveImpl(newInstallPath, {
      ...gameInfo,
      install: {
        ...gameInfo.install,
        install_path: installPath
      }
    })

    if (moveResult.status === 'error') {
      return moveResult
    }

    const current = libraryStore.get('games', [])
    const gameIndex = current.findIndex((game) => game.app_name === this.id)
    if (gameIndex === -1) {
      return { status: 'done' }
    }

    current[gameIndex] = {
      ...current[gameIndex],
      folder_name: moveResult.installPath,
      install: {
        ...current[gameIndex].install,
        executable: getMigratedExecutablePath(
          current[gameIndex].install.executable,
          installPath,
          moveResult.installPath
        ),
        install_path: moveResult.installPath
      }
    }
    libraryStore.set('games', current)

    return { status: 'done' }
  }

  async repair(): Promise<ExecResult> {
    logWarning(
      `repair not implemented on Sideload Game Manager. called for ID = ${this.id}`
    )
    return { stderr: '', stdout: '' }
  }

  async syncSaves(): Promise<string> {
    logWarning(
      `syncSaves not implemented on Sideload Game Manager. called for ID = ${this.id}`
    )
    return ''
  }

  async forceUninstall(): Promise<void> {
    logWarning(
      `forceUninstall not implemented on Sideload Game Manager. called for ID = ${this.id}`
    )
  }

  async install(): Promise<InstallResult> {
    logWarning(
      `install not implemented on Sideload Game Manager. called for ID = ${this.id}`
    )
    return { status: 'error' }
  }

  async importGame(): Promise<ExecResult> {
    return { stderr: '', stdout: '' }
  }

  async update(): Promise<{ status: 'done' | 'error' }> {
    return { status: 'error' }
  }
}
