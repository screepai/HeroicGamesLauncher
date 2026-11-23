import type { AppSettings, GameInfo, GameSettings } from 'common/types'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'path'
import { libraryStore } from './electronStores'
import { sendFrontendMessage } from 'backend/ipc'
import { logError } from 'backend/logger'
import { getAllGameOverrides, setGameOverrides } from 'backend/game_overrides'
import type { GameMetadataOverride } from 'backend/game_overrides/electronStores'
import { vndbMatchesStore } from 'backend/vndb/electronStore'
import { getDecryptedApiToken, setStoredApiToken } from 'backend/vndb/client'
import { GlobalConfig } from 'backend/config'
import type { VndbGameMatch } from 'common/types/vndb'
import { configStore, tsStore } from 'backend/constants/key_value_stores'
import { gamesConfigPath } from 'backend/constants/paths'
import { writeConfig } from 'backend/utils'
import {
  decryptApiKey,
  encryptApiKey,
  isEncryptedValue
} from 'backend/steamgrid/secureKey'
import {
  applyRestorePathMapping,
  getBackupPathInfo,
  getCurrentPathStyle,
  resolveGameSettingsPaths,
  resolveRestoredPath
} from './pathStyle'
import type {
  PathStyle,
  RestoreSideloadLibraryMetadataPathMapping
} from './pathStyle'

type LocalLibraryMetadataSettings = Pick<
  AppSettings,
  | 'askToDeleteArchiveAfterExtraction'
  | 'autoVndbSyncNewGames'
  | 'defaultInstallPath'
  | 'defaultSteamPath'
  | 'defaultWinePrefixDir'
  | 'detectLocalLibraryArchives'
  | 'disablePlaytimeSync'
  | 'egsLinkedPath'
  | 'enableVndbIntegration'
  | 'enableLocalLibraryWatcher'
  | 'localeEmulatorPath'
  | 'localLibrarySyncExclusions'
  | 'localLibrarySyncPath'
  | 'migrationArchivePath'
  | 'migrationArchivePromptMode'
  | 'showVndbActionsOnGameCards'
  | 'syncVndbUserData'
  | 'useVndbDiscordRichPresence'
  | 'vndbCategoryLabelSyncMode'
  | 'vndbLabelCategorySyncMode'
>

type LocalLibraryMetadataCategories = {
  customCategories: Record<string, string[]>
  customCategoriesOrder: string[]
}

type LocalLibraryMetadataPlaytime = Record<
  string,
  {
    firstPlayed?: string
    lastPlayed?: string
    totalPlayed?: number
  }
>

type SideloadLibraryMetadataBackup = {
  categories?: LocalLibraryMetadataCategories
  exportedAt: string
  gameSettings?: Record<string, Partial<GameSettings>>
  games: GameInfo[]
  gameOverrides: Record<string, GameMetadataOverride>
  localLibrarySettings: LocalLibraryMetadataSettings
  playtime?: LocalLibraryMetadataPlaytime
  /** Only present when the backup was created with `includeSecrets`. */
  steamGridDbApiKey?: string
  /** Only present when the backup was created with `includeSecrets`. */
  vndbApiToken?: string
  vndbMatches: Record<string, VndbGameMatch>
  version: 1
}

export type BackupSideloadLibraryMetadataOptions = {
  /**
   * Also write the SteamGridDB API key and the VNDB token (decrypted, so
   * unencrypted on disk) into the backup. Defaults to false.
   */
  includeSecrets?: boolean
}

export type RestoreSideloadLibraryMetadataResult = {
  added: number
  categories: number
  customCategories?: LocalLibraryMetadataCategories
  gameSettings: number
  updated: number
  total: number
  overrides: number
  localLibrarySettings?: LocalLibraryMetadataSettings
  playtime: number
  steamGridDbApiKey: boolean
  vndbApiToken: boolean
  vndbMatches: number
}

export type RestoreSideloadLibraryMetadataOptions = {
  pathMapping?: RestoreSideloadLibraryMetadataPathMapping
}

export type InspectSideloadLibraryMetadataBackupResult = {
  affectedGames: number
  backupPathStyle: PathStyle
  currentPathStyle: PathStyle
  sourcePath?: string
  shouldPromptForPath: boolean
}

type LocalLibrarySettingsKey = keyof LocalLibraryMetadataSettings

type LocalLibrarySettingsRestore = {
  /** Settings that will be written, in order. Skipped settings are absent. */
  applied: Array<[LocalLibrarySettingsKey, unknown]>
  /** Settings as they will be after the restore (skipped ones keep current). */
  effective: LocalLibraryMetadataSettings
}

type GameSettingsRestore = {
  appName: string
  previous: Partial<GameSettings> | undefined
  settings: Partial<GameSettings>
}

type PreparedSideloadLibraryMetadataRestore = {
  added: number
  backupGames: GameInfo[]
  categories?: LocalLibraryMetadataCategories
  gameSettings: GameSettingsRestore[]
  localLibrarySettings: LocalLibrarySettingsRestore
  restoredAppNames: Set<string>
  restoredGames: GameInfo[]
  restoredOverrides: Array<[string, GameMetadataOverride]>
  restoredPlaytime: LocalLibraryMetadataPlaytime
  restoredVndbMatches: Array<[string, VndbGameMatch]>
  updated: number
}

type RestoreStep = {
  name: string
  apply: () => void | Promise<void>
  rollback: () => void | Promise<void>
}

/** Local library settings that hold a filesystem path. */
const LOCAL_LIBRARY_PATH_SETTINGS: ReadonlySet<LocalLibrarySettingsKey> =
  new Set<LocalLibrarySettingsKey>([
    'defaultInstallPath',
    'defaultSteamPath',
    'defaultWinePrefixDir',
    'egsLinkedPath',
    'localeEmulatorPath',
    'localLibrarySyncPath',
    'migrationArchivePath'
  ])

function getBackupFileName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `heroic-local-library-metadata-${timestamp}.json`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isGameInfo(value: unknown): value is GameInfo {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.app_name === 'string' &&
    typeof value.title === 'string' &&
    value.runner === 'sideload' &&
    isRecord(value.install)
  )
}

export function isVndbGameMatch(value: unknown): value is VndbGameMatch {
  if (!isRecord(value)) {
    return false
  }

  return (
    typeof value.appName === 'string' &&
    typeof value.runner === 'string' &&
    typeof value.title === 'string' &&
    typeof value.vndbId === 'string' &&
    typeof value.vndbTitle === 'string' &&
    typeof value.syncedAt === 'string'
  )
}

function getLocalLibrarySettings(): LocalLibraryMetadataSettings {
  const settings = GlobalConfig.get().getSettings()

  return {
    askToDeleteArchiveAfterExtraction:
      settings.askToDeleteArchiveAfterExtraction,
    autoVndbSyncNewGames: settings.autoVndbSyncNewGames,
    defaultInstallPath: settings.defaultInstallPath,
    defaultSteamPath: settings.defaultSteamPath,
    defaultWinePrefixDir: settings.defaultWinePrefixDir,
    detectLocalLibraryArchives: settings.detectLocalLibraryArchives,
    disablePlaytimeSync: settings.disablePlaytimeSync,
    egsLinkedPath: settings.egsLinkedPath,
    enableVndbIntegration: settings.enableVndbIntegration,
    enableLocalLibraryWatcher: settings.enableLocalLibraryWatcher,
    localeEmulatorPath: settings.localeEmulatorPath,
    localLibrarySyncPath: settings.localLibrarySyncPath,
    localLibrarySyncExclusions: settings.localLibrarySyncExclusions,
    migrationArchivePath: settings.migrationArchivePath,
    migrationArchivePromptMode: settings.migrationArchivePromptMode,
    showVndbActionsOnGameCards: settings.showVndbActionsOnGameCards,
    syncVndbUserData: settings.syncVndbUserData,
    useVndbDiscordRichPresence: settings.useVndbDiscordRichPresence,
    vndbCategoryLabelSyncMode: settings.vndbCategoryLabelSyncMode,
    vndbLabelCategorySyncMode: settings.vndbLabelCategorySyncMode
  }
}

function getSideloadGameCategoryId(game: GameInfo): string {
  return `${game.app_name}_${game.runner}`
}

export function getSteamGridDbApiKey(): string {
  const stored = GlobalConfig.get().getSettings().steamGridDbApiKey ?? ''

  if (!stored) {
    return ''
  }

  return isEncryptedValue(stored) ? decryptApiKey(stored) : stored
}

export function setSteamGridDbApiKey(apiKey: string): void {
  const trimmed = apiKey.trim()
  GlobalConfig.get().setSetting(
    'steamGridDbApiKey',
    trimmed ? encryptApiKey(trimmed) : ''
  )
}

function parseGamePlaytime(value: unknown) {
  if (!isRecord(value)) {
    return undefined
  }

  const playtime: LocalLibraryMetadataPlaytime[string] = {}

  if (typeof value.firstPlayed === 'string') {
    playtime.firstPlayed = value.firstPlayed
  }

  if (typeof value.lastPlayed === 'string') {
    playtime.lastPlayed = value.lastPlayed
  }

  if (
    typeof value.totalPlayed === 'number' &&
    Number.isFinite(value.totalPlayed)
  ) {
    playtime.totalPlayed = value.totalPlayed
  }

  return Object.keys(playtime).length > 0 ? playtime : undefined
}

function getLocalLibraryPlaytime(
  games: GameInfo[]
): LocalLibraryMetadataPlaytime {
  const sideloadAppNames = new Set(games.map((game) => game.app_name))

  return Object.fromEntries(
    Object.entries(tsStore.raw_store)
      .filter(([appName]) => sideloadAppNames.has(appName))
      .map(([appName, value]) => [appName, parseGamePlaytime(value)])
      .filter(
        (entry): entry is [string, LocalLibraryMetadataPlaytime[string]] =>
          Boolean(entry[1])
      )
  )
}

const PLAYTIME_FIELDS = ['firstPlayed', 'lastPlayed', 'totalPlayed'] as const

/** Timestamp store keys that restoring `playtime` is going to write. */
function getPlaytimeRestoreKeys(
  playtime: LocalLibraryMetadataPlaytime
): string[] {
  return Object.entries(playtime).flatMap(([appName, value]) =>
    PLAYTIME_FIELDS.filter((field) =>
      field === 'totalPlayed'
        ? typeof value.totalPlayed === 'number'
        : Boolean(value[field])
    ).map((field) => `${appName}.${field}`)
  )
}

function restoreLocalLibraryPlaytime(
  playtime: LocalLibraryMetadataPlaytime
): void {
  for (const [appName, value] of Object.entries(playtime)) {
    if (value.firstPlayed) {
      tsStore.set(`${appName}.firstPlayed`, value.firstPlayed)
    }
    if (value.lastPlayed) {
      tsStore.set(`${appName}.lastPlayed`, value.lastPlayed)
    }
    if (typeof value.totalPlayed === 'number') {
      tsStore.set(`${appName}.totalPlayed`, value.totalPlayed)
    }
  }
}

function splitPlaytimeKey(key: string): [string, string] {
  const separator = key.lastIndexOf('.')
  return [key.slice(0, separator), key.slice(separator + 1)]
}

function getStoredPlaytimeValue(key: string): unknown {
  const [appName, field] = splitPlaytimeKey(key)
  const stored = tsStore.raw_store[appName] as unknown
  return isRecord(stored) ? stored[field] : undefined
}

function setStoredPlaytimeValue(key: string, value: unknown): void {
  const [appName, field] = splitPlaytimeKey(key)

  if (value === undefined) {
    tsStore.delete(`${appName}.${field}` as `${string}.totalPlayed`)
  } else if (field === 'totalPlayed' && typeof value === 'number') {
    tsStore.set(`${appName}.totalPlayed`, value)
  } else if (field === 'firstPlayed' && typeof value === 'string') {
    tsStore.set(`${appName}.firstPlayed`, value)
  } else if (field === 'lastPlayed' && typeof value === 'string') {
    tsStore.set(`${appName}.lastPlayed`, value)
  }
}

async function readGameSettingsBackup(
  appName: string
): Promise<Partial<GameSettings> | undefined> {
  try {
    const rawConfig = await readFile(
      join(gamesConfigPath, `${appName}.json`),
      'utf8'
    )
    const parsed: unknown = JSON.parse(rawConfig)

    return isRecord(parsed) && isRecord(parsed[appName])
      ? (parsed[appName] as Partial<GameSettings>)
      : undefined
  } catch {
    return undefined
  }
}

async function getLocalLibraryGameSettings(
  games: GameInfo[]
): Promise<Record<string, Partial<GameSettings>>> {
  const settings = await Promise.all(
    games.map(async (game) => [
      game.app_name,
      await readGameSettingsBackup(game.app_name)
    ])
  )

  return Object.fromEntries(
    settings.filter((entry): entry is [string, Partial<GameSettings>] =>
      isRecord(entry[1])
    )
  )
}

function parseLocalLibraryGameSettings(
  value: unknown
): Record<string, Partial<GameSettings>> {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, Partial<GameSettings>] => isRecord(entry[1])
    )
  )
}

function parseLocalLibraryPlaytime(
  value: unknown
): LocalLibraryMetadataPlaytime {
  if (!isRecord(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value)
      .map(([appName, playtime]) => [appName, parseGamePlaytime(playtime)])
      .filter(
        (entry): entry is [string, LocalLibraryMetadataPlaytime[string]] =>
          Boolean(entry[1])
      )
  )
}

function getLocalLibraryCategories(
  games: GameInfo[]
): LocalLibraryMetadataCategories {
  const sideloadGameIds = new Set(games.map(getSideloadGameCategoryId))
  const customCategories = configStore.get('games.customCategories', {})
  const filteredCategories = Object.fromEntries(
    Object.entries(customCategories).map(([category, gameIds]) => [
      category,
      gameIds.filter((gameId) => sideloadGameIds.has(gameId))
    ])
  )
  const backupCategoryNames = Object.keys(filteredCategories)
  const customCategoriesOrder = configStore
    .get('games.customCategoriesOrder', [])
    .filter((category) => backupCategoryNames.includes(category))

  return {
    customCategories: filteredCategories,
    customCategoriesOrder
  }
}

function parseLocalLibraryCategories(
  value: unknown
): LocalLibraryMetadataCategories | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const customCategories = isRecord(value.customCategories)
    ? Object.fromEntries(
        Object.entries(value.customCategories).filter(
          (entry): entry is [string, string[]] =>
            Array.isArray(entry[1]) &&
            entry[1].every((gameId) => typeof gameId === 'string')
        )
      )
    : {}
  const categoryNames = Object.keys(customCategories)
  const customCategoriesOrder = Array.isArray(value.customCategoriesOrder)
    ? value.customCategoriesOrder.filter(
        (category): category is string =>
          typeof category === 'string' && categoryNames.includes(category)
      )
    : []

  return {
    customCategories,
    customCategoriesOrder
  }
}

function readStoredCategories(): LocalLibraryMetadataCategories {
  const storedCategories = configStore.get('games.customCategories', {})
  const storedCategoryOrder = configStore.get('games.customCategoriesOrder', [])

  return {
    customCategories: isRecord(storedCategories) ? storedCategories : {},
    customCategoriesOrder: Array.isArray(storedCategoryOrder)
      ? storedCategoryOrder.filter(
          (category): category is string => typeof category === 'string'
        )
      : []
  }
}

/** Computes the merged categories without writing them. */
function computeRestoredCategories(
  categories: LocalLibraryMetadataCategories,
  games: GameInfo[]
): LocalLibraryMetadataCategories {
  const restoredGameIds = new Set(games.map(getSideloadGameCategoryId))
  const {
    customCategories: currentCategories,
    customCategoriesOrder: currentCategoryOrder
  } = readStoredCategories()
  const restoredCategoryNames = Object.keys(categories.customCategories)
  const nextCategories: Record<string, string[]> = Object.fromEntries(
    Object.entries(currentCategories).map(([category, gameIds]) => [
      category,
      gameIds.filter((gameId) => !restoredGameIds.has(gameId))
    ])
  )

  for (const [category, gameIds] of Object.entries(
    categories.customCategories
  )) {
    nextCategories[category] = [
      ...new Set([...(nextCategories[category] ?? []), ...gameIds])
    ]
  }

  const nextCategoryOrder = [
    ...currentCategoryOrder.filter(
      (category) => !restoredCategoryNames.includes(category)
    ),
    ...categories.customCategoriesOrder,
    ...restoredCategoryNames.filter(
      (category) => !categories.customCategoriesOrder.includes(category)
    )
  ].filter(
    (category, index, allCategories) =>
      nextCategories[category] && allCategories.indexOf(category) === index
  )

  return {
    customCategories: nextCategories,
    customCategoriesOrder: nextCategoryOrder
  }
}

function parseLocalLibrarySettings(
  value: unknown
): LocalLibraryMetadataSettings | undefined {
  if (!isRecord(value)) {
    return undefined
  }

  const settings: Partial<LocalLibraryMetadataSettings> = {}

  if (typeof value.askToDeleteArchiveAfterExtraction === 'boolean') {
    settings.askToDeleteArchiveAfterExtraction =
      value.askToDeleteArchiveAfterExtraction
  }

  if (typeof value.autoVndbSyncNewGames === 'boolean') {
    settings.autoVndbSyncNewGames = value.autoVndbSyncNewGames
  }

  if (typeof value.defaultInstallPath === 'string') {
    settings.defaultInstallPath = value.defaultInstallPath
  }

  if (typeof value.defaultSteamPath === 'string') {
    settings.defaultSteamPath = value.defaultSteamPath
  }

  if (typeof value.defaultWinePrefixDir === 'string') {
    settings.defaultWinePrefixDir = value.defaultWinePrefixDir
  }

  if (typeof value.detectLocalLibraryArchives === 'boolean') {
    settings.detectLocalLibraryArchives = value.detectLocalLibraryArchives
  }

  if (typeof value.disablePlaytimeSync === 'boolean') {
    settings.disablePlaytimeSync = value.disablePlaytimeSync
  }

  if (typeof value.egsLinkedPath === 'string') {
    settings.egsLinkedPath = value.egsLinkedPath
  }

  if (typeof value.enableVndbIntegration === 'boolean') {
    settings.enableVndbIntegration = value.enableVndbIntegration
  }

  if (typeof value.enableLocalLibraryWatcher === 'boolean') {
    settings.enableLocalLibraryWatcher = value.enableLocalLibraryWatcher
  }

  if (typeof value.localeEmulatorPath === 'string') {
    settings.localeEmulatorPath = value.localeEmulatorPath
  }

  if (typeof value.localLibrarySyncPath === 'string') {
    settings.localLibrarySyncPath = value.localLibrarySyncPath
  }

  if (
    Array.isArray(value.localLibrarySyncExclusions) &&
    value.localLibrarySyncExclusions.every((rule) => typeof rule === 'string')
  ) {
    settings.localLibrarySyncExclusions = value.localLibrarySyncExclusions
  }

  if (typeof value.migrationArchivePath === 'string') {
    settings.migrationArchivePath = value.migrationArchivePath
  }

  if (
    value.migrationArchivePromptMode === 'ask' ||
    value.migrationArchivePromptMode === 'always' ||
    value.migrationArchivePromptMode === 'never'
  ) {
    settings.migrationArchivePromptMode = value.migrationArchivePromptMode
  }

  if (typeof value.showVndbActionsOnGameCards === 'boolean') {
    settings.showVndbActionsOnGameCards = value.showVndbActionsOnGameCards
  }

  if (typeof value.syncVndbUserData === 'boolean') {
    settings.syncVndbUserData = value.syncVndbUserData
  }

  if (typeof value.useVndbDiscordRichPresence === 'boolean') {
    settings.useVndbDiscordRichPresence = value.useVndbDiscordRichPresence
  }

  if (
    value.vndbCategoryLabelSyncMode === 'ask' ||
    value.vndbCategoryLabelSyncMode === 'disabled'
  ) {
    settings.vndbCategoryLabelSyncMode = value.vndbCategoryLabelSyncMode
  }

  if (
    value.vndbLabelCategorySyncMode === 'ask' ||
    value.vndbLabelCategorySyncMode === 'automatic' ||
    value.vndbLabelCategorySyncMode === 'disabled'
  ) {
    settings.vndbLabelCategorySyncMode = value.vndbLabelCategorySyncMode
  }

  return {
    ...getLocalLibrarySettings(),
    ...settings
  }
}

function parseOptionalSecret(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined
}

function parseMetadataBackup(rawBackup: string): SideloadLibraryMetadataBackup {
  const parsed: unknown = JSON.parse(rawBackup)

  if (!isRecord(parsed)) {
    throw new Error('Metadata backup must be a JSON object.')
  }

  if (parsed.version !== 1) {
    throw new Error('Unsupported local library metadata backup version.')
  }

  if (!Array.isArray(parsed.games) || !parsed.games.every(isGameInfo)) {
    throw new Error('Metadata backup contains invalid sideloaded games.')
  }

  const vndbMatches: Record<string, VndbGameMatch> = isRecord(
    parsed.vndbMatches
  )
    ? Object.fromEntries(
        Object.entries(parsed.vndbMatches).filter(
          (entry): entry is [string, VndbGameMatch] => isVndbGameMatch(entry[1])
        )
      )
    : {}

  return {
    categories: parseLocalLibraryCategories(parsed.categories),
    exportedAt:
      typeof parsed.exportedAt === 'string'
        ? parsed.exportedAt
        : new Date().toISOString(),
    gameSettings: parseLocalLibraryGameSettings(parsed.gameSettings),
    games: parsed.games,
    gameOverrides: isRecord(parsed.gameOverrides)
      ? (parsed.gameOverrides as Record<string, GameMetadataOverride>)
      : {},
    localLibrarySettings:
      parseLocalLibrarySettings(parsed.localLibrarySettings) ??
      getLocalLibrarySettings(),
    playtime: parseLocalLibraryPlaytime(parsed.playtime),
    steamGridDbApiKey: parseOptionalSecret(parsed.steamGridDbApiKey),
    vndbApiToken: parseOptionalSecret(parsed.vndbApiToken),
    vndbMatches,
    version: 1
  }
}

function prepareLocalLibrarySettingsRestore(
  settings: LocalLibraryMetadataSettings,
  pathMapping: RestoreSideloadLibraryMetadataPathMapping | undefined
): LocalLibrarySettingsRestore {
  const current = getLocalLibrarySettings()
  const effective: Record<string, unknown> = { ...settings }
  const applied: LocalLibrarySettingsRestore['applied'] = []

  for (const [key, value] of Object.entries(settings) as Array<
    [LocalLibrarySettingsKey, unknown]
  >) {
    if (LOCAL_LIBRARY_PATH_SETTINGS.has(key) && typeof value === 'string') {
      const resolved = resolveRestoredPath(value, pathMapping)

      if (resolved === undefined) {
        // Foreign path that cannot be mapped: keep this machine's value.
        effective[key] = current[key]
        continue
      }

      effective[key] = resolved
      applied.push([key, resolved])
      continue
    }

    applied.push([key, value])
  }

  return {
    applied,
    effective: effective as LocalLibraryMetadataSettings
  }
}

async function prepareMetadataRestore(
  backup: SideloadLibraryMetadataBackup,
  currentGames: GameInfo[],
  pathMapping: RestoreSideloadLibraryMetadataPathMapping | undefined
): Promise<PreparedSideloadLibraryMetadataRestore> {
  const backupGames = backup.games.map((game) =>
    applyRestorePathMapping(game, pathMapping)
  )
  const currentByAppName = new Map(
    currentGames.map((game) => [game.app_name, game])
  )
  let added = 0
  let updated = 0

  for (const game of backupGames) {
    if (currentByAppName.has(game.app_name)) {
      updated++
    } else {
      added++
    }
    currentByAppName.set(game.app_name, game)
  }

  const restoredAppNames = new Set(backupGames.map((game) => game.app_name))
  const gameSettings = await Promise.all(
    Object.entries(backup.gameSettings ?? {})
      .filter(
        (entry): entry is [string, Partial<GameSettings>] =>
          restoredAppNames.has(entry[0]) && isRecord(entry[1])
      )
      .map(async ([appName, settings]) => {
        const previous = await readGameSettingsBackup(appName)

        return {
          appName,
          previous,
          settings: resolveGameSettingsPaths(settings, previous, pathMapping)
        }
      })
  )

  return {
    added,
    backupGames,
    categories: backup.categories
      ? computeRestoredCategories(backup.categories, backupGames)
      : undefined,
    gameSettings,
    localLibrarySettings: prepareLocalLibrarySettingsRestore(
      backup.localLibrarySettings,
      pathMapping
    ),
    restoredAppNames,
    restoredGames: [...currentByAppName.values()],
    restoredOverrides: Object.entries(backup.gameOverrides).filter(
      (entry): entry is [string, GameMetadataOverride] =>
        restoredAppNames.has(entry[0])
    ),
    restoredPlaytime: Object.fromEntries(
      Object.entries(backup.playtime ?? {}).filter(([appName]) =>
        restoredAppNames.has(appName)
      )
    ),
    restoredVndbMatches: Object.entries(backup.vndbMatches).filter(
      ([, match]) => restoredAppNames.has(match.appName)
    ),
    updated
  }
}

function getSideloadGameOverrides(
  games: GameInfo[]
): Record<string, GameMetadataOverride> {
  const sideloadAppNames = new Set(games.map((game) => game.app_name))

  return Object.fromEntries(
    Object.entries(getAllGameOverrides()).filter(([appName]) =>
      sideloadAppNames.has(appName)
    )
  )
}

export function getAllVndbMatches(): Record<string, VndbGameMatch> {
  return vndbMatchesStore.get('matches', {})
}

export async function backupMetadata(
  directoryPath: string,
  options: BackupSideloadLibraryMetadataOptions = {}
): Promise<string> {
  const includeSecrets = options.includeSecrets === true
  const games = libraryStore.get('games', [])
  const backup: SideloadLibraryMetadataBackup = {
    categories: getLocalLibraryCategories(games),
    exportedAt: new Date().toISOString(),
    gameSettings: await getLocalLibraryGameSettings(games),
    games,
    gameOverrides: getSideloadGameOverrides(games),
    localLibrarySettings: getLocalLibrarySettings(),
    playtime: getLocalLibraryPlaytime(games),
    vndbMatches: getAllVndbMatches(),
    version: 1
  }

  if (includeSecrets) {
    backup.steamGridDbApiKey = getSteamGridDbApiKey()
    backup.vndbApiToken = getDecryptedApiToken()
  }

  const backupPath = join(directoryPath, getBackupFileName())
  await writeFile(backupPath, JSON.stringify(backup, null, 2), {
    encoding: 'utf8',
    // The file contains plaintext secrets: keep it private to the user.
    ...(includeSecrets ? { mode: 0o600 } : {})
  })
  return backupPath
}

export async function inspectMetadataBackup(
  backupPath: string
): Promise<InspectSideloadLibraryMetadataBackupResult> {
  const backup = parseMetadataBackup(await readFile(backupPath, 'utf8'))
  const currentPathStyle = getCurrentPathStyle()
  const pathInfo = getBackupPathInfo(backup.games)

  return {
    ...pathInfo,
    currentPathStyle,
    shouldPromptForPath:
      pathInfo.backupPathStyle !== 'unknown' &&
      currentPathStyle !== 'unknown' &&
      pathInfo.backupPathStyle !== currentPathStyle
  }
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

/**
 * Snapshots the current state and returns the mutations needed to restore,
 * each paired with the action that undoes it. Nothing is written here.
 */
function createRestoreSteps(
  backup: SideloadLibraryMetadataBackup,
  restore: PreparedSideloadLibraryMetadataRestore
): { steps: RestoreStep[]; vndbMatches: Record<string, VndbGameMatch> } {
  const steps: RestoreStep[] = []

  const previousOverrides = getAllGameOverrides()
  const overrideSnapshot = restore.restoredOverrides.map(
    ([appName]): [string, GameMetadataOverride | undefined] => [
      appName,
      clone(previousOverrides[appName])
    ]
  )
  steps.push({
    name: 'game overrides',
    apply: () => {
      for (const [appName, override] of restore.restoredOverrides) {
        if (setGameOverrides(appName, override) === false) {
          throw new Error(`Could not save metadata overrides for ${appName}.`)
        }
      }
    },
    rollback: () => {
      for (const [appName, previous] of overrideSnapshot) {
        setGameOverrides(appName, previous ?? {})
      }
    }
  })

  const currentSettings = GlobalConfig.get().getSettings() as unknown as Record<
    string,
    unknown
  >
  const settingsSnapshot = restore.localLibrarySettings.applied.map(
    ([key]): [LocalLibrarySettingsKey, unknown] => [
      key,
      clone(currentSettings[key])
    ]
  )
  steps.push({
    name: 'local library settings',
    apply: () => {
      for (const [key, value] of restore.localLibrarySettings.applied) {
        GlobalConfig.get().setSetting(key as keyof AppSettings, value)
      }
    },
    rollback: () => {
      for (const [key, value] of settingsSnapshot) {
        GlobalConfig.get().setSetting(key as keyof AppSettings, value)
      }
    }
  })

  const { vndbApiToken, steamGridDbApiKey } = backup
  if (vndbApiToken) {
    const previousToken = getDecryptedApiToken()
    steps.push({
      name: 'VNDB token',
      apply: () => setStoredApiToken(vndbApiToken),
      rollback: () => setStoredApiToken(previousToken)
    })
  }

  if (steamGridDbApiKey) {
    // Raw stored value (already encrypted): put it back untouched.
    const storedKey = currentSettings.steamGridDbApiKey
    const previousKey = typeof storedKey === 'string' ? storedKey : ''
    steps.push({
      name: 'SteamGridDB API key',
      apply: () => setSteamGridDbApiKey(steamGridDbApiKey),
      rollback: () =>
        GlobalConfig.get().setSetting('steamGridDbApiKey', previousKey)
    })
  }

  const nextCategories = restore.categories
  if (nextCategories) {
    const previousCategories = clone(readStoredCategories())
    steps.push({
      name: 'categories',
      apply: () => {
        configStore.set(
          'games.customCategories',
          nextCategories.customCategories
        )
        configStore.set(
          'games.customCategoriesOrder',
          nextCategories.customCategoriesOrder
        )
      },
      rollback: () => {
        configStore.set(
          'games.customCategories',
          previousCategories.customCategories
        )
        configStore.set(
          'games.customCategoriesOrder',
          previousCategories.customCategoriesOrder
        )
      }
    })
  }

  const attemptedGameSettings: GameSettingsRestore[] = []
  steps.push({
    name: 'game settings',
    apply: async () => {
      for (const entry of restore.gameSettings) {
        attemptedGameSettings.push(entry)
        await writeConfig(entry.appName, entry.settings as Partial<AppSettings>)
      }
    },
    rollback: async () => {
      for (const { appName, previous } of [
        ...attemptedGameSettings
      ].reverse()) {
        await writeConfig(appName, (previous ?? {}) as Partial<AppSettings>)
      }
    }
  })

  const playtimeSnapshot = getPlaytimeRestoreKeys(restore.restoredPlaytime).map(
    (key): [string, unknown] => [key, clone(getStoredPlaytimeValue(key))]
  )
  steps.push({
    name: 'playtime',
    apply: () => restoreLocalLibraryPlaytime(restore.restoredPlaytime),
    rollback: () => {
      for (const [key, previous] of playtimeSnapshot) {
        setStoredPlaytimeValue(key, previous)
      }
    }
  })

  const previousGames = clone(libraryStore.get('games', []))
  steps.push({
    name: 'sideload library',
    apply: () => libraryStore.set('games', restore.restoredGames),
    rollback: () => libraryStore.set('games', previousGames)
  })

  const previousVndbMatches = clone(getAllVndbMatches())
  const vndbMatches = {
    ...previousVndbMatches,
    ...Object.fromEntries(restore.restoredVndbMatches)
  }
  steps.push({
    name: 'VNDB matches',
    apply: () => vndbMatchesStore.set('matches', vndbMatches),
    rollback: () => vndbMatchesStore.set('matches', previousVndbMatches)
  })

  return { steps, vndbMatches }
}

/**
 * Applies the steps in order. If one throws, every step that was started
 * (including the failing one, which may be partially applied) is undone in
 * reverse order and the original error is rethrown.
 */
async function runRestoreSteps(steps: RestoreStep[]): Promise<void> {
  const started: RestoreStep[] = []

  try {
    for (const step of steps) {
      started.push(step)
      await step.apply()
    }
  } catch (error) {
    for (const step of started.reverse()) {
      try {
        await step.rollback()
      } catch (rollbackError) {
        logError(
          `Could not roll back ${step.name} after a failed metadata restore: ${String(rollbackError)}`,
          'Sideload'
        )
      }
    }
    throw error
  }
}

export async function restoreMetadata(
  backupPath: string,
  options: RestoreSideloadLibraryMetadataOptions = {}
): Promise<RestoreSideloadLibraryMetadataResult> {
  // Stage: parse and compute everything before touching any store.
  const backup = parseMetadataBackup(await readFile(backupPath, 'utf8'))
  const restore = await prepareMetadataRestore(
    backup,
    libraryStore.get('games', []),
    options.pathMapping
  )
  const { steps, vndbMatches } = createRestoreSteps(backup, restore)

  // Commit: all or nothing.
  await runRestoreSteps(steps)

  sendFrontendMessage('metadataChanged', getAllGameOverrides())
  sendFrontendMessage('vndbMatchesChanged', vndbMatches)
  sendFrontendMessage('refreshLibrary', 'sideload')

  return {
    added: restore.added,
    categories: backup.categories
      ? Object.keys(backup.categories.customCategories).length
      : 0,
    customCategories: restore.categories,
    gameSettings: restore.gameSettings.length,
    updated: restore.updated,
    total: restore.restoredGames.length,
    overrides: restore.restoredOverrides.length,
    localLibrarySettings: restore.localLibrarySettings.effective,
    playtime: Object.keys(restore.restoredPlaytime).length,
    steamGridDbApiKey: Boolean(backup.steamGridDbApiKey),
    vndbApiToken: Boolean(backup.vndbApiToken),
    vndbMatches: restore.restoredVndbMatches.length
  }
}
