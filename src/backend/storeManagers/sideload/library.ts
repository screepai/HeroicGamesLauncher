import { AppSettings, ExecResult, GameInfo, GameSettings } from 'common/types'
import { readFile, writeFile } from 'node:fs/promises'
import { readdirSync } from 'graceful-fs'
import { dirname, join, posix, win32 } from 'path'
import { libraryStore } from './electronStores'
import { logWarning } from 'backend/logger'
import { getMigratedExecutablePath, writeConfig } from 'backend/utils'
import { addShortcuts } from 'backend/shortcuts/shortcuts/shortcuts'
import { sendFrontendMessage } from 'backend/ipc'
import { isLinux, isMac, isWindows } from 'backend/constants/environment'
import { LibraryManager } from 'common/types/game_manager'
import { getAllGameOverrides, setGameOverrides } from 'backend/game_overrides'
import type { GameMetadataOverride } from 'backend/game_overrides/electronStores'
import { vndbMatchesStore } from 'backend/vndb/electronStore'
import { getDecryptedApiToken, setStoredApiToken } from 'backend/vndb/client'
import { GlobalConfig } from 'backend/config'
import type { VndbGameMatch } from 'common/types/vndb'
import SideloadGame from './games'
import { configStore, tsStore } from 'backend/constants/key_value_stores'
import { gamesConfigPath } from 'backend/constants/paths'
import {
  decryptApiKey,
  encryptApiKey,
  isEncryptedValue
} from 'backend/steamgrid/secureKey'

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
  steamGridDbApiKey: string
  vndbApiToken: string
  vndbMatches: Record<string, VndbGameMatch>
  version: 1
}

type RestoreSideloadLibraryMetadataResult = {
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

type PathStyle = 'windows' | 'posix' | 'unknown'

type RestoreSideloadLibraryMetadataPathMapping = {
  sourcePath: string
  destinationPath: string
}

type RestoreSideloadLibraryMetadataOptions = {
  pathMapping?: RestoreSideloadLibraryMetadataPathMapping
}

type InspectSideloadLibraryMetadataBackupResult = {
  affectedGames: number
  backupPathStyle: PathStyle
  currentPathStyle: PathStyle
  sourcePath?: string
  shouldPromptForPath: boolean
}

function getExecutableDir(executable: string): string {
  const pathStyle = getPathStyle(executable)

  if (pathStyle === 'windows') {
    return win32.dirname(normalizePathSeparators(executable, pathStyle))
  }

  if (pathStyle === 'posix') {
    return posix.dirname(normalizePathSeparators(executable, pathStyle))
  }

  const usesBackslash = executable.includes('\\')
  const executableDir = dirname(executable.replaceAll('\\', '/'))
  return usesBackslash ? executableDir.replaceAll('/', '\\') : executableDir
}

function getBackupFileName(): string {
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-')
  return `heroic-local-library-metadata-${timestamp}.json`
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function getCurrentPathStyle(): PathStyle {
  if (isWindows) {
    return 'windows'
  }

  if (isLinux || isMac) {
    return 'posix'
  }

  return 'unknown'
}

function getPathStyle(value: string | undefined): PathStyle {
  if (!value) {
    return 'unknown'
  }

  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\')) {
    return 'windows'
  }

  if (value.startsWith('/')) {
    return 'posix'
  }

  return 'unknown'
}

function normalizePathSeparators(value: string, pathStyle: PathStyle): string {
  if (pathStyle === 'windows') {
    return value.replaceAll('/', '\\')
  }

  if (pathStyle === 'posix') {
    return value.replaceAll('\\', '/')
  }

  return value
}

function trimTrailingSeparators(value: string, pathStyle: PathStyle): string {
  const separator = pathStyle === 'windows' ? '\\' : '/'
  let normalized = normalizePathSeparators(value, pathStyle)

  while (normalized.length > 1 && normalized.endsWith(separator)) {
    if (pathStyle === 'windows' && /^[a-zA-Z]:\\$/.test(normalized)) {
      break
    }
    normalized = normalized.slice(0, -1)
  }

  return normalized
}

function getComparablePath(value: string, pathStyle: PathStyle): string {
  const normalized = trimTrailingSeparators(value, pathStyle)
  return pathStyle === 'windows' ? normalized.toLowerCase() : normalized
}

function pathStartsWithRoot(
  value: string,
  root: string,
  pathStyle: PathStyle
): boolean {
  const separator = pathStyle === 'windows' ? '\\' : '/'
  const comparableValue = getComparablePath(value, pathStyle)
  const comparableRoot = getComparablePath(root, pathStyle)
  const comparableRootWithSeparator = comparableRoot.endsWith(separator)
    ? comparableRoot
    : `${comparableRoot}${separator}`

  return (
    comparableValue === comparableRoot ||
    comparableValue.startsWith(comparableRootWithSeparator)
  )
}

function getGameRootPath(game: GameInfo): string | undefined {
  return (
    game.install.install_path ||
    game.folder_name ||
    (game.install.executable
      ? getExecutableDir(game.install.executable)
      : undefined)
  )
}

function splitPathSegments(value: string, pathStyle: PathStyle): string[] {
  const normalized = trimTrailingSeparators(value, pathStyle)
  const separator = pathStyle === 'windows' ? '\\' : '/'

  return normalized
    .replace(/^[\\/]+/, '')
    .split(separator)
    .filter(Boolean)
}

function joinPathSegments(
  segments: string[],
  pathStyle: PathStyle,
  absolute: boolean
): string | undefined {
  if (!segments.length) {
    return undefined
  }

  if (pathStyle === 'windows') {
    if (segments.length === 1 && /^[a-zA-Z]:$/.test(segments[0])) {
      return `${segments[0]}\\`
    }
    return segments.join('\\')
  }

  const joined = segments.join('/')
  return absolute ? `/${joined}` : joined
}

function getCommonPathRoot(
  paths: string[],
  pathStyle: PathStyle
): string | undefined {
  if (!paths.length || pathStyle === 'unknown') {
    return undefined
  }

  if (paths.length === 1) {
    return trimTrailingSeparators(paths[0], pathStyle)
  }

  const pathSegments = paths.map((path) => splitPathSegments(path, pathStyle))
  const commonSegments: string[] = []
  const firstSegments = pathSegments[0]

  for (let index = 0; index < firstSegments.length; index += 1) {
    const segment = firstSegments[index]
    const comparableSegment =
      pathStyle === 'windows' ? segment.toLowerCase() : segment
    const isCommon = pathSegments.every((segments) => {
      const candidate = segments[index]
      return (
        candidate !== undefined &&
        (pathStyle === 'windows' ? candidate.toLowerCase() : candidate) ===
          comparableSegment
      )
    })

    if (!isCommon) {
      break
    }

    commonSegments.push(segment)
  }

  return joinPathSegments(commonSegments, pathStyle, paths[0].startsWith('/'))
}

function getBackupPathInfo(
  games: GameInfo[]
): Pick<
  InspectSideloadLibraryMetadataBackupResult,
  'affectedGames' | 'backupPathStyle' | 'sourcePath'
> {
  const rootsByStyle: Record<Exclude<PathStyle, 'unknown'>, string[]> = {
    posix: [],
    windows: []
  }

  for (const game of games) {
    const rootPath = getGameRootPath(game)
    const pathStyle = getPathStyle(rootPath)

    if (rootPath && pathStyle !== 'unknown') {
      rootsByStyle[pathStyle].push(rootPath)
    }
  }

  const backupPathStyle =
    rootsByStyle.windows.length >= rootsByStyle.posix.length &&
    rootsByStyle.windows.length > 0
      ? 'windows'
      : rootsByStyle.posix.length > 0
        ? 'posix'
        : 'unknown'

  if (backupPathStyle === 'unknown') {
    return {
      affectedGames: 0,
      backupPathStyle
    }
  }

  return {
    affectedGames: rootsByStyle[backupPathStyle].length,
    backupPathStyle,
    sourcePath: getCommonPathRoot(
      rootsByStyle[backupPathStyle],
      backupPathStyle
    )
  }
}

function replacePathRoot(
  value: string | undefined,
  pathMapping: RestoreSideloadLibraryMetadataPathMapping
): string | undefined {
  if (!value) {
    return value
  }

  const sourcePathStyle = getPathStyle(pathMapping.sourcePath)
  if (
    sourcePathStyle === 'unknown' ||
    getPathStyle(value) !== sourcePathStyle ||
    !pathStartsWithRoot(value, pathMapping.sourcePath, sourcePathStyle)
  ) {
    return value
  }

  const sourcePath = trimTrailingSeparators(
    pathMapping.sourcePath,
    sourcePathStyle
  )
  const normalizedValue = normalizePathSeparators(value, sourcePathStyle)
  const suffix = normalizedValue.slice(sourcePath.length).replace(/^[\\/]+/, '')

  if (!suffix) {
    return pathMapping.destinationPath
  }

  const destinationPathStyle =
    getPathStyle(pathMapping.destinationPath) === 'unknown'
      ? getCurrentPathStyle()
      : getPathStyle(pathMapping.destinationPath)
  const destinationSeparator = destinationPathStyle === 'windows' ? '\\' : '/'
  const destinationPath = trimTrailingSeparators(
    pathMapping.destinationPath,
    destinationPathStyle
  )
  const destinationSuffix = normalizePathSeparators(
    suffix,
    destinationPathStyle
  )

  return `${destinationPath}${destinationSeparator}${destinationSuffix}`
}

function applyRestorePathMapping(
  game: GameInfo,
  pathMapping: RestoreSideloadLibraryMetadataPathMapping | undefined
): GameInfo {
  if (!pathMapping) {
    return game
  }

  return {
    ...game,
    folder_name: replacePathRoot(game.folder_name, pathMapping),
    install: {
      ...game.install,
      executable: replacePathRoot(game.install.executable, pathMapping),
      install_path: replacePathRoot(game.install.install_path, pathMapping)
    }
  }
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

function isVndbGameMatch(value: unknown): value is VndbGameMatch {
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

function getSteamGridDbApiKey(): string {
  const stored = GlobalConfig.get().getSettings().steamGridDbApiKey ?? ''

  if (!stored) {
    return ''
  }

  return isEncryptedValue(stored) ? decryptApiKey(stored) : stored
}

function setSteamGridDbApiKey(apiKey: string): void {
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

async function readGameSettingsBackup(
  appName: string
): Promise<Partial<GameSettings> | undefined> {
  const rawConfig = await readFile(
    join(gamesConfigPath, `${appName}.json`),
    'utf8'
  ).catch(() => undefined)

  if (!rawConfig) {
    return undefined
  }

  const parsed: unknown = JSON.parse(rawConfig)

  if (!isRecord(parsed) || !isRecord(parsed[appName])) {
    return undefined
  }

  return parsed[appName] as Partial<GameSettings>
}

async function getLocalLibraryGameSettings(
  games: GameInfo[]
): Promise<Record<string, Partial<GameSettings>>> {
  const settings = await Promise.all(
    games.map(async (game) => [
      game.app_name,
      await readGameSettingsBackup(game.app_name).catch(() => undefined)
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

function restoreLocalLibraryGameSettings(
  gameSettings: Record<string, Partial<GameSettings>>,
  restoredAppNames: Set<string>
): void {
  for (const [appName, settings] of Object.entries(gameSettings)) {
    if (restoredAppNames.has(appName)) {
      writeConfig(appName, settings as Partial<AppSettings>)
    }
  }
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

function restoreLocalLibraryCategories(
  categories: LocalLibraryMetadataCategories,
  games: GameInfo[]
): LocalLibraryMetadataCategories {
  const restoredGameIds = new Set(games.map(getSideloadGameCategoryId))
  const storedCategories = configStore.get('games.customCategories', {})
  const currentCategories = isRecord(storedCategories) ? storedCategories : {}
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

  const storedCategoryOrder = configStore.get('games.customCategoriesOrder', [])
  const currentCategoryOrder = Array.isArray(storedCategoryOrder)
    ? storedCategoryOrder.filter(
        (category): category is string => typeof category === 'string'
      )
    : []
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

  configStore.set('games.customCategories', nextCategories)
  configStore.set('games.customCategoriesOrder', nextCategoryOrder)

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
    steamGridDbApiKey:
      typeof parsed.steamGridDbApiKey === 'string'
        ? parsed.steamGridDbApiKey
        : '',
    vndbApiToken:
      typeof parsed.vndbApiToken === 'string' ? parsed.vndbApiToken : '',
    vndbMatches,
    version: 1
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

function getAllVndbMatches(): Record<string, VndbGameMatch> {
  return vndbMatchesStore.get('matches', {})
}

export default class SideloadLibraryManager implements LibraryManager {
  init = () => Promise.resolve()

  getGame(id: string): SideloadGame {
    return new SideloadGame(id)
  }

  addNewApp({
    app_name,
    title,
    install: { executable, platform },
    art_cover,
    art_square,
    browserUrl,
    is_installed = true,
    description,
    customUserAgent,
    launchFullScreen,
    isVisualNovel
  }: GameInfo): void {
    const current = libraryStore.get('games', [])
    const gameIndex = current.findIndex((value) => value.app_name === app_name)
    const installedAt =
      gameIndex === -1
        ? new Date().toISOString()
        : current[gameIndex].install.installed_at
    const game: GameInfo = {
      runner: 'sideload',
      app_name,
      title,
      install: {
        executable,
        installed_at: installedAt,
        platform,
        is_dlc: false
      },
      folder_name:
        executable !== undefined ? getExecutableDir(executable) : undefined,
      art_cover,
      is_installed: is_installed !== undefined ? is_installed : true,
      art_square,
      canRunOffline: !browserUrl,
      browserUrl,
      description,
      customUserAgent,
      launchFullScreen,
      isVisualNovel
    }

    if (isMac && executable?.endsWith('.app')) {
      const macAppExecutable = readdirSync(
        join(executable, 'Contents', 'MacOS')
      )[0]
      game.install.executable = join(
        executable,
        'Contents',
        'MacOS',
        macAppExecutable
      )
    }

    // edit app in case it exists
    if (gameIndex !== -1) {
      current[gameIndex] = { ...current[gameIndex], ...game }
    } else {
      current.push(game)
      addShortcuts(new SideloadGame(app_name))
    }

    libraryStore.set('games', current)

    sendFrontendMessage('refreshLibrary', 'sideload')

    return
  }

  installState() {
    logWarning(`installState not implemented on Sideload Library Manager`)
  }

  async refresh() {
    logWarning(`refresh not implemented on Sideload Library Manager`)
    return null
  }

  async backupMetadata(directoryPath: string): Promise<string> {
    const games = libraryStore.get('games', [])
    const backup: SideloadLibraryMetadataBackup = {
      categories: getLocalLibraryCategories(games),
      exportedAt: new Date().toISOString(),
      gameSettings: await getLocalLibraryGameSettings(games),
      games,
      gameOverrides: getSideloadGameOverrides(games),
      localLibrarySettings: getLocalLibrarySettings(),
      playtime: getLocalLibraryPlaytime(games),
      steamGridDbApiKey: getSteamGridDbApiKey(),
      vndbApiToken: getDecryptedApiToken(),
      vndbMatches: getAllVndbMatches(),
      version: 1
    }

    const backupPath = join(directoryPath, getBackupFileName())
    await writeFile(backupPath, JSON.stringify(backup, null, 2), 'utf8')
    return backupPath
  }

  async inspectMetadataBackup(
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

  async restoreMetadata(
    backupPath: string,
    options: RestoreSideloadLibraryMetadataOptions = {}
  ): Promise<RestoreSideloadLibraryMetadataResult> {
    const backup = parseMetadataBackup(await readFile(backupPath, 'utf8'))
    const backupGames = backup.games.map((game) =>
      applyRestorePathMapping(game, options.pathMapping)
    )
    const currentGames = libraryStore.get('games', [])
    const currentByAppName = new Map(
      currentGames.map((game) => [game.app_name, game])
    )
    let added = 0
    let updated = 0

    for (const game of backupGames) {
      if (currentByAppName.has(game.app_name)) {
        updated += 1
      } else {
        added += 1
      }
      currentByAppName.set(game.app_name, game)
    }

    const restoredAppNames = new Set(backupGames.map((game) => game.app_name))
    const restoredOverrides = Object.entries(backup.gameOverrides).filter(
      ([appName]) => restoredAppNames.has(appName)
    )
    const restoredVndbMatches = Object.entries(backup.vndbMatches)
    const restoredCategoryCount = backup.categories
      ? Object.keys(backup.categories.customCategories).length
      : 0
    const restoredGameSettings = Object.entries(
      backup.gameSettings ?? {}
    ).filter(([appName]) => restoredAppNames.has(appName))
    const restoredPlaytime = Object.fromEntries(
      Object.entries(backup.playtime ?? {}).filter(([appName]) =>
        restoredAppNames.has(appName)
      )
    )
    let restoredCategories: LocalLibraryMetadataCategories | undefined

    for (const [appName, override] of restoredOverrides) {
      setGameOverrides(appName, override)
    }

    for (const [key, value] of Object.entries(backup.localLibrarySettings)) {
      GlobalConfig.get().setSetting(key as keyof AppSettings, value)
    }

    if (backup.vndbApiToken) {
      setStoredApiToken(backup.vndbApiToken)
    }

    if (backup.steamGridDbApiKey) {
      setSteamGridDbApiKey(backup.steamGridDbApiKey)
    }

    if (backup.categories) {
      restoredCategories = restoreLocalLibraryCategories(
        backup.categories,
        backupGames
      )
    }

    restoreLocalLibraryGameSettings(
      Object.fromEntries(restoredGameSettings),
      restoredAppNames
    )
    restoreLocalLibraryPlaytime(restoredPlaytime)

    const currentVndbMatches = vndbMatchesStore.get('matches', {})
    for (const [key, match] of restoredVndbMatches) {
      currentVndbMatches[key] = match
    }

    const restoredGames = [...currentByAppName.values()]
    libraryStore.set('games', restoredGames)
    vndbMatchesStore.set('matches', currentVndbMatches)
    sendFrontendMessage('metadataChanged', getAllGameOverrides())
    sendFrontendMessage('vndbMatchesChanged', currentVndbMatches)
    sendFrontendMessage('refreshLibrary', 'sideload')

    return {
      added,
      categories: restoredCategoryCount,
      customCategories: restoredCategories,
      gameSettings: restoredGameSettings.length,
      updated,
      total: restoredGames.length,
      overrides: restoredOverrides.length,
      localLibrarySettings: backup.localLibrarySettings,
      playtime: Object.keys(restoredPlaytime).length,
      steamGridDbApiKey: Boolean(backup.steamGridDbApiKey),
      vndbApiToken: Boolean(backup.vndbApiToken),
      vndbMatches: restoredVndbMatches.length
    }
  }

  getGameInfo(): GameInfo {
    logWarning(`getGameInfo not implemented on Sideload Library Manager`)
    return {
      app_name: '',
      runner: 'sideload',
      art_cover: '',
      art_square: '',
      install: {},
      is_installed: false,
      title: '',
      canRunOffline: false
    }
  }

  async listUpdateableGames(): Promise<string[]> {
    logWarning(
      `listUpdateableGames not implemented on Sideload Library Manager`
    )
    return []
  }

  async runRunnerCommand(): Promise<ExecResult> {
    logWarning(`runRunnerCommand not implemented on Sideload Library Manager`)
    return { stdout: '', stderr: '' }
  }

  async changeGameInstallPath(appName: string, newPath: string): Promise<void> {
    const current = libraryStore.get('games', [])
    const gameIndex = current.findIndex((value) => value.app_name === appName)
    if (gameIndex === -1) {
      logWarning(`sideload game not found in changeGameInstallPath: ${appName}`)
      return
    }

    const oldPath =
      current[gameIndex].install.install_path ||
      current[gameIndex].folder_name ||
      (current[gameIndex].install.executable
        ? getExecutableDir(current[gameIndex].install.executable)
        : undefined)

    current[gameIndex] = {
      ...current[gameIndex],
      folder_name: newPath,
      install: {
        ...current[gameIndex].install,
        executable: getMigratedExecutablePath(
          current[gameIndex].install.executable,
          oldPath,
          newPath
        ),
        install_path: newPath
      }
    }
    libraryStore.set('games', current)
    sendFrontendMessage('refreshLibrary', 'sideload')
  }

  async getInstallInfo(): Promise<undefined> {
    logWarning(`getInstallInfo not implemented on Sideload Library Manager`)
    return undefined
  }

  getLaunchOptions = () => []

  changeVersionPinnedStatus() {
    logWarning(
      'changeVersionPinnedStatus not implemented on Sideload Library Manager'
    )
  }
}
