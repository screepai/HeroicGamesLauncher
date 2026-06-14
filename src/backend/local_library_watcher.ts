import { type Dirent, type FSWatcher, promises as fs, watch } from 'fs'
import { basename, dirname, join, resolve } from 'path'

import { backendEvents } from './backend_events'
import { GlobalConfig } from './config'
import { sendFrontendMessage } from './ipc'
import {
  getArchiveExtension,
  getArchivePart,
  getArchiveTitle
} from './local_library_archive'
import {
  localLibraryWatcherState,
  type LocalLibraryWatcherState
} from './local_library_watcher_state'
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
          (entry.isFile() &&
            getArchiveExtension(entry.name) !== undefined &&
            (getArchivePart(entry.name)?.partNumber ?? 1) === 1)
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
  private suppressedEntries = new Set<string>()
  private exclusionRules: string[] = []
  private watcher: FSWatcher | undefined
  private reconcileTimeout: NodeJS.Timeout | undefined
  private revision = 0

  constructor(
    private readonly onFolderAdded: (folder: LocalLibraryFolder) => void,
    private readonly state: LocalLibraryWatcherState = localLibraryWatcherState
  ) {}

  setExclusionRules(exclusionRules: string[]): void {
    this.exclusionRules = exclusionRules
  }

  suppressPath(path: string): void {
    if (this.rootPath && dirname(resolve(path)) === resolve(this.rootPath)) {
      const entryName = basename(path)
      this.knownEntries.add(entryName)
      this.suppressedEntries.add(entryName)
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
    const currentEntries = getLibraryEntryNames(entries)
    this.knownEntries = currentEntries

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
      return
    }

    const previousEntries = await this.state.load(nextRootPath)
    if (revision !== this.revision) {
      return
    }

    if (previousEntries) {
      this.reportAddedEntries(
        getAddedEntryNames(previousEntries, currentEntries, this.exclusionRules)
      )
    }
    await this.state.save(nextRootPath, new Set(this.knownEntries))
    if (revision !== this.revision) {
      return
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
    this.suppressedEntries = new Set()
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
    ).filter((entryName) => !this.suppressedEntries.has(entryName))

    for (const entryName of this.suppressedEntries) {
      if (currentEntries.has(entryName)) {
        this.suppressedEntries.delete(entryName)
      }
    }

    this.knownEntries = currentEntries
    this.reportAddedEntries(addedEntries)
    await this.state.save(watchedRootPath, currentEntries)
  }

  private reportAddedEntries(entryNames: string[]): void {
    for (const entryName of entryNames) {
      const archiveExtension = getArchiveExtension(entryName)
      this.onFolderAdded({
        folderPath: join(this.rootPath, entryName),
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
