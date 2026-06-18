import { promises as fs } from 'fs'
import { dirname, resolve } from 'path'

import { appFolder } from './constants/paths'
import { logWarning, LogPrefix } from './logger'

type LocalLibraryWatcherSnapshots = Record<string, string[]>

type LocalLibraryWatcherQueuedEntry = {
  folderPath: string
  isArchive: boolean
  title: string
}

type LocalLibraryWatcherQueues = Record<
  string,
  LocalLibraryWatcherQueuedEntry[]
>

type LocalLibraryWatcherStateData = {
  queues: LocalLibraryWatcherQueues
  snapshots: LocalLibraryWatcherSnapshots
}

type LocalLibraryWatcherState = {
  load: (rootPath: string) => Promise<Set<string> | undefined>
  loadQueue: (rootPath: string) => Promise<LocalLibraryWatcherQueuedEntry[]>
  save: (rootPath: string, entries: Set<string>) => Promise<void>
  saveQueue: (
    rootPath: string,
    entries: LocalLibraryWatcherQueuedEntry[]
  ) => Promise<void>
}

const statePath = resolve(appFolder, 'local-library-watcher.json')
let pendingWrite: Promise<void> = Promise.resolve()

function parseSnapshots(value: unknown): LocalLibraryWatcherSnapshots {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, string[]] =>
        Array.isArray(entry[1]) &&
        entry[1].every((name) => typeof name === 'string')
    )
  )
}

function parseQueues(value: unknown): LocalLibraryWatcherQueues {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const isQueuedEntry = (
    queuedEntry: unknown
  ): queuedEntry is LocalLibraryWatcherQueuedEntry => {
    if (!queuedEntry || typeof queuedEntry !== 'object') {
      return false
    }

    const candidate = queuedEntry as Record<string, unknown>
    return (
      typeof candidate.folderPath === 'string' &&
      typeof candidate.isArchive === 'boolean' &&
      typeof candidate.title === 'string'
    )
  }

  return Object.fromEntries(
    Object.entries(value).filter(
      (entry): entry is [string, LocalLibraryWatcherQueuedEntry[]] =>
        Array.isArray(entry[1]) && entry[1].every(isQueuedEntry)
    )
  )
}

function parseStateData(value: unknown): LocalLibraryWatcherStateData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { queues: {}, snapshots: {} }
  }

  if ('snapshots' in value || 'queues' in value) {
    const stateData = value as Record<string, unknown>
    return {
      queues: parseQueues(stateData.queues),
      snapshots: parseSnapshots(stateData.snapshots)
    }
  }

  return {
    queues: {},
    snapshots: parseSnapshots(value)
  }
}

async function readStateData(): Promise<LocalLibraryWatcherStateData> {
  try {
    return parseStateData(JSON.parse(await fs.readFile(statePath, 'utf8')))
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return { queues: {}, snapshots: {} }
    }

    logWarning(
      ['Unable to read the local library watcher state:', error],
      LogPrefix.Backend
    )
    return { queues: {}, snapshots: {} }
  }
}

const localLibraryWatcherState: LocalLibraryWatcherState = {
  async load(rootPath) {
    await pendingWrite
    const entries = (await readStateData()).snapshots[resolve(rootPath)]
    return entries ? new Set(entries) : undefined
  },

  async loadQueue(rootPath) {
    await pendingWrite
    return (await readStateData()).queues[resolve(rootPath)] ?? []
  },

  save(rootPath, entries) {
    pendingWrite = pendingWrite.then(async () => {
      const stateData = await readStateData()
      stateData.snapshots[resolve(rootPath)] = [...entries].sort()

      try {
        await fs.mkdir(dirname(statePath), { recursive: true })
        const temporaryPath = `${statePath}.tmp`
        await fs.writeFile(temporaryPath, JSON.stringify(stateData, null, 2))
        await fs.rename(temporaryPath, statePath)
      } catch (error) {
        logWarning(
          ['Unable to save the local library watcher state:', error],
          LogPrefix.Backend
        )
      }
    })

    return pendingWrite
  },

  saveQueue(rootPath, entries) {
    pendingWrite = pendingWrite.then(async () => {
      const stateData = await readStateData()
      stateData.queues[resolve(rootPath)] = entries

      try {
        await fs.mkdir(dirname(statePath), { recursive: true })
        const temporaryPath = `${statePath}.tmp`
        await fs.writeFile(temporaryPath, JSON.stringify(stateData, null, 2))
        await fs.rename(temporaryPath, statePath)
      } catch (error) {
        logWarning(
          ['Unable to save the local library watcher state:', error],
          LogPrefix.Backend
        )
      }
    })

    return pendingWrite
  }
}

export { localLibraryWatcherState }
export type { LocalLibraryWatcherQueuedEntry, LocalLibraryWatcherState }
