const mockLibraryStoreGet = jest.fn()
const mockLibraryStoreSet = jest.fn()
const mockAddShortcuts = jest.fn()
const mockSendFrontendMessage = jest.fn()
const mockGetAllGameOverrides = jest.fn()
const mockSetGameOverrides = jest.fn()
const mockVndbMatchesStoreGet = jest.fn()
const mockVndbMatchesStoreSet = jest.fn()
const mockGetDecryptedApiToken = jest.fn()
const mockSetStoredApiToken = jest.fn()
const mockGetSettings = jest.fn()
const mockSetSetting = jest.fn()
const mockGlobalConfigGet = jest.fn()
const mockConfigStoreGet = jest.fn()
const mockConfigStoreSet = jest.fn()
const mockTimestampStoreSet = jest.fn()
const mockTimestampStoreDelete = jest.fn()
const mockLogError = jest.fn()
const mockWriteConfig = jest.fn()
let mockTimestampStoreRawStore: Record<string, unknown> = {}
let mockGamesConfigPath = ''
const mockEnvironment = {
  isLinux: false,
  isMac: false,
  isWindows: true
}
const mockSideloadGame = jest.fn().mockImplementation((id: string) => ({ id }))
const mockGetMigratedExecutablePath = jest.fn(
  (
    executable: string | undefined,
    oldPath: string | undefined,
    newPath: string
  ) => executable?.replace(oldPath ?? '', newPath)
)

jest.mock('../electronStores', () => ({
  libraryStore: {
    get: mockLibraryStoreGet,
    set: mockLibraryStoreSet
  }
}))
jest.mock('backend/shortcuts/shortcuts/shortcuts', () => ({
  addShortcuts: mockAddShortcuts
}))
jest.mock('backend/ipc', () => ({
  sendFrontendMessage: mockSendFrontendMessage
}))
jest.mock('backend/game_overrides', () => ({
  getAllGameOverrides: mockGetAllGameOverrides,
  setGameOverrides: mockSetGameOverrides
}))
jest.mock('backend/vndb/electronStore', () => ({
  vndbMatchesStore: {
    get: mockVndbMatchesStoreGet,
    set: mockVndbMatchesStoreSet
  }
}))
jest.mock('backend/vndb/client', () => ({
  getDecryptedApiToken: mockGetDecryptedApiToken,
  setStoredApiToken: mockSetStoredApiToken
}))
jest.mock('backend/config', () => ({
  GlobalConfig: {
    get: mockGlobalConfigGet
  }
}))
jest.mock('backend/constants/key_value_stores', () => ({
  configStore: {
    get: mockConfigStoreGet,
    set: mockConfigStoreSet
  },
  tsStore: {
    get raw_store() {
      return mockTimestampStoreRawStore
    },
    set: mockTimestampStoreSet,
    delete: mockTimestampStoreDelete
  }
}))
jest.mock('backend/constants/paths', () => ({
  userDataPath: jest
    .requireActual<typeof import('node:os')>('node:os')
    .tmpdir(),
  get gamesConfigPath() {
    return mockGamesConfigPath
  }
}))
jest.mock('backend/logger', () => ({
  logWarning: jest.fn(),
  logError: mockLogError
}))
jest.mock('backend/utils', () => ({
  getMigratedExecutablePath: mockGetMigratedExecutablePath,
  writeConfig: mockWriteConfig
}))
jest.mock('backend/steamgrid/secureKey', () => ({
  decryptApiKey: (stored: string) => stored.replace(/^encrypted:/, ''),
  encryptApiKey: (plain: string) => `encrypted:${plain}`,
  isEncryptedValue: (stored: string) => stored.startsWith('encrypted:')
}))
jest.mock('backend/constants/environment', () => ({
  get isLinux() {
    return mockEnvironment.isLinux
  },
  get isMac() {
    return mockEnvironment.isMac
  },
  get isWindows() {
    return mockEnvironment.isWindows
  }
}))
jest.mock('../games', () => ({
  __esModule: true,
  default: mockSideloadGame
}))

import type { GameInfo } from 'common/types'
import type { VndbGameMatch } from 'common/types/vndb'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import SideloadLibraryManager from '../library'

function makeGame(overrides: Partial<GameInfo> = {}): GameInfo {
  return {
    app_name: 'visual-novel',
    runner: 'sideload',
    title: 'Visual Novel',
    art_cover: 'cover.png',
    art_square: 'square.png',
    install: {
      executable: 'C:\\Games\\Visual Novel\\game.exe',
      platform: 'Windows'
    },
    is_installed: true,
    canRunOffline: true,
    ...overrides
  }
}

function makeVndbMatch(overrides: Partial<VndbGameMatch> = {}): VndbGameMatch {
  return {
    appName: 'visual-novel',
    runner: 'sideload',
    title: 'Visual Novel',
    vndbId: 'v1',
    vndbTitle: 'Visual Novel VNDB',
    selectedReleases: [
      {
        id: 'r1',
        title: 'Visual Novel Release',
        languages: ['en'],
        platforms: ['win'],
        vns: []
      }
    ],
    syncedAt: '2026-07-02T00:00:00.000Z',
    ...overrides
  }
}

const localLibrarySettings = {
  askToDeleteArchiveAfterExtraction: false,
  autoVndbSyncNewGames: true,
  defaultInstallPath: '/mnt/install',
  defaultSteamPath: '/home/test/.steam/steam',
  defaultWinePrefixDir: '/home/test/Games/Heroic/Prefixes',
  detectLocalLibraryArchives: false,
  disablePlaytimeSync: false,
  egsLinkedPath: '/home/test/Games/egs-prefix',
  enableVndbIntegration: true,
  enableLocalLibraryWatcher: true,
  localeEmulatorPath: 'C:\\Locale Emulator\\LEProc.exe',
  localLibrarySyncExclusions: ['*.tmp', 'DLC*'],
  localLibrarySyncPath: '/mnt/local-library',
  migrationArchivePath: '/mnt/archive',
  migrationArchivePromptMode: 'ask',
  showVndbActionsOnGameCards: true,
  syncVndbUserData: true,
  useVndbDiscordRichPresence: true,
  vndbCategoryLabelSyncMode: 'ask',
  vndbLabelCategorySyncMode: 'automatic'
}

describe('SideloadLibraryManager.addNewApp', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllGameOverrides.mockReturnValue({})
    mockVndbMatchesStoreGet.mockReturnValue({})
    mockGetDecryptedApiToken.mockReturnValue('')
    mockGetSettings.mockReturnValue(localLibrarySettings)
    mockTimestampStoreRawStore = {}
    mockConfigStoreGet.mockImplementation((key: string, defaultValue) => {
      if (key === 'games.customCategories') {
        return {}
      }
      if (key === 'games.customCategoriesOrder') {
        return []
      }
      return defaultValue
    })
    mockEnvironment.isLinux = false
    mockEnvironment.isMac = false
    mockEnvironment.isWindows = true
    mockGlobalConfigGet.mockReturnValue({
      getSettings: mockGetSettings,
      setSetting: mockSetSetting
    })
  })

  it('persists visual-novel metadata for a new sideloaded game', () => {
    mockLibraryStoreGet.mockReturnValue([])
    const manager = new SideloadLibraryManager()

    manager.addNewApp(makeGame({ isVisualNovel: true }))

    const [storeKey, storedGames] = mockLibraryStoreSet.mock.calls[0] as [
      string,
      GameInfo[]
    ]
    expect(storeKey).toBe('games')
    expect(storedGames).toHaveLength(1)
    expect(storedGames[0]).toMatchObject({
      app_name: 'visual-novel',
      runner: 'sideload',
      folder_name: 'C:\\Games\\Visual Novel',
      isVisualNovel: true,
      install: {
        executable: 'C:\\Games\\Visual Novel\\game.exe',
        is_dlc: false,
        platform: 'Windows'
      }
    })
    expect(typeof storedGames[0].install.installed_at).toBe('string')
    expect(mockSideloadGame).toHaveBeenCalledWith('visual-novel')
    expect(mockAddShortcuts).toHaveBeenCalledWith(
      mockSideloadGame.mock.instances[0]
    )
    expect(mockSendFrontendMessage).toHaveBeenCalledWith(
      'refreshLibrary',
      'sideload'
    )
  })

  it('preserves the original install date when editing metadata', () => {
    const existingGame = makeGame({
      install: {
        executable: 'C:\\Games\\Visual Novel\\old.exe',
        installed_at: '2026-01-02T03:04:05.000Z',
        platform: 'Windows'
      },
      isVisualNovel: false
    })
    mockLibraryStoreGet.mockReturnValue([existingGame])
    const manager = new SideloadLibraryManager()

    manager.addNewApp(
      makeGame({
        install: {
          executable: 'D:\\Games\\Visual Novel\\game.exe',
          platform: 'Windows'
        },
        isVisualNovel: true
      })
    )

    const [, storedGames] = mockLibraryStoreSet.mock.calls[0] as [
      string,
      GameInfo[]
    ]
    expect(storedGames[0]).toMatchObject({
      folder_name: 'D:\\Games\\Visual Novel',
      isVisualNovel: true,
      install: {
        executable: 'D:\\Games\\Visual Novel\\game.exe',
        installed_at: '2026-01-02T03:04:05.000Z'
      }
    })
    expect(mockAddShortcuts).not.toHaveBeenCalled()
  })
})

describe('SideloadLibraryManager.changeGameInstallPath', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockGetAllGameOverrides.mockReturnValue({})
    mockVndbMatchesStoreGet.mockReturnValue({})
    mockGetDecryptedApiToken.mockReturnValue('')
    mockGetSettings.mockReturnValue(localLibrarySettings)
    mockTimestampStoreRawStore = {}
    mockEnvironment.isLinux = false
    mockEnvironment.isMac = false
    mockEnvironment.isWindows = true
    mockGlobalConfigGet.mockReturnValue({
      getSettings: mockGetSettings,
      setSetting: mockSetSetting
    })
  })

  it('updates folder and executable metadata', async () => {
    mockLibraryStoreGet.mockReturnValue([makeGame()])
    mockGetMigratedExecutablePath.mockReturnValue(
      'D:\\Archive\\Visual Novel\\game.exe'
    )
    const manager = new SideloadLibraryManager()

    await manager.changeGameInstallPath(
      'visual-novel',
      'D:\\Archive\\Visual Novel'
    )

    const [storeKey, storedGames] = mockLibraryStoreSet.mock.calls[0] as [
      string,
      GameInfo[]
    ]
    expect(storeKey).toBe('games')
    expect(storedGames[0]).toMatchObject({
      folder_name: 'D:\\Archive\\Visual Novel',
      install: {
        executable: 'D:\\Archive\\Visual Novel\\game.exe',
        install_path: 'D:\\Archive\\Visual Novel'
      }
    })
    expect(mockGetMigratedExecutablePath).toHaveBeenCalledWith(
      'C:\\Games\\Visual Novel\\game.exe',
      'C:\\Games\\Visual Novel',
      'D:\\Archive\\Visual Novel'
    )
    expect(mockSendFrontendMessage).toHaveBeenCalledWith(
      'refreshLibrary',
      'sideload'
    )
  })
})

describe('SideloadLibraryManager metadata backup and restore', () => {
  let tempDirectory: string

  beforeEach(async () => {
    jest.clearAllMocks()
    mockGetAllGameOverrides.mockReturnValue({})
    mockVndbMatchesStoreGet.mockReturnValue({})
    mockGetDecryptedApiToken.mockReturnValue('')
    mockGetSettings.mockReturnValue(localLibrarySettings)
    mockTimestampStoreRawStore = {}
    mockEnvironment.isLinux = false
    mockEnvironment.isMac = false
    mockEnvironment.isWindows = true
    mockGlobalConfigGet.mockReturnValue({
      getSettings: mockGetSettings,
      setSetting: mockSetSetting
    })
    tempDirectory = await mkdtemp(join(tmpdir(), 'heroic-sideload-backup-'))
    mockGamesConfigPath = tempDirectory
  })

  afterEach(async () => {
    await rm(tempDirectory, { force: true, recursive: true })
  })

  it('writes sideloaded games and metadata overrides to a backup file', async () => {
    const games = [makeGame({ isVisualNovel: true })]
    mockLibraryStoreGet.mockReturnValue(games)
    mockGetSettings.mockReturnValue({
      ...localLibrarySettings,
      steamGridDbApiKey: 'encrypted:sgdb-token'
    })
    mockTimestampStoreRawStore = {
      'epic-game': {
        firstPlayed: '2026-01-01T00:00:00.000Z',
        lastPlayed: '2026-01-02T00:00:00.000Z',
        totalPlayed: 99
      },
      'visual-novel': {
        firstPlayed: '2026-02-01T00:00:00.000Z',
        lastPlayed: '2026-02-02T00:00:00.000Z',
        totalPlayed: 123
      }
    }
    await writeFile(
      join(tempDirectory, 'visual-novel.json'),
      JSON.stringify({
        'visual-novel': {
          jpLocale: true,
          winePrefix: '/home/test/Games/Heroic/Prefixes/visual-novel'
        },
        version: 'v0.1'
      }),
      'utf8'
    )
    mockGetAllGameOverrides.mockReturnValue({
      'epic-game': { title: 'Do Not Export' },
      'visual-novel': { title: 'Override Title', isVisualNovel: true }
    })
    mockGetDecryptedApiToken.mockReturnValue('vndb-token')
    const vndbMatch = makeVndbMatch()
    mockVndbMatchesStoreGet.mockReturnValue({
      'legendary:epic-game': makeVndbMatch({
        appName: 'epic-game',
        runner: 'legendary'
      }),
      'sideload:visual-novel': vndbMatch
    })
    mockConfigStoreGet.mockImplementation((key: string, defaultValue) => {
      if (key === 'games.customCategories') {
        return {
          Finished: ['visual-novel_sideload', 'epic-game_legendary'],
          Wishlist: ['epic-game_legendary']
        }
      }
      if (key === 'games.customCategoriesOrder') {
        return ['Wishlist', 'Finished']
      }
      return defaultValue
    })
    const manager = new SideloadLibraryManager()

    const backupPath = await manager.backupMetadata(tempDirectory)

    expect(backupPath).toContain('heroic-local-library-metadata-')
    expect(backupPath.endsWith('.json')).toBe(true)

    const backup = JSON.parse(await readFile(backupPath, 'utf8')) as {
      exportedAt: string
      categories: {
        customCategories: Record<string, string[]>
        customCategoriesOrder: string[]
      }
      gameSettings: Record<string, unknown>
      games: GameInfo[]
      gameOverrides: Record<string, unknown>
      localLibrarySettings: Record<string, unknown>
      playtime: Record<string, unknown>
      vndbMatches: Record<string, unknown>
      version: number
    }
    expect(backup.version).toBe(1)
    expect(typeof backup.exportedAt).toBe('string')
    expect(backup.categories).toEqual({
      customCategories: {
        Finished: ['visual-novel_sideload'],
        Wishlist: []
      },
      customCategoriesOrder: ['Wishlist', 'Finished']
    })
    expect(backup.gameSettings).toEqual({
      'visual-novel': {
        jpLocale: true,
        winePrefix: '/home/test/Games/Heroic/Prefixes/visual-novel'
      }
    })
    expect(backup.games).toEqual(games)
    expect(backup.gameOverrides).toEqual({
      'visual-novel': { title: 'Override Title', isVisualNovel: true }
    })
    expect(backup.localLibrarySettings).toEqual(localLibrarySettings)
    expect(backup.playtime).toEqual({
      'visual-novel': {
        firstPlayed: '2026-02-01T00:00:00.000Z',
        lastPlayed: '2026-02-02T00:00:00.000Z',
        totalPlayed: 123
      }
    })
    expect(backup).not.toHaveProperty('steamGridDbApiKey')
    expect(backup).not.toHaveProperty('vndbApiToken')
    const rawBackup = await readFile(backupPath, 'utf8')
    expect(rawBackup).not.toContain('sgdb-token')
    expect(rawBackup).not.toContain('vndb-token')
    expect(backup.vndbMatches).toEqual({
      'legendary:epic-game': makeVndbMatch({
        appName: 'epic-game',
        runner: 'legendary'
      }),
      'sideload:visual-novel': vndbMatch
    })
  })

  it('includes decrypted API keys only when includeSecrets is set', async () => {
    mockLibraryStoreGet.mockReturnValue([makeGame()])
    mockGetSettings.mockReturnValue({
      ...localLibrarySettings,
      steamGridDbApiKey: 'encrypted:sgdb-token'
    })
    mockGetDecryptedApiToken.mockReturnValue('vndb-token')
    mockConfigStoreGet.mockImplementation(
      (_key: string, defaultValue) => defaultValue
    )
    const manager = new SideloadLibraryManager()

    const withoutSecretsPath = await manager.backupMetadata(tempDirectory, {})
    const withSecretsPath = await manager.backupMetadata(tempDirectory, {
      includeSecrets: true
    })

    const withoutSecrets = JSON.parse(
      await readFile(withoutSecretsPath, 'utf8')
    ) as Record<string, unknown>
    const withSecrets = JSON.parse(
      await readFile(withSecretsPath, 'utf8')
    ) as Record<string, unknown>
    expect(withoutSecrets).not.toHaveProperty('steamGridDbApiKey')
    expect(withoutSecrets).not.toHaveProperty('vndbApiToken')
    expect(withSecrets.steamGridDbApiKey).toBe('sgdb-token')
    expect(withSecrets.vndbApiToken).toBe('vndb-token')
  })

  it('does not touch stored API keys when restoring a backup without secrets', async () => {
    const backupPath = join(tempDirectory, 'backup.json')
    await writeFile(
      backupPath,
      JSON.stringify({
        games: [makeGame()],
        localLibrarySettings,
        version: 1
      }),
      'utf8'
    )
    mockLibraryStoreGet.mockReturnValue([])
    const manager = new SideloadLibraryManager()

    await expect(manager.restoreMetadata(backupPath)).resolves.toMatchObject({
      steamGridDbApiKey: false,
      vndbApiToken: false
    })

    expect(mockSetStoredApiToken).not.toHaveBeenCalled()
    expect(mockSetSetting).not.toHaveBeenCalledWith(
      'steamGridDbApiKey',
      expect.anything()
    )
  })

  it('merges restored games, applies overrides, and refreshes the sideload library', async () => {
    mockEnvironment.isLinux = true
    mockEnvironment.isWindows = false
    const existingGame = makeGame({
      app_name: 'existing-game',
      title: 'Existing Game'
    })
    const restoredExistingGame = makeGame({
      app_name: 'existing-game',
      title: 'Restored Existing Game'
    })
    const restoredNewGame = makeGame({
      app_name: 'restored-new-game',
      title: 'Restored New Game'
    })
    const restoredNewMatch = makeVndbMatch({
      appName: 'restored-new-game',
      title: 'Restored New Game',
      vndbId: 'v2',
      vndbTitle: 'Restored New Game VNDB'
    })
    const restoredLegendaryMatch = makeVndbMatch({
      appName: 'legendary-vn',
      runner: 'legendary',
      title: 'Legendary VN',
      vndbId: 'v4',
      vndbTitle: 'Legendary VNDB'
    })
    const existingMatch = makeVndbMatch({
      appName: 'other-game',
      title: 'Other Game',
      vndbId: 'v3',
      vndbTitle: 'Other Game VNDB'
    })
    const backupPath = join(tempDirectory, 'backup.json')
    await writeFile(
      backupPath,
      JSON.stringify({
        exportedAt: '2026-07-02T00:00:00.000Z',
        games: [restoredExistingGame, restoredNewGame],
        gameOverrides: {
          'restored-new-game': { art_cover: 'cover.png' }
        },
        gameSettings: {
          'legendary-game': {
            jpLocale: true
          },
          'restored-new-game': {
            jpLocale: true,
            winePrefix: '/home/test/Games/Heroic/Prefixes/restored-new-game'
          }
        },
        categories: {
          customCategories: {
            Finished: ['existing-game_sideload'],
            Playing: ['restored-new-game_sideload']
          },
          customCategoriesOrder: ['Playing', 'Finished']
        },
        localLibrarySettings,
        playtime: {
          'legendary-game': {
            totalPlayed: 888
          },
          'restored-new-game': {
            firstPlayed: '2026-03-01T00:00:00.000Z',
            lastPlayed: '2026-03-02T00:00:00.000Z',
            totalPlayed: 321
          }
        },
        steamGridDbApiKey: 'restored-sgdb-key',
        vndbApiToken: 'restored-vndb-token',
        vndbMatches: {
          'legendary:legendary-vn': restoredLegendaryMatch,
          'sideload:restored-new-game': restoredNewMatch
        },
        version: 1
      }),
      'utf8'
    )
    mockLibraryStoreGet.mockReturnValue([existingGame])
    mockVndbMatchesStoreGet.mockReturnValue({
      'sideload:other-game': existingMatch
    })
    mockGetAllGameOverrides.mockReturnValue({
      'restored-new-game': { art_cover: 'cover.png' }
    })
    mockConfigStoreGet.mockImplementation((key: string, defaultValue) => {
      if (key === 'games.customCategories') {
        return {
          Finished: ['restored-new-game_sideload', 'other-game_legendary'],
          Backlog: ['existing-game_sideload']
        }
      }
      if (key === 'games.customCategoriesOrder') {
        return ['Backlog', 'Finished']
      }
      return defaultValue
    })
    const manager = new SideloadLibraryManager()

    await expect(manager.restoreMetadata(backupPath)).resolves.toEqual({
      added: 1,
      categories: 2,
      customCategories: {
        customCategories: {
          Finished: ['other-game_legendary', 'existing-game_sideload'],
          Backlog: [],
          Playing: ['restored-new-game_sideload']
        },
        customCategoriesOrder: ['Backlog', 'Playing', 'Finished']
      },
      gameSettings: 1,
      updated: 1,
      total: 2,
      overrides: 1,
      localLibrarySettings,
      playtime: 1,
      steamGridDbApiKey: true,
      vndbApiToken: true,
      vndbMatches: 1
    })

    expect(mockLibraryStoreSet).toHaveBeenCalledWith('games', [
      restoredExistingGame,
      restoredNewGame
    ])
    expect(mockSetGameOverrides).toHaveBeenCalledWith('restored-new-game', {
      art_cover: 'cover.png'
    })
    expect(mockSetSetting).toHaveBeenCalledWith(
      'askToDeleteArchiveAfterExtraction',
      false
    )
    expect(mockSetSetting).toHaveBeenCalledWith(
      'detectLocalLibraryArchives',
      false
    )
    expect(mockSetSetting).toHaveBeenCalledWith(
      'enableLocalLibraryWatcher',
      true
    )
    expect(mockSetSetting).toHaveBeenCalledWith('localLibrarySyncExclusions', [
      '*.tmp',
      'DLC*'
    ])
    expect(mockSetSetting).toHaveBeenCalledWith(
      'steamGridDbApiKey',
      'encrypted:restored-sgdb-key'
    )
    expect(mockSetStoredApiToken).toHaveBeenCalledWith('restored-vndb-token')
    expect(mockWriteConfig).toHaveBeenCalledWith('restored-new-game', {
      jpLocale: true,
      winePrefix: '/home/test/Games/Heroic/Prefixes/restored-new-game'
    })
    expect(mockWriteConfig).not.toHaveBeenCalledWith(
      'legendary-game',
      expect.anything()
    )
    expect(mockTimestampStoreSet).toHaveBeenCalledWith(
      'restored-new-game.firstPlayed',
      '2026-03-01T00:00:00.000Z'
    )
    expect(mockTimestampStoreSet).toHaveBeenCalledWith(
      'restored-new-game.lastPlayed',
      '2026-03-02T00:00:00.000Z'
    )
    expect(mockTimestampStoreSet).toHaveBeenCalledWith(
      'restored-new-game.totalPlayed',
      321
    )
    expect(mockTimestampStoreSet).not.toHaveBeenCalledWith(
      'legendary-game.totalPlayed',
      expect.anything()
    )
    expect(mockConfigStoreSet).toHaveBeenCalledWith('games.customCategories', {
      Finished: ['other-game_legendary', 'existing-game_sideload'],
      Backlog: [],
      Playing: ['restored-new-game_sideload']
    })
    expect(mockConfigStoreSet).toHaveBeenCalledWith(
      'games.customCategoriesOrder',
      ['Backlog', 'Playing', 'Finished']
    )
    // Matches for games that are not part of the restored library are ignored.
    expect(mockVndbMatchesStoreSet).toHaveBeenCalledWith('matches', {
      'sideload:other-game': existingMatch,
      'sideload:restored-new-game': restoredNewMatch
    })
    expect(mockSendFrontendMessage).toHaveBeenNthCalledWith(
      1,
      'metadataChanged',
      {
        'restored-new-game': { art_cover: 'cover.png' }
      }
    )
    expect(mockSendFrontendMessage).toHaveBeenNthCalledWith(
      2,
      'vndbMatchesChanged',
      {
        'sideload:other-game': existingMatch,
        'sideload:restored-new-game': restoredNewMatch
      }
    )
    expect(mockSendFrontendMessage).toHaveBeenNthCalledWith(
      3,
      'refreshLibrary',
      'sideload'
    )
  })

  it('detects Windows backup paths when restoring on Linux', async () => {
    mockEnvironment.isLinux = true
    mockEnvironment.isWindows = false
    const backupPath = join(tempDirectory, 'backup.json')
    await writeFile(
      backupPath,
      JSON.stringify({
        exportedAt: '2026-07-02T00:00:00.000Z',
        games: [
          makeGame({
            app_name: 'visual-novel-one',
            folder_name: 'C:\\Games\\Visual Novel One',
            install: {
              executable: 'C:\\Games\\Visual Novel One\\game.exe',
              install_path: 'C:\\Games\\Visual Novel One',
              platform: 'Windows'
            },
            title: 'Visual Novel One'
          }),
          makeGame({
            app_name: 'visual-novel-two',
            folder_name: 'C:\\Games\\Visual Novel Two',
            install: {
              executable: 'C:\\Games\\Visual Novel Two\\game.exe',
              install_path: 'C:\\Games\\Visual Novel Two',
              platform: 'Windows'
            },
            title: 'Visual Novel Two'
          })
        ],
        version: 1
      }),
      'utf8'
    )
    const manager = new SideloadLibraryManager()

    await expect(manager.inspectMetadataBackup(backupPath)).resolves.toEqual({
      affectedGames: 2,
      backupPathStyle: 'windows',
      currentPathStyle: 'posix',
      shouldPromptForPath: true,
      sourcePath: 'C:\\Games'
    })
  })

  it('detects Windows drive-root backup paths when restoring on Linux', async () => {
    mockEnvironment.isLinux = true
    mockEnvironment.isWindows = false
    const backupPath = join(tempDirectory, 'backup.json')
    await writeFile(
      backupPath,
      JSON.stringify({
        exportedAt: '2026-07-02T00:00:00.000Z',
        games: [
          makeGame({
            app_name: 'visual-novel-one',
            folder_name: 'V:\\Visual Novel One',
            install: {
              executable: 'V:\\Visual Novel One\\game.exe',
              platform: 'Windows'
            },
            title: 'Visual Novel One'
          }),
          makeGame({
            app_name: 'visual-novel-two',
            folder_name: 'V:\\Visual Novel Two',
            install: {
              executable: 'V:\\Visual Novel Two\\game.exe',
              platform: 'Windows'
            },
            title: 'Visual Novel Two'
          })
        ],
        version: 1
      }),
      'utf8'
    )
    const manager = new SideloadLibraryManager()

    await expect(manager.inspectMetadataBackup(backupPath)).resolves.toEqual({
      affectedGames: 2,
      backupPathStyle: 'windows',
      currentPathStyle: 'posix',
      shouldPromptForPath: true,
      sourcePath: 'V:\\'
    })
  })

  it('remaps restored Windows paths to a selected Linux folder', async () => {
    mockEnvironment.isLinux = true
    mockEnvironment.isWindows = false
    const backupPath = join(tempDirectory, 'backup.json')
    await writeFile(
      backupPath,
      JSON.stringify({
        exportedAt: '2026-07-02T00:00:00.000Z',
        games: [
          makeGame({
            folder_name: 'C:\\Games\\Visual Novel',
            install: {
              executable: 'C:\\Games\\Visual Novel\\game.exe',
              install_path: 'C:\\Games\\Visual Novel',
              platform: 'Windows'
            }
          })
        ],
        version: 1
      }),
      'utf8'
    )
    mockLibraryStoreGet.mockReturnValue([])
    const manager = new SideloadLibraryManager()

    await manager.restoreMetadata(backupPath, {
      pathMapping: {
        destinationPath: '/mnt/games/Visual Novel',
        sourcePath: 'C:\\Games\\Visual Novel'
      }
    })

    expect(mockLibraryStoreSet).toHaveBeenCalledWith('games', [
      expect.objectContaining({
        folder_name: '/mnt/games/Visual Novel',
        install: expect.objectContaining({
          executable: '/mnt/games/Visual Novel/game.exe',
          install_path: '/mnt/games/Visual Novel'
        })
      })
    ])
    expect(mockConfigStoreSet).not.toHaveBeenCalled()
  })

  it('remaps restored Windows drive-root paths to a selected Linux folder', async () => {
    mockEnvironment.isLinux = true
    mockEnvironment.isWindows = false
    const backupPath = join(tempDirectory, 'backup.json')
    await writeFile(
      backupPath,
      JSON.stringify({
        exportedAt: '2026-07-02T00:00:00.000Z',
        games: [
          makeGame({
            folder_name: 'V:\\Aibeya',
            install: {
              executable: 'V:\\Aibeya\\aibeya.exe',
              platform: 'Windows'
            }
          })
        ],
        version: 1
      }),
      'utf8'
    )
    mockLibraryStoreGet.mockReturnValue([])
    const manager = new SideloadLibraryManager()

    await manager.restoreMetadata(backupPath, {
      pathMapping: {
        destinationPath: '/mnt/games',
        sourcePath: 'V:\\'
      }
    })

    expect(mockLibraryStoreSet).toHaveBeenCalledWith('games', [
      expect.objectContaining({
        folder_name: '/mnt/games/Aibeya',
        install: expect.objectContaining({
          executable: '/mnt/games/Aibeya/aibeya.exe'
        })
      })
    ])
  })

  it('rejects backups that do not contain sideloaded game metadata', async () => {
    const backupPath = join(tempDirectory, 'invalid.json')
    await writeFile(
      backupPath,
      JSON.stringify({
        games: [{ app_name: 'legendary-game', runner: 'legendary' }],
        version: 1
      }),
      'utf8'
    )
    const manager = new SideloadLibraryManager()

    await expect(manager.restoreMetadata(backupPath)).rejects.toThrow(
      'Metadata backup contains invalid sideloaded games.'
    )
    expect(mockLibraryStoreSet).not.toHaveBeenCalled()
  })
})

describe('SideloadLibraryManager metadata restore across operating systems', () => {
  let tempDirectory: string

  beforeEach(async () => {
    jest.clearAllMocks()
    mockGetAllGameOverrides.mockReturnValue({})
    mockVndbMatchesStoreGet.mockReturnValue({})
    mockGetDecryptedApiToken.mockReturnValue('')
    mockGetSettings.mockReturnValue(localLibrarySettings)
    mockTimestampStoreRawStore = {}
    mockConfigStoreGet.mockImplementation((key: string, defaultValue) =>
      key === 'games.customCategories'
        ? {}
        : key === 'games.customCategoriesOrder'
          ? []
          : defaultValue
    )
    mockGlobalConfigGet.mockReturnValue({
      getSettings: mockGetSettings,
      setSetting: mockSetSetting
    })
    mockLibraryStoreGet.mockReturnValue([])
    tempDirectory = await mkdtemp(join(tmpdir(), 'heroic-sideload-restore-'))
    mockGamesConfigPath = tempDirectory
  })

  afterEach(async () => {
    await rm(tempDirectory, { force: true, recursive: true })
  })

  async function writeBackup(backup: Record<string, unknown>) {
    const backupPath = join(tempDirectory, 'backup.json')
    await writeFile(
      backupPath,
      JSON.stringify({
        exportedAt: '2026-07-02T00:00:00.000Z',
        version: 1,
        ...backup
      }),
      'utf8'
    )
    return backupPath
  }

  function setPlatform(platform: 'linux' | 'windows') {
    mockEnvironment.isLinux = platform === 'linux'
    mockEnvironment.isWindows = platform === 'windows'
    mockEnvironment.isMac = false
  }

  it('maps or skips path settings and per-game wine paths for a Windows backup on Linux', async () => {
    setPlatform('linux')
    await writeFile(
      join(tempDirectory, 'visual-novel.json'),
      JSON.stringify({
        'visual-novel': {
          savesPath: '/home/test/saves',
          winePrefix: '/home/test/Prefixes/visual-novel',
          wineVersion: { bin: '/usr/bin/wine', name: 'System', type: 'wine' }
        },
        version: 'v0'
      }),
      'utf8'
    )
    const backupPath = await writeBackup({
      games: [makeGame()],
      gameSettings: {
        'visual-novel': {
          jpLocale: true,
          savesPath: 'E:\\Saves',
          targetExe: 'C:\\Games\\Visual Novel\\game.exe',
          winePrefix: 'C:\\Games\\prefix',
          wineVersion: {
            bin: 'D:\\wine\\bin\\wine',
            name: 'Wine',
            type: 'wine'
          }
        }
      },
      localLibrarySettings: {
        ...localLibrarySettings,
        defaultInstallPath: 'C:\\Games\\Installs',
        defaultSteamPath: 'C:\\Steam',
        defaultWinePrefixDir: 'D:\\Prefixes',
        egsLinkedPath: 'C:\\Games\\egs',
        localeEmulatorPath: 'C:\\Locale Emulator\\LEProc.exe',
        localLibrarySyncPath: 'C:\\Games\\Library',
        migrationArchivePath: 'C:\\Games\\Archive'
      }
    })
    const manager = new SideloadLibraryManager()

    const result = await manager.restoreMetadata(backupPath, {
      pathMapping: { destinationPath: '/mnt/games', sourcePath: 'C:\\Games' }
    })

    // Paths under the mapped root are rewritten to POSIX paths.
    expect(mockSetSetting).toHaveBeenCalledWith(
      'defaultInstallPath',
      '/mnt/games/Installs'
    )
    expect(mockSetSetting).toHaveBeenCalledWith(
      'egsLinkedPath',
      '/mnt/games/egs'
    )
    expect(mockSetSetting).toHaveBeenCalledWith(
      'localLibrarySyncPath',
      '/mnt/games/Library'
    )
    expect(mockSetSetting).toHaveBeenCalledWith(
      'migrationArchivePath',
      '/mnt/games/Archive'
    )
    // Windows paths that cannot be mapped are never written.
    for (const key of [
      'defaultSteamPath',
      'defaultWinePrefixDir',
      'localeEmulatorPath'
    ]) {
      expect(mockSetSetting).not.toHaveBeenCalledWith(key, expect.anything())
    }
    expect(result.localLibrarySettings).toMatchObject({
      defaultInstallPath: '/mnt/games/Installs',
      defaultSteamPath: localLibrarySettings.defaultSteamPath,
      defaultWinePrefixDir: localLibrarySettings.defaultWinePrefixDir,
      localLibrarySyncPath: '/mnt/games/Library'
    })
    // Per-game settings: mapped where possible, otherwise the target value.
    expect(mockWriteConfig).toHaveBeenCalledWith('visual-novel', {
      jpLocale: true,
      savesPath: '/home/test/saves',
      targetExe: '/mnt/games/Visual Novel/game.exe',
      winePrefix: '/mnt/games/prefix',
      wineVersion: { bin: '/usr/bin/wine', name: 'System', type: 'wine' }
    })
  })

  it('skips every foreign path when no path mapping is given', async () => {
    setPlatform('linux')
    const backupPath = await writeBackup({
      games: [makeGame()],
      gameSettings: {
        'visual-novel': {
          jpLocale: true,
          winePrefix: 'C:\\Games\\prefix',
          wineVersion: {
            bin: 'C:\\wine\\wine.exe',
            name: 'Wine',
            type: 'wine'
          }
        }
      },
      localLibrarySettings: {
        ...localLibrarySettings,
        defaultInstallPath: 'C:\\Games\\Installs',
        localLibrarySyncPath: 'C:\\Games\\Library'
      }
    })
    const manager = new SideloadLibraryManager()

    await manager.restoreMetadata(backupPath)

    expect(mockSetSetting).not.toHaveBeenCalledWith(
      'defaultInstallPath',
      expect.anything()
    )
    expect(mockSetSetting).not.toHaveBeenCalledWith(
      'localLibrarySyncPath',
      expect.anything()
    )
    expect(mockWriteConfig).toHaveBeenCalledWith('visual-novel', {
      jpLocale: true
    })
  })

  it('maps or skips path settings and per-game wine paths for a Linux backup on Windows', async () => {
    setPlatform('windows')
    const backupPath = await writeBackup({
      games: [
        makeGame({
          install: {
            executable: '/mnt/games/vn/game.exe',
            platform: 'linux'
          }
        })
      ],
      gameSettings: {
        'visual-novel': {
          jpLocale: true,
          targetExe: '/mnt/games/vn/game.exe',
          winePrefix: '/home/test/Games/Heroic/Prefixes/visual-novel',
          wineVersion: { bin: '/usr/bin/wine', name: 'System', type: 'wine' }
        }
      },
      localLibrarySettings: {
        ...localLibrarySettings,
        defaultInstallPath: '/mnt/games/Installs',
        defaultSteamPath: '/home/test/.steam/steam',
        localLibrarySyncPath: '/mnt/games/Library'
      }
    })
    const manager = new SideloadLibraryManager()

    await manager.restoreMetadata(backupPath, {
      pathMapping: { destinationPath: 'D:\\Games', sourcePath: '/mnt/games' }
    })

    expect(mockSetSetting).toHaveBeenCalledWith(
      'defaultInstallPath',
      'D:\\Games\\Installs'
    )
    expect(mockSetSetting).toHaveBeenCalledWith(
      'localLibrarySyncPath',
      'D:\\Games\\Library'
    )
    expect(mockSetSetting).not.toHaveBeenCalledWith(
      'defaultSteamPath',
      expect.anything()
    )
    expect(mockWriteConfig).toHaveBeenCalledWith('visual-novel', {
      jpLocale: true,
      targetExe: 'D:\\Games\\vn\\game.exe'
    })
  })

  it('only restores VNDB matches for restored games', async () => {
    setPlatform('linux')
    const restoredMatch = makeVndbMatch({ appName: 'restored-game' })
    const strayMatch = makeVndbMatch({ appName: 'not-in-backup', vndbId: 'v9' })
    const backupPath = await writeBackup({
      games: [makeGame({ app_name: 'restored-game' })],
      vndbMatches: {
        'sideload:not-in-backup': strayMatch,
        'sideload:restored-game': restoredMatch
      }
    })
    const manager = new SideloadLibraryManager()

    await expect(manager.restoreMetadata(backupPath)).resolves.toMatchObject({
      vndbMatches: 1
    })

    expect(mockVndbMatchesStoreSet).toHaveBeenCalledWith('matches', {
      'sideload:restored-game': restoredMatch
    })
  })

  describe('when the restore fails midway', () => {
    const previousGame = makeGame({
      app_name: 'restored-new-game',
      title: 'Previous Game'
    })
    const previousMatch = makeVndbMatch({
      appName: 'restored-new-game',
      vndbId: 'v-old'
    })

    async function arrangePreviousState() {
      setPlatform('linux')
      mockLibraryStoreGet.mockReturnValue([previousGame])
      mockGetAllGameOverrides.mockReturnValue({
        'restored-new-game': { title: 'Previous Title' }
      })
      mockGetSettings.mockReturnValue({
        ...localLibrarySettings,
        autoVndbSyncNewGames: false,
        steamGridDbApiKey: 'encrypted:previous-key'
      })
      mockGetDecryptedApiToken.mockReturnValue('previous-token')
      mockTimestampStoreRawStore = {
        'restored-new-game': { totalPlayed: 5 }
      }
      mockVndbMatchesStoreGet.mockReturnValue({
        'sideload:restored-new-game': previousMatch
      })
      mockConfigStoreGet.mockImplementation((key: string, defaultValue) =>
        key === 'games.customCategories'
          ? { Backlog: ['restored-new-game_sideload'] }
          : key === 'games.customCategoriesOrder'
            ? ['Backlog']
            : defaultValue
      )
      await writeFile(
        join(tempDirectory, 'restored-new-game.json'),
        JSON.stringify({
          'restored-new-game': { jpLocale: false },
          version: 'v0'
        }),
        'utf8'
      )

      return writeBackup({
        categories: {
          customCategories: { Playing: ['restored-new-game_sideload'] },
          customCategoriesOrder: ['Playing']
        },
        gameOverrides: { 'restored-new-game': { title: 'Restored Title' } },
        gameSettings: { 'restored-new-game': { jpLocale: true } },
        games: [makeGame({ app_name: 'restored-new-game', title: 'Restored' })],
        localLibrarySettings: {
          ...localLibrarySettings,
          autoVndbSyncNewGames: true
        },
        playtime: {
          'restored-new-game': {
            firstPlayed: '2026-03-01T00:00:00.000Z',
            totalPlayed: 321
          }
        },
        steamGridDbApiKey: 'restored-key',
        vndbApiToken: 'restored-token',
        vndbMatches: {
          'sideload:restored-new-game': makeVndbMatch({
            appName: 'restored-new-game',
            vndbId: 'v-new'
          })
        }
      })
    }

    it('rolls every store back and rethrows when the last write fails', async () => {
      const backupPath = await arrangePreviousState()
      mockVndbMatchesStoreSet.mockImplementationOnce(() => {
        throw new Error('disk full')
      })
      const manager = new SideloadLibraryManager()

      await expect(manager.restoreMetadata(backupPath)).rejects.toThrow(
        'disk full'
      )

      expect(mockLibraryStoreSet).toHaveBeenLastCalledWith('games', [
        previousGame
      ])
      expect(mockSetGameOverrides).toHaveBeenLastCalledWith(
        'restored-new-game',
        { title: 'Previous Title' }
      )
      expect(mockSetSetting).toHaveBeenCalledWith('autoVndbSyncNewGames', false)
      expect(mockSetSetting).toHaveBeenCalledWith(
        'steamGridDbApiKey',
        'encrypted:previous-key'
      )
      expect(mockSetStoredApiToken).toHaveBeenLastCalledWith('previous-token')
      expect(mockConfigStoreSet).toHaveBeenCalledWith(
        'games.customCategories',
        { Backlog: ['restored-new-game_sideload'] }
      )
      expect(mockConfigStoreSet).toHaveBeenLastCalledWith(
        'games.customCategoriesOrder',
        ['Backlog']
      )
      expect(mockWriteConfig).toHaveBeenLastCalledWith('restored-new-game', {
        jpLocale: false
      })
      expect(mockTimestampStoreSet).toHaveBeenLastCalledWith(
        'restored-new-game.totalPlayed',
        5
      )
      expect(mockTimestampStoreDelete).toHaveBeenCalledWith(
        'restored-new-game.firstPlayed'
      )
      expect(mockVndbMatchesStoreSet).toHaveBeenLastCalledWith('matches', {
        'sideload:restored-new-game': previousMatch
      })
      expect(mockSendFrontendMessage).not.toHaveBeenCalled()
    })

    it('does not write later stores when an earlier step fails', async () => {
      const backupPath = await arrangePreviousState()
      mockWriteConfig.mockRejectedValueOnce(new Error('config locked'))
      const manager = new SideloadLibraryManager()

      await expect(manager.restoreMetadata(backupPath)).rejects.toThrow(
        'config locked'
      )

      expect(mockLibraryStoreSet).not.toHaveBeenCalled()
      expect(mockVndbMatchesStoreSet).not.toHaveBeenCalled()
      expect(mockTimestampStoreSet).not.toHaveBeenCalled()
      expect(mockSetGameOverrides).toHaveBeenLastCalledWith(
        'restored-new-game',
        { title: 'Previous Title' }
      )
      expect(mockSetStoredApiToken).toHaveBeenLastCalledWith('previous-token')
      expect(mockSendFrontendMessage).not.toHaveBeenCalled()
    })

    it('still rolls back the remaining steps when one rollback fails', async () => {
      const backupPath = await arrangePreviousState()
      mockVndbMatchesStoreSet.mockImplementationOnce(() => {
        throw new Error('disk full')
      })
      mockSetStoredApiToken.mockImplementation((token: string) => {
        if (token === 'previous-token') {
          throw new Error('keychain unavailable')
        }
      })
      const manager = new SideloadLibraryManager()

      await expect(manager.restoreMetadata(backupPath)).rejects.toThrow(
        'disk full'
      )

      expect(mockLogError).toHaveBeenCalledWith(
        expect.stringContaining('keychain unavailable'),
        'Sideload'
      )
      expect(mockLibraryStoreSet).toHaveBeenLastCalledWith('games', [
        previousGame
      ])
      expect(mockSetGameOverrides).toHaveBeenLastCalledWith(
        'restored-new-game',
        { title: 'Previous Title' }
      )
      mockSetStoredApiToken.mockReset()
    })
  })
})
