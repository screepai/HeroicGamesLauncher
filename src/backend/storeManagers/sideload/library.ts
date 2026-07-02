import { AppSettings, ExecResult, GameInfo } from 'common/types'
import { readFile, writeFile } from 'node:fs/promises'
import { readdirSync } from 'graceful-fs'
import { dirname, join, posix, win32 } from 'path'
import { libraryStore } from './electronStores'
import { logWarning } from 'backend/logger'
import { getMigratedExecutablePath } from 'backend/utils'
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

type LocalLibraryMetadataSettings = Pick<
  AppSettings,
  | 'askToDeleteArchiveAfterExtraction'
  | 'detectLocalLibraryArchives'
  | 'enableLocalLibraryWatcher'
  | 'localLibrarySyncExclusions'
>

type SideloadLibraryMetadataBackup = {
  exportedAt: string
  games: GameInfo[]
  gameOverrides: Record<string, GameMetadataOverride>
  localLibrarySettings: LocalLibraryMetadataSettings
  vndbApiToken: string
  vndbMatches: Record<string, VndbGameMatch>
  version: 1
}

type RestoreSideloadLibraryMetadataResult = {
  added: number
  updated: number
  total: number
  overrides: number
  localLibrarySettings?: LocalLibraryMetadataSettings
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

  return (
    comparableValue === comparableRoot ||
    comparableValue.startsWith(`${comparableRoot}${separator}`)
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
    detectLocalLibraryArchives: settings.detectLocalLibraryArchives,
    enableLocalLibraryWatcher: settings.enableLocalLibraryWatcher,
    localLibrarySyncExclusions: settings.localLibrarySyncExclusions
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

  if (typeof value.detectLocalLibraryArchives === 'boolean') {
    settings.detectLocalLibraryArchives = value.detectLocalLibraryArchives
  }

  if (typeof value.enableLocalLibraryWatcher === 'boolean') {
    settings.enableLocalLibraryWatcher = value.enableLocalLibraryWatcher
  }

  if (
    Array.isArray(value.localLibrarySyncExclusions) &&
    value.localLibrarySyncExclusions.every((rule) => typeof rule === 'string')
  ) {
    settings.localLibrarySyncExclusions = value.localLibrarySyncExclusions
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
    exportedAt:
      typeof parsed.exportedAt === 'string'
        ? parsed.exportedAt
        : new Date().toISOString(),
    games: parsed.games,
    gameOverrides: isRecord(parsed.gameOverrides)
      ? (parsed.gameOverrides as Record<string, GameMetadataOverride>)
      : {},
    localLibrarySettings:
      parseLocalLibrarySettings(parsed.localLibrarySettings) ??
      getLocalLibrarySettings(),
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
      exportedAt: new Date().toISOString(),
      games,
      gameOverrides: getSideloadGameOverrides(games),
      localLibrarySettings: getLocalLibrarySettings(),
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

    for (const [appName, override] of restoredOverrides) {
      setGameOverrides(appName, override)
    }

    for (const [key, value] of Object.entries(backup.localLibrarySettings)) {
      GlobalConfig.get().setSetting(key as keyof AppSettings, value)
    }

    if (backup.vndbApiToken) {
      setStoredApiToken(backup.vndbApiToken)
    }

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
      updated,
      total: restoredGames.length,
      overrides: restoredOverrides.length,
      localLibrarySettings: backup.localLibrarySettings,
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
