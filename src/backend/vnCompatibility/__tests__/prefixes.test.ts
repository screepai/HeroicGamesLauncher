const validWineMock = jest.fn()
const verifyWinePrefixMock = jest.fn()
const getSettingsMock = jest.fn()
const getGameInfoMock = jest.fn()
const writeConfigMock = jest.fn()
const sendGameStatusUpdateMock = jest.fn()
const existsSyncMock = jest.fn<boolean, [string]>()
const readFileSyncMock = jest.fn<string, [string, string?]>()
const renameSyncMock = jest.fn<void, [string, string]>()
const writeFileSyncMock = jest.fn<void, [string, string]>()

jest.mock('backend/config', () => ({
  GlobalConfig: {
    get: () => ({
      getSettings: () => ({
        defaultWinePrefixDir: '/prefixes',
        sharedWinePrefix: '/prefixes/shared',
        winePrefix: '/prefixes/default'
      })
    })
  }
}))
jest.mock('backend/constants/environment', () => ({ isLinux: true }))
jest.mock('backend/constants/paths', () => ({ userHome: '/home/test' }))
jest.mock('graceful-fs', () => ({
  existsSync: existsSyncMock,
  readFileSync: readFileSyncMock,
  renameSync: renameSyncMock,
  writeFileSync: writeFileSyncMock
}))
jest.mock('backend/launcher', () => ({
  validWine: validWineMock,
  verifyWinePrefix: verifyWinePrefixMock
}))
jest.mock('backend/logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  LogPrefix: { WineTricks: 'Winetricks' }
}))
jest.mock('backend/storeManagers', () => ({
  libraryManagerMap: {
    legendary: {
      getGame: () => ({
        getGameInfo: getGameInfoMock,
        getSettings: getSettingsMock
      })
    }
  }
}))
jest.mock('backend/utils', () => ({
  removeSpecialcharacters: (value: string) =>
    value.replace(/[:/\\*?<>|&{}%$@`!™+'"®]/gi, ''),
  sendGameStatusUpdate: sendGameStatusUpdateMock,
  writeConfig: writeConfigMock
}))

import {
  createDedicatedPrefix,
  getDedicatedPrefixPath,
  getRecipePrefixPath,
  normalizeWinePrefixPath
} from '../prefixes'
import { isWindowsPlatform } from 'common/utils'

const gameSettings = {
  enviromentOptions: [],
  winePrefix: '/prefixes/shared',
  wineVersion: { type: 'wine', bin: '/usr/bin/wine' }
}

beforeEach(() => {
  jest.clearAllMocks()
  existsSyncMock.mockReturnValue(false)
  getGameInfoMock.mockReturnValue({
    app_name: 'test-game',
    title: 'Test: Game',
    runner: 'legendary',
    is_installed: true,
    install: { platform: 'Windows' }
  })
  getSettingsMock.mockResolvedValue(gameSettings)
  validWineMock.mockResolvedValue(true)
  verifyWinePrefixMock.mockResolvedValue({
    res: { stdout: '', stderr: '' }
  })
})

describe('getDedicatedPrefixPath', () => {
  it('creates a sanitized path inside the configured prefix folder', () => {
    expect(getDedicatedPrefixPath('/prefixes', 'Test: Game', 'test-game')).toBe(
      '/prefixes/Test Game'
    )
  })

  it('falls back to the app name when the title is unsafe', () => {
    expect(getDedicatedPrefixPath('/prefixes', '..', 'test-game')).toBe(
      '/prefixes/test-game'
    )
  })

  it('places shared recipes under a stable managed folder', () => {
    expect(getRecipePrefixPath('/prefixes', 'WMP11 + Quartz')).toBe(
      '/prefixes/recipes/wmp11-quartz'
    )
  })
})

describe('Wine prefix policies', () => {
  it('normalizes home-relative and trailing-slash prefix paths', () => {
    expect(normalizeWinePrefixPath('~/Prefixes/shared/')).toBe(
      '/home/test/Prefixes/shared'
    )
  })

  it.each(['Windows', 'windows', 'win32'])(
    'recognizes %s games',
    (platform) => {
      expect(isWindowsPlatform(platform)).toBe(true)
    }
  )

  it('does not classify Linux games as Windows games', () => {
    expect(isWindowsPlatform('linux')).toBe(false)
  })
})

describe('createDedicatedPrefix', () => {
  it('initializes the prefix before persisting it', async () => {
    await expect(
      createDedicatedPrefix({ appName: 'test-game', runner: 'legendary' })
    ).resolves.toEqual({
      status: 'done',
      winePrefix: '/prefixes/Test Game'
    })

    expect(verifyWinePrefixMock).toHaveBeenCalledWith({
      ...gameSettings,
      enviromentOptions: [
        { key: 'WINEDLLOVERRIDES', value: 'mscoree,mshtml=' }
      ],
      winePrefix: '/prefixes/Test Game'
    })
    expect(writeConfigMock).toHaveBeenCalledWith('test-game', {
      ...gameSettings,
      winePrefix: '/prefixes/Test Game'
    })
    expect(verifyWinePrefixMock.mock.invocationCallOrder[0]).toBeLessThan(
      writeConfigMock.mock.invocationCallOrder[0]
    )
  })

  it('does not change the game config when initialization fails', async () => {
    verifyWinePrefixMock.mockResolvedValue({
      res: { stdout: '', stderr: 'failed', error: 'wineboot failed' }
    })

    await expect(
      createDedicatedPrefix({ appName: 'test-game', runner: 'legendary' })
    ).resolves.toEqual({
      status: 'error',
      error: 'Error: wineboot failed'
    })

    expect(writeConfigMock).not.toHaveBeenCalled()
  })

  it('creates 32-bit recipe prefixes with the requested architecture', async () => {
    await createDedicatedPrefix({
      appName: 'test-game',
      runner: 'legendary',
      recipe: {
        name: 'wmp10quartz',
        architecture: '32-bit',
        specialCodecs: ['quartz2'],
        winetricks: ['wmp10']
      }
    })

    expect(verifyWinePrefixMock).toHaveBeenCalledWith({
      ...gameSettings,
      enviromentOptions: [
        { key: 'WINEDLLOVERRIDES', value: 'mscoree,mshtml=' },
        { key: 'WINEARCH', value: 'win32' }
      ],
      winePrefix: '/prefixes/recipes/wmp10quartz'
    })
    expect(JSON.parse(writeFileSyncMock.mock.calls[0][1])).toEqual({
      version: 1,
      kind: 'recipe',
      recipe: {
        name: 'wmp10quartz',
        architecture: '32-bit',
        specialCodecs: ['quartz2'],
        winetricks: ['wmp10']
      },
      installedSpecialCodecs: []
    })
  })

  it('rejects an architecture change for an existing recipe prefix', async () => {
    existsSyncMock.mockImplementation((path: string) =>
      path.endsWith('.heroic-prefix.json')
    )
    readFileSyncMock.mockReturnValue(
      JSON.stringify({
        version: 1,
        kind: 'recipe',
        recipe: {
          name: 'wmp10quartz',
          architecture: '64-bit',
          specialCodecs: ['quartz2'],
          winetricks: ['wmp10']
        },
        attachedGames: [],
        installedSpecialCodecs: []
      })
    )

    await expect(
      createDedicatedPrefix({
        appName: 'test-game',
        runner: 'legendary',
        recipe: {
          name: 'wmp10quartz',
          architecture: '32-bit',
          specialCodecs: ['quartz2'],
          winetricks: ['wmp10']
        }
      })
    ).resolves.toEqual({
      status: 'error',
      error: 'Error: The existing managed prefix uses an incompatible recipe'
    })

    expect(verifyWinePrefixMock).not.toHaveBeenCalled()
    expect(writeConfigMock).not.toHaveBeenCalled()
  })
})
