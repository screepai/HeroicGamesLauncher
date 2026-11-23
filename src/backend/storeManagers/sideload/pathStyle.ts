import { dirname, posix, win32 } from 'path'
import type { GameInfo, GameSettings } from 'common/types'
import { isLinux, isMac, isWindows } from 'backend/constants/environment'

export type PathStyle = 'windows' | 'posix' | 'unknown'

export type RestoreSideloadLibraryMetadataPathMapping = {
  sourcePath: string
  destinationPath: string
}

export type BackupPathInfo = {
  affectedGames: number
  backupPathStyle: PathStyle
  sourcePath?: string
}

export function getExecutableDir(executable: string): string {
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

export function getCurrentPathStyle(): PathStyle {
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

export function getBackupPathInfo(games: GameInfo[]): BackupPathInfo {
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

export function applyRestorePathMapping(
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

/**
 * Resolves a path-typed setting from a backup for the current machine.
 *
 * The path mapping is applied first. If the result still uses a path style
 * (Windows vs POSIX) that does not match the current OS it cannot be used
 * here, so `undefined` is returned and the caller must keep the target
 * machine's own value instead of writing a foreign path.
 */
export function resolveRestoredPath(
  value: string,
  pathMapping: RestoreSideloadLibraryMetadataPathMapping | undefined,
  currentPathStyle: PathStyle = getCurrentPathStyle()
): string | undefined {
  const mapped = (pathMapping && replacePathRoot(value, pathMapping)) ?? value
  const pathStyle = getPathStyle(mapped)

  if (
    pathStyle !== 'unknown' &&
    currentPathStyle !== 'unknown' &&
    pathStyle !== currentPathStyle
  ) {
    return undefined
  }

  return mapped
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

export const GAME_PATH_SETTINGS = [
  'winePrefix',
  'targetExe',
  'savesPath',
  'beforeLaunchScriptPath',
  'afterLaunchScriptPath'
] as const

const WINE_VERSION_OPTIONAL_PATHS = ['lib', 'lib32', 'wineserver'] as const

function resolveWineVersionPaths(
  wineVersion: Record<string, unknown>,
  pathMapping: RestoreSideloadLibraryMetadataPathMapping | undefined
): Record<string, unknown> | undefined {
  if (typeof wineVersion.bin !== 'string') {
    return undefined
  }

  const bin = resolveRestoredPath(wineVersion.bin, pathMapping)
  if (bin === undefined) {
    return undefined
  }

  const resolved: Record<string, unknown> = { ...wineVersion, bin }
  for (const key of WINE_VERSION_OPTIONAL_PATHS) {
    const value = wineVersion[key]
    if (typeof value !== 'string') {
      continue
    }

    const resolvedValue = resolveRestoredPath(value, pathMapping)
    if (resolvedValue === undefined) {
      delete resolved[key]
    } else {
      resolved[key] = resolvedValue
    }
  }

  return resolved
}

/**
 * Maps the path-typed per-game settings (wine prefix/binaries, scripts, ...)
 * to this machine. A path that cannot be mapped across OS path styles is not
 * written: the target machine's own value is kept (or the key is left unset).
 */
export function resolveGameSettingsPaths(
  settings: Partial<GameSettings>,
  current: Partial<GameSettings> | undefined,
  pathMapping: RestoreSideloadLibraryMetadataPathMapping | undefined
): Partial<GameSettings> {
  const resolved: Record<string, unknown> = { ...settings }
  const keepCurrent = (key: string) => {
    if (current && key in current) {
      resolved[key] = (current as Record<string, unknown>)[key]
    } else {
      delete resolved[key]
    }
  }

  for (const key of GAME_PATH_SETTINGS) {
    const value = resolved[key]
    if (typeof value !== 'string') {
      continue
    }

    const resolvedValue = resolveRestoredPath(value, pathMapping)
    if (resolvedValue === undefined) {
      keepCurrent(key)
    } else {
      resolved[key] = resolvedValue
    }
  }

  if (isRecord(resolved.wineVersion)) {
    const wineVersion = resolveWineVersionPaths(
      resolved.wineVersion,
      pathMapping
    )
    if (wineVersion) {
      resolved.wineVersion = wineVersion
    } else {
      keepCurrent('wineVersion')
    }
  }

  return resolved as Partial<GameSettings>
}
