import { type Dirent, type FSWatcher, promises as fs, watch } from 'fs'
import { basename, dirname, join, resolve } from 'path'

import { backendEvents } from './backend_events'
import { GlobalConfig } from './config'
import { sendFrontendMessage } from './ipc'
import { getArchiveExtension, getArchiveTitle } from './local_library_archive'
import { logWarning, LogPrefix } from './logger'

type LocalLibraryFolder = {
  folderPath: string
  isArchive: boolean
  title: string
}

const WATCH_DEBOUNCE_MS = 500

function getLibraryEntryNames(entries: Dirent[]): Set<string> {
  return new Set(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() ||
          (entry.isFile() && getArchiveExtension(entry.name) !== undefined)
      )
      .map((entry) => entry.name)
  )
}

function getAddedEntryNames(
  previousEntries: Set<string>,
  currentEntries: Set<string>,
  exclusionRules: string[] = []
): string[] {
  return [...currentEntries].filter(
    (entry) =>
      !previousEntries.has(entry) &&
      !matchesExclusionRule(entry, exclusionRules)
  )
}

function wildcardToRegExp(pattern: string): RegExp {
  const escapedPattern = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('*', '.*')
    .replaceAll('?', '.')

  return new RegExp(`^${escapedPattern}$`, 'i')
}

function matchesExclusionRule(
  directoryName: string,
  exclusionRules: string[]
): boolean {
  return exclusionRules.some((rule) => {
    const pattern = rule.trim()
    return pattern.length > 0 && wildcardToRegExp(pattern).test(directoryName)
  })
}

class LocalLibraryWatcher {
  private rootPath = ''
  private knownEntries = new Set<string>()
  private exclusionRules: string[] = []
  private watcher: FSWatcher | undefined
  private reconcileTimeout: NodeJS.Timeout | undefined
  private revision = 0

  constructor(
    private readonly onFolderAdded: (folder: LocalLibraryFolder) => void
  ) {}

  setExclusionRules(exclusionRules: string[]): void {
    this.exclusionRules = exclusionRules
  }

  suppressPath(path: string): void {
    if (this.rootPath && dirname(resolve(path)) === resolve(this.rootPath)) {
      this.knownEntries.add(basename(path))
    }
  }

  async setPath(rootPath: string): Promise<void> {
    this.stop()
    const revision = this.revision

    const nextRootPath = rootPath.trim()
    if (!nextRootPath) {
      return
    }

    let entries: Dirent[]
    try {
      entries = await fs.readdir(nextRootPath, { withFileTypes: true })
    } catch (error) {
      logWarning(
        [`Unable to watch local library path "${nextRootPath}":`, error],
        LogPrefix.Backend
      )
      return
    }

    if (revision !== this.revision) {
      return
    }

    this.rootPath = nextRootPath
    this.knownEntries = getLibraryEntryNames(entries)

    try {
      this.watcher = watch(nextRootPath, () => this.scheduleReconcile())
      this.watcher.on('error', (error) => {
        if (revision !== this.revision) {
          return
        }

        logWarning(
          [`Local library watcher failed for "${nextRootPath}":`, error],
          LogPrefix.Backend
        )
        this.stop()
      })
    } catch (error) {
      logWarning(
        [`Unable to start local library watcher for "${nextRootPath}":`, error],
        LogPrefix.Backend
      )
      this.stop()
    }
  }

  stop(): void {
    this.revision += 1

    if (this.reconcileTimeout) {
      clearTimeout(this.reconcileTimeout)
      this.reconcileTimeout = undefined
    }

    this.watcher?.close()
    this.watcher = undefined
    this.rootPath = ''
    this.knownEntries = new Set()
  }

  private scheduleReconcile(): void {
    if (this.reconcileTimeout) {
      clearTimeout(this.reconcileTimeout)
    }

    this.reconcileTimeout = setTimeout(() => {
      this.reconcileTimeout = undefined
      void this.reconcile()
    }, WATCH_DEBOUNCE_MS)
  }

  private async reconcile(): Promise<void> {
    const watchedRootPath = this.rootPath
    const watchedRevision = this.revision
    if (!watchedRootPath) {
      return
    }

    let entries: Dirent[]
    try {
      entries = await fs.readdir(watchedRootPath, { withFileTypes: true })
    } catch (error) {
      logWarning(
        [`Unable to read local library path "${watchedRootPath}":`, error],
        LogPrefix.Backend
      )
      return
    }

    if (
      watchedRootPath !== this.rootPath ||
      watchedRevision !== this.revision
    ) {
      return
    }

    const currentEntries = getLibraryEntryNames(entries)
    const addedEntries = getAddedEntryNames(
      this.knownEntries,
      currentEntries,
      this.exclusionRules
    )
    this.knownEntries = currentEntries

    for (const entryName of addedEntries) {
      const archiveExtension = getArchiveExtension(entryName)
      this.onFolderAdded({
        folderPath: join(watchedRootPath, entryName),
        isArchive: archiveExtension !== undefined,
        title: archiveExtension ? getArchiveTitle(entryName) : entryName
      })
    }
  }
}

const localLibraryWatcher = new LocalLibraryWatcher((folder) => {
  sendFrontendMessage('localLibraryFolderAdded', folder)
})

let initialized = false

function suppressLocalLibraryPath(path: string): void {
  localLibraryWatcher.suppressPath(path)
}

function initLocalLibraryWatcher(): void {
  if (initialized) {
    return
  }
  initialized = true

  const settings = GlobalConfig.get().getSettings()
  localLibraryWatcher.setExclusionRules(settings.localLibrarySyncExclusions)
  void localLibraryWatcher.setPath(settings.localLibrarySyncPath)

  backendEvents.on('settingChanged', ({ key, newValue }) => {
    if (key === 'localLibrarySyncExclusions') {
      localLibraryWatcher.setExclusionRules(
        Array.isArray(newValue)
          ? newValue.filter((rule): rule is string => typeof rule === 'string')
          : []
      )
    }

    if (key === 'localLibrarySyncPath') {
      void localLibraryWatcher.setPath(
        typeof newValue === 'string' ? newValue : ''
      )
    }
  })
}

export {
  getAddedEntryNames,
  getArchiveExtension,
  getArchiveTitle as getEntryTitle,
  getLibraryEntryNames,
  initLocalLibraryWatcher,
  LocalLibraryWatcher,
  matchesExclusionRule,
  suppressLocalLibraryPath
}
