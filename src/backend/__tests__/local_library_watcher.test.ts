import { promises as fs } from 'fs'
import { join } from 'path'

const mockAppSettings = {
  detectLocalLibraryArchives: true,
  enableLocalLibraryWatcher: true,
  localLibrarySyncExclusions: [] as string[],
  localLibrarySyncPath: ''
}

jest.mock('../backend_events', () => ({
  backendEvents: { on: jest.fn() }
}))
jest.mock('../config', () => ({
  GlobalConfig: {
    get: () => ({
      getSettings: () => mockAppSettings
    })
  }
}))
jest.mock('../ipc', () => ({
  addHandler: jest.fn(),
  sendFrontendMessage: jest.fn()
}))
jest.mock('../logger', () => ({
  logWarning: jest.fn(),
  LogPrefix: { Backend: 'Backend' }
}))
jest.mock('../utils', () => ({
  spawnAsync: jest.fn()
}))

import {
  getAddedEntryNames,
  getArchiveExtension,
  getEntryTitle,
  getLibraryEntryNames,
  initLocalLibraryWatcher,
  LocalLibraryWatcher,
  matchesExclusionRule,
  drainLocalLibraryWatcherQueue
} from '../local_library_watcher'
import type { LocalLibraryWatcherState } from '../local_library_watcher_state'
import { backendEvents } from '../backend_events'
import { addHandler, sendFrontendMessage } from '../ipc'

type SettingChangedHandler = (payload: {
  key: string
  oldValue: unknown
  newValue: unknown
}) => void

type SettingChangedOn = (
  eventName: 'settingChanged',
  listener: SettingChangedHandler
) => typeof backendEvents

const testWatcherOptions = {
  entryStableChecks: 2,
  entryStabilityIntervalMs: 25,
  watchDebounceMs: 25
}

function delay(ms: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, ms))
}

async function waitFor(
  assertion: () => void,
  timeoutMs = 1000,
  intervalMs = 10
): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < timeoutMs) {
    try {
      assertion()
      return
    } catch {
      await delay(intervalMs)
    }
  }

  assertion()
}

function createWatcherState(
  initialSnapshots: Record<string, string[]> = {}
): LocalLibraryWatcherState {
  const snapshots = new Map(
    Object.entries(initialSnapshots).map(([rootPath, entries]) => [
      rootPath,
      new Set(entries)
    ])
  )

  return {
    load(rootPath) {
      const entries = snapshots.get(rootPath)
      return Promise.resolve(entries ? new Set(entries) : undefined)
    },
    save(rootPath, entries) {
      snapshots.set(rootPath, new Set(entries))
      return Promise.resolve()
    }
  }
}

describe('local library watcher', () => {
  it('finds only newly added entry names', () => {
    expect(
      getAddedEntryNames(
        new Set(['Existing Game']),
        new Set(['Existing Game', 'New Game'])
      )
    ).toEqual(['New Game'])
  })

  it.each([
    ['Game.zip', '.zip', 'Game'],
    ['Game.RAR', '.rar', 'Game'],
    ['Game.7z', '.7z', 'Game'],
    ['Game.part1.rar', '.rar', 'Game'],
    ['Game-part02.zip', '.zip', 'Game'],
    ['Game.7z.001', '.7z.001', 'Game'],
    ['Game.tar.gz', '.tar.gz', 'Game'],
    ['Game.tar.xz', '.tar.xz', 'Game'],
    ['Game.tzst', '.tzst', 'Game']
  ])(
    'recognizes %s as an archive and derives its title',
    (fileName, extension, title) => {
      expect(getArchiveExtension(fileName)).toBe(extension)
      expect(getEntryTitle(fileName)).toBe(title)
    }
  )

  it('does not treat ordinary files as archives', () => {
    expect(getArchiveExtension('Game.exe')).toBeUndefined()
    expect(getEntryTitle('Game.exe')).toBe('Game.exe')
  })

  it('watches only the first volume of a multipart archive', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-multipart-watcher-')
    )

    try {
      await fs.writeFile(join(rootPath, 'Game.part1.rar'), '')
      await fs.writeFile(join(rootPath, 'Game.part2.rar'), '')
      await fs.writeFile(join(rootPath, 'Other Game.7z.001'), '')
      await fs.writeFile(join(rootPath, 'Other Game.7z.002'), '')

      const entries = await fs.readdir(rootPath, { withFileTypes: true })
      expect(getLibraryEntryNames(entries)).toEqual(
        new Set(['Game.part1.rar', 'Other Game.7z.001'])
      )
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('ignores archives when archive detection is disabled', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-multipart-watcher-')
    )

    try {
      await fs.mkdir(join(rootPath, 'Folder Game'))
      await fs.writeFile(join(rootPath, 'Archive Game.zip'), '')

      const entries = await fs.readdir(rootPath, { withFileTypes: true })
      expect(getLibraryEntryNames(entries, false)).toEqual(
        new Set(['Folder Game'])
      )
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('matches exact and wildcard exclusion rules without treating names as regex', () => {
    expect(matchesExclusionRule('Downloads', ['downloads'])).toBe(true)
    expect(matchesExclusionRule('_temp-123', ['_temp-*'])).toBe(true)
    expect(matchesExclusionRule('Game 01', ['Game ??'])).toBe(true)
    expect(matchesExclusionRule('Game [Demo]', ['Game [Demo]'])).toBe(true)
    expect(matchesExclusionRule('Released Game', ['_temp-*'])).toBe(false)
  })

  it('filters excluded names from newly added directories', () => {
    expect(
      getAddedEntryNames(
        new Set(['Existing Game']),
        new Set(['Existing Game', '_temp-download', 'New Game']),
        ['_temp-*']
      )
    ).toEqual(['New Game'])
  })

  it('ignores existing folders and reports a newly added child folder', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-local-library-')
    )
    const existingFolderPath = join(rootPath, 'Existing Game')
    const newFolderPath = join(rootPath, 'New Game')
    await fs.mkdir(existingFolderPath)

    let resolveAddedFolder: (folder: {
      folderPath: string
      title: string
    }) => void
    const addedFolder = new Promise<{ folderPath: string; title: string }>(
      (resolve) => {
        resolveAddedFolder = resolve
      }
    )
    const watcher = new LocalLibraryWatcher(
      (folder) => resolveAddedFolder(folder),
      createWatcherState(),
      testWatcherOptions
    )

    try {
      await watcher.setPath(rootPath)
      await fs.mkdir(newFolderPath)

      await expect(addedFolder).resolves.toEqual({
        folderPath: newFolderPath,
        isArchive: false,
        title: 'New Game'
      })
    } finally {
      watcher.stop()
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('ignores existing archives and reports a newly added archive', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-local-library-')
    )
    await fs.writeFile(join(rootPath, 'Existing Game.zip'), '')
    const newArchivePath = join(rootPath, 'New Game.tar.gz')

    let resolveAddedFolder: (folder: {
      folderPath: string
      title: string
    }) => void
    const addedFolder = new Promise<{ folderPath: string; title: string }>(
      (resolve) => {
        resolveAddedFolder = resolve
      }
    )
    const watcher = new LocalLibraryWatcher(
      (folder) => resolveAddedFolder(folder),
      createWatcherState(),
      testWatcherOptions
    )

    try {
      await watcher.setPath(rootPath)
      await fs.writeFile(newArchivePath, '')

      await expect(addedFolder).resolves.toEqual({
        folderPath: newArchivePath,
        isArchive: true,
        title: 'New Game'
      })
    } finally {
      watcher.stop()
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('waits for a newly added archive to stop changing before reporting it', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-local-library-')
    )
    const newArchivePath = join(rootPath, 'Downloading Game.zip')
    const onFolderAdded = jest.fn()
    const watcher = new LocalLibraryWatcher(
      onFolderAdded,
      createWatcherState(),
      testWatcherOptions
    )

    try {
      await watcher.setPath(rootPath)
      await fs.writeFile(newArchivePath, 'partial')
      await delay(60)
      await fs.appendFile(newArchivePath, ' content')

      expect(onFolderAdded).not.toHaveBeenCalled()
      await waitFor(() =>
        expect(onFolderAdded).toHaveBeenCalledWith({
          folderPath: newArchivePath,
          isArchive: true,
          title: 'Downloading Game'
        })
      )
    } finally {
      watcher.stop()
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('waits for a newly added folder tree to stop changing before reporting it', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-local-library-')
    )
    const newFolderPath = join(rootPath, 'Moving Game')
    const nestedFilePath = join(newFolderPath, 'data.bin')
    const onFolderAdded = jest.fn()
    const watcher = new LocalLibraryWatcher(
      onFolderAdded,
      createWatcherState(),
      testWatcherOptions
    )

    try {
      await watcher.setPath(rootPath)
      await fs.mkdir(newFolderPath)
      await fs.writeFile(nestedFilePath, 'partial')
      await delay(60)
      await fs.appendFile(nestedFilePath, ' content')

      expect(onFolderAdded).not.toHaveBeenCalled()
      await waitFor(() =>
        expect(onFolderAdded).toHaveBeenCalledWith({
          folderPath: newFolderPath,
          isArchive: false,
          title: 'Moving Game'
        })
      )
    } finally {
      watcher.stop()
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('reports folders and archives added while the watcher was stopped', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-local-library-')
    )
    const state = createWatcherState()
    const initialWatcher = new LocalLibraryWatcher(
      jest.fn(),
      state,
      testWatcherOptions
    )

    try {
      await fs.mkdir(join(rootPath, 'Existing Game'))
      await initialWatcher.setPath(rootPath)
      initialWatcher.stop()

      const newFolderPath = join(rootPath, 'Offline Folder')
      const newArchivePath = join(rootPath, 'Offline Archive.7z.001')
      await fs.mkdir(newFolderPath)
      await fs.writeFile(newArchivePath, '')
      await fs.writeFile(join(rootPath, 'Offline Archive.7z.002'), '')

      const addedFolders: Array<{
        folderPath: string
        isArchive: boolean
        title: string
      }> = []
      const restartedWatcher = new LocalLibraryWatcher(
        (folder) => addedFolders.push(folder),
        state,
        testWatcherOptions
      )
      await restartedWatcher.setPath(rootPath)

      await waitFor(() =>
        expect(
          addedFolders.sort((left, right) =>
            left.folderPath.localeCompare(right.folderPath)
          )
        ).toEqual(
          [
            {
              folderPath: newFolderPath,
              isArchive: false,
              title: 'Offline Folder'
            },
            {
              folderPath: newArchivePath,
              isArchive: true,
              title: 'Offline Archive'
            }
          ].sort((left, right) =>
            left.folderPath.localeCompare(right.folderPath)
          )
        )
      )

      restartedWatcher.stop()
    } finally {
      initialWatcher.stop()
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('keeps startup discoveries queued until the frontend drains them', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-local-library-')
    )
    const state = createWatcherState()
    const initialWatcher = new LocalLibraryWatcher(
      jest.fn(),
      state,
      testWatcherOptions
    )

    try {
      await fs.mkdir(join(rootPath, 'Existing Game'))
      await initialWatcher.setPath(rootPath)
      initialWatcher.stop()

      const newFolderPath = join(rootPath, 'Offline Folder')
      const newArchivePath = join(rootPath, 'Offline Archive.zip')
      await fs.mkdir(newFolderPath)
      await fs.writeFile(newArchivePath, '')

      const onFolderAdded = jest.fn()
      const restartedWatcher = new LocalLibraryWatcher(
        onFolderAdded,
        state,
        testWatcherOptions
      )
      await restartedWatcher.setPath(rootPath)

      await waitFor(() => expect(onFolderAdded).toHaveBeenCalledTimes(2))
      expect(
        restartedWatcher
          .drainQueuedEntries()
          .sort((left, right) =>
            left.folderPath.localeCompare(right.folderPath)
          )
      ).toEqual(
        [
          {
            folderPath: newFolderPath,
            isArchive: false,
            title: 'Offline Folder'
          },
          {
            folderPath: newArchivePath,
            isArchive: true,
            title: 'Offline Archive'
          }
        ].sort((left, right) => left.folderPath.localeCompare(right.folderPath))
      )
      expect(restartedWatcher.drainQueuedEntries()).toEqual([])

      restartedWatcher.stop()
    } finally {
      initialWatcher.stop()
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('does not report newly added folders matching an exclusion rule', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-local-library-')
    )
    const onFolderAdded = jest.fn()
    const watcher = new LocalLibraryWatcher(
      onFolderAdded,
      createWatcherState(),
      testWatcherOptions
    )
    watcher.setExclusionRules(['_temp-*'])

    try {
      await watcher.setPath(rootPath)
      await fs.mkdir(join(rootPath, '_temp-download'))
      await delay(100)

      expect(onFolderAdded).not.toHaveBeenCalled()
    } finally {
      watcher.stop()
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('keeps future extraction destinations suppressed across staging reconciles', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-local-library-')
    )
    const stagingPath = join(rootPath, '.heroic-extract-staging')
    const destinationPath = join(rootPath, 'Extracted Game')
    const onFolderAdded = jest.fn()
    const watcher = new LocalLibraryWatcher(
      onFolderAdded,
      createWatcherState(),
      testWatcherOptions
    )

    try {
      await watcher.setPath(rootPath)
      watcher.suppressPath(stagingPath)
      watcher.suppressPath(destinationPath)

      await fs.mkdir(stagingPath)
      await delay(100)
      await fs.rm(stagingPath, { recursive: true })
      await fs.mkdir(destinationPath)
      await delay(100)

      expect(onFolderAdded).not.toHaveBeenCalled()
    } finally {
      watcher.stop()
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('stops watching when the global watcher setting is disabled', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-local-library-')
    )
    mockAppSettings.enableLocalLibraryWatcher = true
    mockAppSettings.localLibrarySyncPath = rootPath

    try {
      initLocalLibraryWatcher()
      await delay(100)

      expect(addHandler).toHaveBeenCalledWith(
        'drainLocalLibraryWatcherQueue',
        drainLocalLibraryWatcherQueue
      )

      await fs.mkdir(join(rootPath, 'Detected Game'))
      await waitFor(
        () => expect(sendFrontendMessage).toHaveBeenCalledTimes(1),
        4000
      )

      const settingChangedHandler = (
        backendEvents.on as unknown as jest.MockedFunction<SettingChangedOn>
      ).mock.calls.find(([eventName]) => eventName === 'settingChanged')?.[1]
      expect(settingChangedHandler).toBeDefined()

      mockAppSettings.enableLocalLibraryWatcher = false
      settingChangedHandler?.({
        key: 'enableLocalLibraryWatcher',
        oldValue: true,
        newValue: false
      })

      await fs.mkdir(join(rootPath, 'Ignored While Paused'))
      await delay(700)
      expect(sendFrontendMessage).toHaveBeenCalledTimes(1)
    } finally {
      mockAppSettings.enableLocalLibraryWatcher = false
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })
})
