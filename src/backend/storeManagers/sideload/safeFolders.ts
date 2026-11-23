import { app } from 'electron'
import { homedir } from 'os'
import { parse, relative, resolve, isAbsolute } from 'path'

import { GlobalConfig } from 'backend/config'
import { isWindows } from 'backend/constants/environment'

type ElectronPathName = Parameters<typeof app.getPath>[0]

const PROTECTED_ELECTRON_PATHS: ElectronPathName[] = [
  'home',
  'desktop',
  'documents',
  'downloads',
  'music',
  'pictures',
  'videos',
  'appData',
  'userData',
  'temp'
]

function normalize(path: string): string {
  const resolved = resolve(path)
  return isWindows ? resolved.toLowerCase() : resolved
}

/** True when `path` is `other` or one of its parent folders. */
function containsOrEquals(path: string, other: string): boolean {
  const rel = relative(normalize(path), normalize(other))
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}

function getProtectedFolders(): string[] {
  const folders: string[] = [homedir()]

  for (const name of PROTECTED_ELECTRON_PATHS) {
    try {
      folders.push(app.getPath(name))
    } catch {
      // Not every path exists on every platform
    }
  }

  try {
    const settings = GlobalConfig.get().getSettings()
    // Folders that hold many games: removing one of them removes them all.
    for (const folder of [
      settings.localLibrarySyncPath,
      settings.defaultInstallPath,
      settings.defaultWinePrefixDir
    ]) {
      if (typeof folder === 'string' && folder.trim()) {
        folders.push(folder)
      }
    }
  } catch {
    // Settings are not available (for example in tests)
  }

  return folders
}

/**
 * Returns why `folder` must not be deleted or moved as a whole for one game,
 * or undefined when it is safe. A folder is unsafe when it is a drive or
 * filesystem root, a user/system folder such as Downloads or the home folder
 * (or a parent of one), or a folder that holds the whole library.
 */
export function getUnsafeGameFolderReason(folder: string): string | undefined {
  if (!folder.trim()) {
    return 'the folder path is empty'
  }

  const resolved = resolve(folder)
  if (parse(resolved).root === resolved) {
    return `"${resolved}" is a drive or filesystem root`
  }

  const protectedFolder = getProtectedFolders().find((other) =>
    containsOrEquals(resolved, other)
  )
  if (protectedFolder) {
    return `"${resolved}" is or contains "${resolve(protectedFolder)}"`
  }

  return undefined
}
