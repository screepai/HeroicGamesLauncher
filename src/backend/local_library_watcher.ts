import { type Dirent, type FSWatcher, promises as fs, watch } from 'fs'
import { basename, dirname, join, resolve } from 'path'

import { backendEvents } from './backend_events'
import { GlobalConfig } from './config'
import { addHandler, sendFrontendMessage } from './ipc'
import {
  getArchiveExtension,
  getArchivePart,
  getArchiveTitle
} from './local_library_archive'
import {
  localLibraryWatcherState,
  type LocalLibraryWatcherQueuedEntry,
  type LocalLibraryWatcherState
} from './local_library_watcher_state'
import { isWindows } from './constants/environment'
import { logWarning, LogPrefix } from './logger'

type LocalLibraryFolder = {
  folderPath: string
  isArchive: boolean
  title: string
}

type LocalLibraryWatcherOptions = {
  caseInsensitiveNames?: boolean
  entryStableChecks?: number
  entryStabilityIntervalMs?: number
  entryStabilityMaxAttempts?: number
  maxConcurrentStabilityChecks?: number
  watchDebounceMs?: number
  watchPollIntervalMs?: number
}

type EntryStabilitySignature = string | null | undefined

const WATCH_DEBOUNCE_MS = 500
const ENTRY_STABILITY_INTERVAL_MS = 1000
const ENTRY_STABLE_CHECKS = 2
const MAX_CONCURRENT_STABILITY_CHECKS = 2
const WATCH_POLL_INTERVAL_MS = 5000
// Gives up on an entry that never settles (about 30 minutes with the default
// interval) instead of polling it forever.
const ENTRY_STABILITY_MAX_ATTEMPTS = 1800
const SET_PATH_DEBOUNCE_MS = 200

function getLibraryEntryNames(
  entries: Dirent[],
  detectArchives = true
): Set<string> {
  return new Set(
    entries
      .filter(
        (entry) =>
          entry.isDirectory() ||
          (detectArchives &&
            entry.isFile() &&
            getArchiveExtension(entry.name) !== undefined &&
            (getArchivePart(entry.name)?.partNumber ?? 1) === 1)
      )
      .map((entry) => entry.name)
  )
}

function getAddedEntryNames(
  previousEntries: Set<string>,
  currentEntries: Set<string>,
  exclusionRules: string[] = [],
  caseInsensitive = false
): string[] {
  const toKey = (name: string) => (caseInsensitive ? name.toLowerCase() : name)
  const previousKeys = new Set([...previousEntries].map(toKey))

  return [...currentEntries].filter(
    (entry) =>
      !previousKeys.has(toKey(entry)) &&
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

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

function getErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

async function getDirectoryStabilitySignature(
  directoryPath: string
): Promise<string> {
  const signatureParts: string[] = []

  async function collectEntrySignature(
    entryPath: string,
    relativePath: string
  ): Promise<void> {
    const stats = await fs.lstat(entryPath)
    const type = stats.isDirectory() ? 'directory' : 'file'
    signatureParts.push(
      `${relativePath}\0${type}\0${stats.size}\0${stats.mtimeMs}`
    )

    if (!stats.isDirectory()) {
      return
    }

    const entries = await fs.readdir(entryPath, { withFileTypes: true })
    entries.sort((left, right) => left.name.localeCompare(right.name))

    for (const entry of entries) {
      const childRelativePath = relativePath
        ? join(relativePath, entry.name)
        : entry.name
      await collectEntrySignature(
        join(entryPath, entry.name),
        childRelativePath
      )
    }
  }

  await collectEntrySignature(directoryPath, '')

  return signatureParts.join('\0')
}

async function getArchiveStabilitySignature(
  archivePath: string
): Promise<EntryStabilitySignature> {
  const archiveDirectory = dirname(archivePath)
  const selectedPart = getArchivePart(basename(archivePath))
  const archivePartPaths = [archivePath]

  if (selectedPart) {
    const entries = await fs.readdir(archiveDirectory, {
      withFileTypes: true
    })
    archivePartPaths.splice(
      0,
      archivePartPaths.length,
      ...entries
        .filter((entry) => entry.isFile())
        .map((entry) => ({
          name: entry.name,
          part: getArchivePart(entry.name)
        }))
        .filter(
          (
            candidate
          ): candidate is {
            name: string
            part: NonNullable<ReturnType<typeof getArchivePart>>
          } => candidate.part?.signature === selectedPart.signature
        )
        .sort((left, right) => left.part.partNumber - right.part.partNumber)
        .map(({ name }) => join(archiveDirectory, name))
    )
  }

  const signatureParts: string[] = []
  for (const partPath of archivePartPaths) {
    const stats = await fs.stat(partPath)
    if (!stats.isFile()) {
      return null
    }

    signatureParts.push(
      `${basename(partPath)}\0${stats.size}\0${stats.mtimeMs}`
    )
  }

  return signatureParts.join('\0')
}

/**
 * Resolves to a signature while the entry exists and is readable, `null` when
 * waiting is pointless (the entry is gone, or access to it is denied) and
 * `undefined` for errors that may be transient (the caller retries them, up
 * to its attempt limit).
 */
async function getEntryStabilitySignature(
  entryPath: string,
  isArchive: boolean
): Promise<EntryStabilitySignature> {
  try {
    if (isArchive) {
      return await getArchiveStabilitySignature(entryPath)
    }

    const stats = await fs.stat(entryPath)
    if (stats.isDirectory()) {
      return await getDirectoryStabilitySignature(entryPath)
    }

    return null
  } catch (error) {
    const code = getErrorCode(error)
    if (code === 'ENOENT') {
      return null
    }

    if (code === 'EACCES' || code === 'EPERM') {
      logWarning(
        [`No permission to inspect local library entry "${entryPath}":`, error],
        LogPrefix.Backend
      )
      return null
    }

    return undefined
  }
}

class LocalLibraryWatcher {
  private rootPath = ''
  private knownEntries = new Set<string>()
  private pendingEntries = new Set<string>()
  private queuedEntries: LocalLibraryFolder[] = []
  private suppressedEntries = new Set<string>()
  private activeStabilityChecks = 0
  private stabilityCheckQueue: Array<() => void> = []
  private exclusionRules: string[] = []
  private detectArchives = true
  private watcher: FSWatcher | undefined
  private reconcileTimeout: NodeJS.Timeout | undefined
  private reconcileInterval: NodeJS.Timeout | undefined
  private reconcileRequested = false
  private reconcileRunning = false
  private revision = 0
  private readonly caseInsensitiveNames: boolean
  private readonly entryStableChecks: number
  private readonly entryStabilityIntervalMs: number
  private readonly entryStabilityMaxAttempts: number
  private readonly maxConcurrentStabilityChecks: number
  private readonly watchDebounceMs: number
  private readonly watchPollIntervalMs: number

  constructor(
    private readonly onFolderAdded: (folder: LocalLibraryFolder) => void,
    private readonly state: LocalLibraryWatcherState = localLibraryWatcherState,
    options: LocalLibraryWatcherOptions = {}
  ) {
    this.caseInsensitiveNames = options.caseInsensitiveNames ?? isWindows
    this.entryStableChecks = options.entryStableChecks ?? ENTRY_STABLE_CHECKS
    this.entryStabilityMaxAttempts = Math.max(
      1,
      options.entryStabilityMaxAttempts ?? ENTRY_STABILITY_MAX_ATTEMPTS
    )
    this.entryStabilityIntervalMs =
      options.entryStabilityIntervalMs ?? ENTRY_STABILITY_INTERVAL_MS
    this.maxConcurrentStabilityChecks = Math.max(
      1,
      options.maxConcurrentStabilityChecks ?? MAX_CONCURRENT_STABILITY_CHECKS
    )
    this.watchDebounceMs = options.watchDebounceMs ?? WATCH_DEBOUNCE_MS
    this.watchPollIntervalMs = Math.max(
      1,
      options.watchPollIntervalMs ?? WATCH_POLL_INTERVAL_MS
    )
  }

  setExclusionRules(exclusionRules: string[]): void {
    this.exclusionRules = exclusionRules
  }

  setDetectArchives(detectArchives: boolean): void {
    this.detectArchives = detectArchives
  }

  /**
   * Entry names are compared through this key so that, on case-insensitive
   * file systems (Windows), `Game` and `game` are the same entry. The
   * pending and suppressed sets store keys; known entries keep real names.
   */
  private getEntryKey(name: string): string {
    return this.caseInsensitiveNames ? name.toLowerCase() : name
  }

  suppressPath(path: string): void {
    if (
      this.rootPath &&
      this.getEntryKey(dirname(resolve(path))) ===
        this.getEntryKey(resolve(this.rootPath))
    ) {
      const entryName = basename(path)
      const entryKey = this.getEntryKey(entryName)
      this.knownEntries.add(entryName)
      this.pendingEntries.delete(entryKey)
      this.queuedEntries = this.queuedEntries.filter(
        (queuedEntry) =>
          this.getEntryKey(basename(queuedEntry.folderPath)) !== entryKey
      )
      this.suppressedEntries.add(entryKey)
      void this.saveQueuedEntries(this.rootPath)
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
    const currentEntries = getLibraryEntryNames(entries, this.detectArchives)
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

    const loadedQueuedEntries = await this.state.loadQueue(nextRootPath)
    if (revision !== this.revision) {
      return
    }

    this.queuedEntries = this.filterQueuedEntries(
      loadedQueuedEntries,
      currentEntries
    )
    await this.saveQueuedEntries(nextRootPath)
    if (revision !== this.revision) {
      return
    }

    this.queuedEntries.forEach((entry) => this.onFolderAdded(entry))

    let addedEntries: string[] = []
    if (previousEntries) {
      addedEntries = getAddedEntryNames(
        previousEntries,
        currentEntries,
        this.exclusionRules,
        this.caseInsensitiveNames
      ).filter(
        (entryName) =>
          !this.queuedEntries.some(
            (queuedEntry) =>
              this.getEntryKey(basename(queuedEntry.folderPath)) ===
              this.getEntryKey(entryName)
          )
      )
      this.reportAddedEntriesWhenReady(addedEntries, nextRootPath, revision)
    }
    await this.saveKnownEntries(nextRootPath)
    if (revision !== this.revision) {
      return
    }

    // Native watch notifications can be dropped on some platforms/filesystems.
    this.reconcileInterval = setInterval(() => {
      this.requestReconcile()
    }, this.watchPollIntervalMs)
    this.reconcileInterval.unref()
  }

  stop(): void {
    this.revision += 1

    if (this.reconcileTimeout) {
      clearTimeout(this.reconcileTimeout)
      this.reconcileTimeout = undefined
    }

    if (this.reconcileInterval) {
      clearInterval(this.reconcileInterval)
      this.reconcileInterval = undefined
    }

    this.watcher?.close()
    this.watcher = undefined
    this.reconcileRequested = false
    this.rootPath = ''
    this.knownEntries = new Set()
    this.pendingEntries = new Set()
    this.queuedEntries = []
    this.suppressedEntries = new Set()
  }

  async drainQueuedEntries(): Promise<LocalLibraryFolder[]> {
    const queuedEntries = this.queuedEntries
    this.queuedEntries = []
    if (this.rootPath) {
      await this.saveQueuedEntries(this.rootPath)
    }
    return queuedEntries
  }

  private scheduleReconcile(): void {
    if (this.reconcileTimeout) {
      clearTimeout(this.reconcileTimeout)
    }

    this.reconcileTimeout = setTimeout(() => {
      this.reconcileTimeout = undefined
      this.requestReconcile()
    }, this.watchDebounceMs)
  }

  private requestReconcile(): void {
    this.reconcileRequested = true
    if (!this.reconcileRunning) {
      void this.runRequestedReconciliations()
    }
  }

  private async runRequestedReconciliations(): Promise<void> {
    this.reconcileRunning = true
    try {
      while (this.reconcileRequested) {
        this.reconcileRequested = false
        await this.reconcile()
      }
    } finally {
      this.reconcileRunning = false
    }
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

    const currentEntries = getLibraryEntryNames(entries, this.detectArchives)
    const addedEntries = getAddedEntryNames(
      this.knownEntries,
      currentEntries,
      this.exclusionRules,
      this.caseInsensitiveNames
    ).filter(
      (entryName) =>
        !this.suppressedEntries.has(this.getEntryKey(entryName)) &&
        !this.pendingEntries.has(this.getEntryKey(entryName))
    )

    const currentEntryKeys = new Set(
      [...currentEntries].map((entryName) => this.getEntryKey(entryName))
    )
    for (const entryKey of this.suppressedEntries) {
      if (currentEntryKeys.has(entryKey)) {
        this.suppressedEntries.delete(entryKey)
      }
    }

    this.knownEntries = currentEntries
    this.reportAddedEntriesWhenReady(
      addedEntries,
      watchedRootPath,
      watchedRevision
    )
    await this.saveKnownEntries(watchedRootPath)
  }

  private getPersistableEntries(): Set<string> {
    return new Set(
      [...this.knownEntries].filter(
        (entryName) => !this.pendingEntries.has(this.getEntryKey(entryName))
      )
    )
  }

  private async saveKnownEntries(rootPath: string): Promise<void> {
    // Persisting is best effort; the state module already logs failures.
    await this.state
      .save(rootPath, this.getPersistableEntries())
      .catch(() => {})
  }

  private filterQueuedEntries(
    queuedEntries: LocalLibraryWatcherQueuedEntry[],
    currentEntries: Set<string>
  ): LocalLibraryFolder[] {
    const currentEntryKeys = new Set(
      [...currentEntries].map((entryName) => this.getEntryKey(entryName))
    )

    return queuedEntries.filter((queuedEntry) => {
      const entryName = basename(queuedEntry.folderPath)
      return (
        currentEntryKeys.has(this.getEntryKey(entryName)) &&
        !matchesExclusionRule(entryName, this.exclusionRules)
      )
    })
  }

  private async saveQueuedEntries(rootPath: string): Promise<void> {
    await this.state.saveQueue(rootPath, this.queuedEntries).catch(() => {})
  }

  private async queueEntry(
    rootPath: string,
    folder: LocalLibraryFolder
  ): Promise<void> {
    if (
      !this.queuedEntries.some(
        (queuedEntry) => queuedEntry.folderPath === folder.folderPath
      )
    ) {
      this.queuedEntries.push(folder)
      await this.saveQueuedEntries(rootPath)
    }
  }

  private reportAddedEntriesWhenReady(
    entryNames: string[],
    rootPath: string,
    revision: number
  ): void {
    for (const entryName of entryNames) {
      this.pendingEntries.add(this.getEntryKey(entryName))
      void this.reportAddedEntryWhenReady(entryName, rootPath, revision)
    }
  }

  private async acquireStabilityCheck(): Promise<() => void> {
    if (this.activeStabilityChecks < this.maxConcurrentStabilityChecks) {
      this.activeStabilityChecks++
    } else {
      await new Promise<void>((resolve) => {
        this.stabilityCheckQueue.push(resolve)
      })
    }

    return () => {
      const nextCheck = this.stabilityCheckQueue.shift()
      if (nextCheck) {
        nextCheck()
      } else {
        this.activeStabilityChecks--
      }
    }
  }

  private async reportAddedEntryWhenReady(
    entryName: string,
    rootPath: string,
    revision: number
  ): Promise<void> {
    const releaseStabilityCheck = await this.acquireStabilityCheck()

    try {
      const archiveExtension = getArchiveExtension(entryName)
      const folderPath = join(rootPath, entryName)
      const isArchive = archiveExtension !== undefined

      if (
        !(await this.waitForEntryToStabilize(folderPath, isArchive, revision))
      ) {
        // Not reported (gave up, access denied or gone): forget it, so it is
        // not persisted as already seen and the next scan offers it again.
        if (rootPath === this.rootPath && revision === this.revision) {
          this.knownEntries.delete(entryName)
        }
        return
      }

      if (
        rootPath !== this.rootPath ||
        revision !== this.revision ||
        this.suppressedEntries.has(this.getEntryKey(entryName))
      ) {
        return
      }

      const folder = {
        folderPath,
        isArchive,
        title: archiveExtension ? getArchiveTitle(entryName) : entryName
      }
      await this.queueEntry(rootPath, folder)
      this.onFolderAdded(folder)
    } finally {
      releaseStabilityCheck()
      this.pendingEntries.delete(this.getEntryKey(entryName))

      if (rootPath === this.rootPath && revision === this.revision) {
        await this.saveKnownEntries(rootPath)
      }
    }
  }

  private async waitForEntryToStabilize(
    entryPath: string,
    isArchive: boolean,
    revision: number
  ): Promise<boolean> {
    let previousSignature: string | undefined
    let stableChecks = 0
    // The parts of a split archive are usually copied one after another, with
    // pauses between them. Require a longer quiet period before reporting one.
    const requiredStableChecks =
      isArchive && getArchivePart(basename(entryPath))
        ? this.entryStableChecks * 2
        : this.entryStableChecks

    for (
      let attempt = 0;
      attempt < this.entryStabilityMaxAttempts && revision === this.revision;
      attempt++
    ) {
      const signature = await getEntryStabilitySignature(entryPath, isArchive)

      if (signature === null) {
        return false
      }

      if (signature && signature === previousSignature) {
        stableChecks++
        if (stableChecks >= requiredStableChecks) {
          return true
        }
      } else {
        previousSignature = signature
        stableChecks = 0
      }

      await delay(this.entryStabilityIntervalMs)
    }

    if (revision === this.revision) {
      logWarning(
        [
          `Giving up on local library entry "${entryPath}": it did not settle after ${this.entryStabilityMaxAttempts} checks`
        ],
        LogPrefix.Backend
      )
    }

    return false
  }
}

const localLibraryWatcher = new LocalLibraryWatcher((folder) => {
  sendFrontendMessage('localLibraryFolderAdded', folder)
})

let initialized = false

function suppressLocalLibraryPath(path: string): void {
  localLibraryWatcher.suppressPath(path)
}

function drainLocalLibraryWatcherQueue(): Promise<LocalLibraryFolder[]> {
  return localLibraryWatcher.drainQueuedEntries()
}

function applyLocalLibraryWatcherPath(): void {
  const settings = GlobalConfig.get().getSettings()
  localLibraryWatcher
    .setPath(
      settings.enableLocalLibraryWatcher &&
        typeof settings.localLibrarySyncPath === 'string'
        ? settings.localLibrarySyncPath
        : ''
    )
    .catch((error) => {
      logWarning(
        ['Unable to update the local library watcher path:', error],
        LogPrefix.Backend
      )
    })
}

let setPathTimeout: NodeJS.Timeout | undefined

// Restoring a backup (or editing settings quickly) changes several watcher
// settings in a row. Coalesce them into a single watcher restart that reads
// the final settings.
function scheduleLocalLibraryWatcherPathUpdate(): void {
  if (setPathTimeout) {
    clearTimeout(setPathTimeout)
  }

  setPathTimeout = setTimeout(() => {
    setPathTimeout = undefined
    applyLocalLibraryWatcherPath()
  }, SET_PATH_DEBOUNCE_MS)
}

function initLocalLibraryWatcher(): void {
  if (initialized) {
    return
  }
  initialized = true

  const settings = GlobalConfig.get().getSettings()
  localLibraryWatcher.setExclusionRules(settings.localLibrarySyncExclusions)
  localLibraryWatcher.setDetectArchives(settings.detectLocalLibraryArchives)
  applyLocalLibraryWatcherPath()

  addHandler('drainLocalLibraryWatcherQueue', drainLocalLibraryWatcherQueue)

  backendEvents.on('settingChanged', ({ key, newValue }) => {
    if (key === 'localLibrarySyncExclusions') {
      localLibraryWatcher.setExclusionRules(
        Array.isArray(newValue)
          ? newValue.filter((rule): rule is string => typeof rule === 'string')
          : []
      )
    }

    if (key === 'detectLocalLibraryArchives') {
      localLibraryWatcher.setDetectArchives(newValue === true)
    }

    if (
      key === 'enableLocalLibraryWatcher' ||
      key === 'detectLocalLibraryArchives' ||
      key === 'localLibrarySyncPath'
    ) {
      scheduleLocalLibraryWatcherPathUpdate()
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
  drainLocalLibraryWatcherQueue,
  suppressLocalLibraryPath
}
