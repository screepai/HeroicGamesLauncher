import AdmZip from 'adm-zip'
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync
} from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const tmpRoot = mkdtempSync(join(tmpdir(), 'heroic-fork-stages-test-'))
const appFolder = join(tmpRoot, 'heroic')
const userData = join(tmpRoot, 'userData')
const configFile = join(appFolder, 'config.json')

jest.mock('electron-store')
jest.mock('backend/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  logError: jest.fn(),
  logDebug: jest.fn(),
  LogPrefix: { ImportExport: 'ImportExport' }
}))
jest.mock('backend/ipc', () => ({
  addHandler: jest.fn(),
  sendFrontendMessage: jest.fn()
}))
jest.mock('backend/constants/paths', () => ({
  appFolder,
  userDataPath: userData,
  configPath: configFile,
  gamesConfigPath: join(appFolder, 'GamesConfig'),
  fixesPath: join(appFolder, 'fixes'),
  toolsPath: join(appFolder, 'tools')
}))

// The "current OS" can be switched per test through mockEnv.
const mockEnv = { windows: false }
jest.mock('backend/constants/environment', () => ({
  isSnap: false,
  get isWindows() {
    return mockEnv.windows
  },
  get isLinux() {
    return !mockEnv.windows
  },
  isMac: false
}))
jest.mock('electron', () => ({
  app: {
    getPath: () => userData,
    getVersion: () => '9.9.9-test',
    relaunch: jest.fn(),
    exit: jest.fn()
  }
}))

type Settings = Record<string, unknown>
const mockSettings: { current: Settings } = { current: {} }
const mockSetSetting = jest.fn()
jest.mock('backend/config', () => ({
  GlobalConfig: {
    get: () => ({
      getSettings: () => mockSettings.current,
      setSetting: mockSetSetting,
      // Like the real one: re-read the settings from the config file.
      reloadFromFile: () => {
        const parsed = JSON.parse(readFileSync(configFile, 'utf-8')) as {
          defaultSettings: Settings
        }
        mockSettings.current = { ...parsed.defaultSettings }
      }
    })
  }
}))

jest.mock('backend/storeManagers/legendary/user', () => ({
  LegendaryUser: { getUserInfo: jest.fn() }
}))
jest.mock('backend/storeManagers/nile/user', () => ({
  NileUser: { getUserData: jest.fn().mockResolvedValue(undefined) }
}))
jest.mock('backend/wine/manager/utils', () => ({
  wineDownloaderInfoStore: {
    get: jest.fn().mockReturnValue([]),
    set: jest.fn(),
    delete: jest.fn(),
    get_nodefault: jest.fn()
  },
  updateWineVersionInfos: jest.fn().mockResolvedValue([]),
  installWineVersion: jest.fn().mockResolvedValue('success'),
  removeWineVersion: jest.fn().mockResolvedValue(true)
}))
const emptyBackupPaths = { credentials: [], libraryCache: [] }
jest.mock('backend/storeManagers', () => ({
  libraryManagerMap: {
    legendary: { getBackupPaths: () => emptyBackupPaths },
    gog: { getBackupPaths: () => emptyBackupPaths },
    nile: { getBackupPaths: () => emptyBackupPaths },
    zoom: { getBackupPaths: () => emptyBackupPaths },
    sideload: { getBackupPaths: () => emptyBackupPaths }
  }
}))
jest.mock('backend/downloadmanager/downloadqueue', () => ({
  addToQueue: jest.fn()
}))

const mockStore = new Map<string, unknown>()
const mockRollbackStore = {
  get_nodefault: (key: string) => mockStore.get(`rollback.${key}`),
  set: (key: string, value: unknown) => {
    mockStore.set(`rollback.${key}`, value)
  },
  delete: (key: string) => {
    mockStore.delete(`rollback.${key}`)
  }
}
const mockConfigStore = {
  get: (key: string, fallback: unknown) =>
    mockStore.has(`config.${key}`) ? mockStore.get(`config.${key}`) : fallback,
  set: (key: string, value: unknown) => {
    mockStore.set(`config.${key}`, value)
  },
  delete: (key: string) => {
    mockStore.delete(`config.${key}`)
  }
}
jest.mock('backend/constants/key_value_stores', () => ({
  importExportRollbackStore: mockRollbackStore,
  configStore: mockConfigStore,
  tsStore: {
    raw_store: {},
    replace: jest.fn()
  }
}))

// Fork data sources. "enc:" stands for this machine's safeStorage encryption.
const mockMatches: { current: Record<string, unknown> } = { current: {} }
const mockOverrides: { current: Record<string, Record<string, unknown>> } = {
  current: {}
}
const mockSetStoredApiToken = jest.fn()
const mockSetSteamGridDbApiKey = jest.fn()
const mockVndbStore = {
  set: (_key: string, value: unknown) => {
    mockMatches.current = value as Record<string, unknown>
  }
}
jest.mock('backend/vndb/electronStore', () => ({
  vndbMatchesStore: mockVndbStore
}))
jest.mock('backend/vndb/client', () => ({
  getDecryptedApiToken: () => {
    const stored = mockSettings.current['vndbApiToken']
    return typeof stored === 'string' ? stored.replace(/^enc:/, '') : ''
  },
  setStoredApiToken: mockSetStoredApiToken
}))
jest.mock('backend/storeManagers/sideload/metadataBackup', () => ({
  getAllVndbMatches: () => mockMatches.current,
  isVndbGameMatch: (value: unknown) =>
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { vndbId?: unknown }).vndbId === 'string',
  getSteamGridDbApiKey: () => {
    const stored = mockSettings.current['steamGridDbApiKey']
    return typeof stored === 'string' ? stored.replace(/^enc:/, '') : ''
  },
  setSteamGridDbApiKey: mockSetSteamGridDbApiKey
}))
jest.mock('backend/game_overrides', () => ({
  getAllGameOverrides: () => mockOverrides.current,
  setGameOverrides: (appName: string, override: Record<string, unknown>) => {
    if (Object.keys(override).length === 0) {
      delete mockOverrides.current[appName]
    } else {
      mockOverrides.current[appName] = override
    }
    return true
  }
}))
jest.mock('backend/utils/secureSecret', () => ({
  decryptSecret: (stored: string) => stored.replace(/^enc:/, '')
}))
jest.mock('backend/steamgrid/secureKey', () => ({
  decryptApiKey: (stored: string) => stored.replace(/^enc:/, '')
}))

import { sendFrontendMessage } from 'backend/ipc'
import type { HeroicApplyOptions } from 'common/types/importExport'

import { exportHeroicBackup } from '../export'
import { applyHeroicBackup, rollbackLastImport } from '../apply'
import { BACKUP_FORMAT_VERSION, BACKUP_PATHS } from '../constants'
import { FORK_BACKUP_PATHS } from '../forkStages'

const addJson = (zip: AdmZip, path: string, data: unknown) => {
  zip.addFile(path, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'))
}

const readZipJson = (zipPath: string, entry: string): unknown => {
  const data = new AdmZip(zipPath).getEntry(entry)?.getData()
  return data ? JSON.parse(data.toString('utf-8')) : undefined
}

const match = (appName: string, vndbId = 'v1') => ({
  appName,
  runner: 'sideload',
  title: appName,
  vndbId,
  vndbTitle: appName,
  syncedAt: '2026-01-01T00:00:00.000Z'
})

const gamesDir = join(appFolder, 'GamesConfig')
const writeLocalConfig = (settings: Settings) => {
  mockSettings.current = { ...settings }
  writeFileSync(
    configFile,
    JSON.stringify({ version: 'v0', defaultSettings: settings })
  )
}

const baseManifest = {
  formatVersion: BACKUP_FORMAT_VERSION,
  createdAt: '2026-04-24T10:00:00.000Z',
  heroicVersion: '9.9.9',
  platform: 'win32' as const,
  stages: [],
  counts: {
    perGameSettings: 0,
    installedGames: {},
    credentials: {},
    fixesIncluded: false,
    themesIncluded: false,
    wineVersions: 0,
    sideloadGames: 0
  }
}

function applyOptions(
  sourcePath: string,
  overrides: Partial<HeroicApplyOptions>
): HeroicApplyOptions {
  return {
    sourcePath,
    stages: [],
    overwriteGlobalSettings: true,
    includedAppNames: [],
    includedCredentials: {},
    perGameOverrides: [],
    includedWineVersions: [],
    ...overrides
  }
}

describe('fork backup stages', () => {
  beforeAll(() => {
    mkdirSync(appFolder, { recursive: true })
    mkdirSync(userData, { recursive: true })
    mkdirSync(gamesDir, { recursive: true })
  })
  afterAll(() => {
    rmSync(tmpRoot, { recursive: true, force: true })
  })
  beforeEach(() => {
    mockSetSetting.mockImplementation((key: string, value: unknown) => {
      mockSettings.current[key] = value
    })
    mockEnv.windows = false
    mockStore.clear()
    mockMatches.current = {}
    mockOverrides.current = {}
    writeLocalConfig({
      defaultInstallPath: '/home/me/Games',
      vndbApiToken: 'enc:local-vndb',
      steamGridDbApiKey: 'enc:local-sgdb'
    })
  })

  describe('export', () => {
    it('adds the new stages and keeps secrets out unless opted in', async () => {
      mockMatches.current = { a: match('a'), b: match('b') }
      mockOverrides.current = { a: { title: 'Custom' } }
      mockStore.set('config.games.customCategoriesOrder', ['x', 'y'])
      const out = join(tmpRoot, 'export-default.zip')

      const result = await exportHeroicBackup({
        outputPath: out,
        stages: [
          'globalSettings',
          'vndbMatches',
          'gameOverrides',
          'categoryOrder'
        ]
      })

      expect(result.success).toBe(true)
      expect(result.manifest?.counts).toMatchObject({
        vndbMatches: 2,
        gameOverrides: 1,
        categoryOrder: 2
      })
      expect(readZipJson(out, FORK_BACKUP_PATHS.vndbMatches)).toEqual(
        mockMatches.current
      )
      expect(readZipJson(out, FORK_BACKUP_PATHS.gameOverrides)).toEqual(
        mockOverrides.current
      )
      expect(readZipJson(out, FORK_BACKUP_PATHS.categoryOrder)).toEqual([
        'x',
        'y'
      ])
      expect(new AdmZip(out).getEntry(FORK_BACKUP_PATHS.secrets)).toBeNull()
    })

    it('removes the encrypted tokens from the raw config copy', async () => {
      const out = join(tmpRoot, 'export-config.zip')
      await exportHeroicBackup({ outputPath: out, stages: ['globalSettings'] })

      const config = readZipJson(out, BACKUP_PATHS.globalSettings.config) as {
        defaultSettings: Settings
      }
      expect(config.defaultSettings.defaultInstallPath).toBe('/home/me/Games')
      expect(config.defaultSettings).not.toHaveProperty('vndbApiToken')
      expect(config.defaultSettings).not.toHaveProperty('steamGridDbApiKey')
    })

    it('writes decrypted secrets only when the secrets stage is chosen', async () => {
      const out = join(tmpRoot, 'export-secrets.zip')
      await exportHeroicBackup({ outputPath: out, stages: ['secrets'] })

      expect(readZipJson(out, FORK_BACKUP_PATHS.secrets)).toEqual({
        format: 'plain',
        vndbApiToken: 'local-vndb',
        steamGridDbApiKey: 'local-sgdb'
      })
    })

    it('keeps device-encrypted values in rollback snapshots', async () => {
      const out = join(tmpRoot, 'export-snapshot.zip')
      await exportHeroicBackup({
        outputPath: out,
        stages: ['secrets'],
        forSnapshot: true
      })

      expect(readZipJson(out, FORK_BACKUP_PATHS.secrets)).toEqual({
        format: 'device',
        vndbApiToken: 'enc:local-vndb',
        steamGridDbApiKey: 'enc:local-sgdb'
      })
    })
  })

  describe('apply', () => {
    function buildBackup(
      name: string,
      entries: Record<string, unknown>,
      stages: string[]
    ): string {
      const src = join(tmpRoot, `${name}.zip`)
      const zip = new AdmZip()
      addJson(zip, BACKUP_PATHS.manifest, { ...baseManifest, stages })
      for (const [path, data] of Object.entries(entries)) {
        addJson(zip, path, data)
      }
      zip.writeZip(src)
      return src
    }

    it("keeps this machine's tokens when the raw config is restored", async () => {
      // A legacy backup: its config still carries tokens encrypted elsewhere.
      const src = buildBackup(
        'legacy-config',
        {
          [BACKUP_PATHS.globalSettings.config]: {
            version: 'v0',
            defaultSettings: {
              defaultInstallPath: '/mnt/games',
              vndbApiToken: 'vndb:v1:foreign',
              steamGridDbApiKey: 'sgdb:v1:foreign'
            }
          }
        },
        ['globalSettings']
      )

      const result = await applyHeroicBackup(
        applyOptions(src, { stages: ['globalSettings'] })
      )

      expect(result.ok).toBe(true)
      expect(mockSettings.current).toMatchObject({
        defaultInstallPath: '/mnt/games',
        vndbApiToken: 'enc:local-vndb',
        steamGridDbApiKey: 'enc:local-sgdb'
      })
    })

    it("keeps this machine's value for paths from another OS", async () => {
      const src = buildBackup(
        'cross-os-config',
        {
          [BACKUP_PATHS.globalSettings.config]: {
            version: 'v0',
            defaultSettings: {
              defaultInstallPath: 'C:\\Games',
              defaultWinePrefixDir: '/mnt/prefixes',
              customWinePaths: ['D:\\wine', '/opt/wine']
            }
          }
        },
        ['globalSettings']
      )

      const result = await applyHeroicBackup(
        applyOptions(src, { stages: ['globalSettings'] })
      )

      expect(result.ok).toBe(true)
      expect(mockSettings.current.defaultInstallPath).toBe('/home/me/Games')
      expect(mockSettings.current.defaultWinePrefixDir).toBe('/mnt/prefixes')
      expect(mockSettings.current.customWinePaths).toEqual(['/opt/wine'])
      expect(result.warnings.join(' ')).toContain('defaultInstallPath')
    })

    it('does not touch settings when globalSettings is not overwritten', async () => {
      const src = buildBackup(
        'no-overwrite',
        {
          [BACKUP_PATHS.globalSettings.config]: {
            version: 'v0',
            defaultSettings: { defaultInstallPath: 'C:\\Games' }
          }
        },
        ['globalSettings']
      )

      await applyHeroicBackup(
        applyOptions(src, {
          stages: ['globalSettings'],
          overwriteGlobalSettings: false
        })
      )

      expect(mockSetSetting).not.toHaveBeenCalled()
      expect(mockSettings.current.defaultInstallPath).toBe('/home/me/Games')
    })

    it('drops foreign paths in per-game settings but keeps the local value', async () => {
      writeFileSync(
        join(gamesDir, 'game1.json'),
        JSON.stringify({ game1: { winePrefix: '/home/me/prefix1' } })
      )
      const src = buildBackup(
        'cross-os-game',
        {
          [`${BACKUP_PATHS.perGameSettings.dir}game1.json`]: {
            game1: {
              winePrefix: 'C:\\prefix',
              targetExe: 'C:\\Games\\g.exe',
              autoInstallDxvk: true
            },
            version: 'v0.1'
          },
          [`${BACKUP_PATHS.perGameSettings.dir}game2.json`]: {
            game2: { winePrefix: '/mnt/prefix2' },
            version: 'v0.1'
          }
        },
        ['perGameSettings']
      )

      const result = await applyHeroicBackup(
        applyOptions(src, {
          stages: ['perGameSettings'],
          includedAppNames: ['game1', 'game2']
        })
      )

      expect(result.ok).toBe(true)
      const game1 = JSON.parse(
        readFileSync(join(gamesDir, 'game1.json'), 'utf-8')
      ) as { game1: Settings; version: string }
      expect(game1.game1.winePrefix).toBe('/home/me/prefix1')
      expect(game1.game1).not.toHaveProperty('targetExe')
      expect(game1.game1.autoInstallDxvk).toBe(true)
      expect(game1.version).toBe('v0.1')
      const game2 = JSON.parse(
        readFileSync(join(gamesDir, 'game2.json'), 'utf-8')
      ) as { game2: Settings }
      expect(game2.game2.winePrefix).toBe('/mnt/prefix2')
    })

    it('maps Linux paths away on Windows too', async () => {
      mockEnv.windows = true
      writeLocalConfig({ defaultInstallPath: 'C:\\Games' })
      const src = buildBackup(
        'linux-to-windows',
        {
          [BACKUP_PATHS.globalSettings.config]: {
            version: 'v0',
            defaultSettings: { defaultInstallPath: '/home/me/Games' }
          }
        },
        ['globalSettings']
      )

      await applyHeroicBackup(applyOptions(src, { stages: ['globalSettings'] }))

      expect(mockSettings.current.defaultInstallPath).toBe('C:\\Games')
    })

    it('merges VNDB matches and ignores invalid entries', async () => {
      mockMatches.current = { keep: match('keep', 'v9') }
      const src = buildBackup(
        'vndb',
        {
          [FORK_BACKUP_PATHS.vndbMatches]: {
            a: match('a', 'v1'),
            broken: { nope: true }
          }
        },
        ['vndbMatches']
      )

      const result = await applyHeroicBackup(
        applyOptions(src, { stages: ['vndbMatches'] })
      )

      expect(result.ok).toBe(true)
      expect(Object.keys(mockMatches.current).sort()).toEqual(['a', 'keep'])
      expect(sendFrontendMessage).toHaveBeenCalledWith(
        'vndbMatchesChanged',
        mockMatches.current
      )
    })

    it('restores game overrides and skips artwork paths from another OS', async () => {
      mockOverrides.current = { existing: { title: 'Mine' } }
      const src = buildBackup(
        'overrides',
        {
          [FORK_BACKUP_PATHS.gameOverrides]: {
            a: {
              title: 'Renamed',
              art_cover: 'https://example.com/c.png',
              art_square: 'C:\\art\\sq.png',
              isVisualNovel: true
            },
            onlyForeignArt: { art_cover: 'D:\\x.png' }
          }
        },
        ['gameOverrides']
      )

      const result = await applyHeroicBackup(
        applyOptions(src, { stages: ['gameOverrides'] })
      )

      expect(result.ok).toBe(true)
      expect(mockOverrides.current).toEqual({
        existing: { title: 'Mine' },
        a: {
          title: 'Renamed',
          art_cover: 'https://example.com/c.png',
          isVisualNovel: true
        }
      })
    })

    it('applies category order only for categories that exist', async () => {
      mockStore.set('config.games.customCategories', {
        a: [],
        b: [],
        c: []
      })
      mockStore.set('config.games.customCategoriesOrder', ['c'])
      const src = buildBackup(
        'order',
        { [FORK_BACKUP_PATHS.categoryOrder]: ['b', 'gone', 'a'] },
        ['categoryOrder']
      )

      const result = await applyHeroicBackup(
        applyOptions(src, { stages: ['categoryOrder'] })
      )

      expect(result.ok).toBe(true)
      expect(mockStore.get('config.games.customCategoriesOrder')).toEqual([
        'b',
        'a',
        'c'
      ])
    })

    it('does not import secrets unless the stage is selected', async () => {
      const src = buildBackup(
        'secrets-off',
        {
          [FORK_BACKUP_PATHS.secrets]: {
            format: 'plain',
            vndbApiToken: 'new-vndb',
            steamGridDbApiKey: 'new-sgdb'
          },
          [FORK_BACKUP_PATHS.categoryOrder]: []
        },
        ['secrets', 'categoryOrder']
      )

      await applyHeroicBackup(applyOptions(src, { stages: ['categoryOrder'] }))

      expect(mockSetStoredApiToken).not.toHaveBeenCalled()
      expect(mockSetSteamGridDbApiKey).not.toHaveBeenCalled()
    })

    it('re-encrypts plain secrets through the regular setters when chosen', async () => {
      const src = buildBackup(
        'secrets-on',
        {
          [FORK_BACKUP_PATHS.secrets]: {
            format: 'plain',
            vndbApiToken: 'new-vndb',
            steamGridDbApiKey: 'new-sgdb'
          }
        },
        ['secrets']
      )

      const result = await applyHeroicBackup(
        applyOptions(src, { stages: ['secrets'] })
      )

      expect(result.ok).toBe(true)
      expect(result.stages).toContainEqual({
        stage: 'secrets',
        ok: true,
        message: '2 secret(s)'
      })
      expect(mockSetStoredApiToken).toHaveBeenCalledWith('new-vndb')
      expect(mockSetSteamGridDbApiKey).toHaveBeenCalledWith('new-sgdb')
    })

    it('ignores empty secrets from a plain backup', async () => {
      const src = buildBackup(
        'secrets-empty',
        { [FORK_BACKUP_PATHS.secrets]: { format: 'plain' } },
        ['secrets']
      )

      await applyHeroicBackup(applyOptions(src, { stages: ['secrets'] }))

      expect(mockSetStoredApiToken).not.toHaveBeenCalled()
      expect(mockSetSteamGridDbApiKey).not.toHaveBeenCalled()
    })

    it('round-trips an export through apply and rolls secrets back', async () => {
      // Export on "machine A".
      const out = join(tmpRoot, 'roundtrip.zip')
      mockMatches.current = { a: match('a') }
      await exportHeroicBackup({
        outputPath: out,
        stages: ['globalSettings', 'vndbMatches', 'secrets']
      })

      // "Machine B" has other tokens and no matches.
      writeLocalConfig({
        defaultInstallPath: '/home/other/Games',
        vndbApiToken: 'enc:other-vndb',
        steamGridDbApiKey: ''
      })
      mockMatches.current = {}

      const result = await applyHeroicBackup(
        applyOptions(out, {
          stages: ['globalSettings', 'vndbMatches', 'secrets']
        })
      )

      expect(result.ok).toBe(true)
      expect(Object.keys(mockMatches.current)).toEqual(['a'])
      expect(mockSetStoredApiToken).toHaveBeenCalledWith('local-vndb')
      expect(mockSetSteamGridDbApiKey).toHaveBeenCalledWith('local-sgdb')

      // The pre-apply snapshot holds machine B's tokens in device form.
      expect(result.rollbackPath).toBeDefined()
      expect(existsSync(result.rollbackPath ?? '')).toBe(true)
      expect(
        readZipJson(result.rollbackPath ?? '', FORK_BACKUP_PATHS.secrets)
      ).toEqual({
        format: 'device',
        vndbApiToken: 'enc:other-vndb',
        steamGridDbApiKey: ''
      })

      mockSetStoredApiToken.mockClear()
      mockSetSteamGridDbApiKey.mockClear()
      expect((await rollbackLastImport()).ok).toBe(true)
      expect(mockSetStoredApiToken).toHaveBeenCalledWith('other-vndb')
      // An empty key in the snapshot clears the key again.
      expect(mockSetSteamGridDbApiKey).toHaveBeenCalledWith('')
      // The exact snapshot state is restored: imported matches are removed.
      expect(mockMatches.current).toEqual({})
    })
  })
})
