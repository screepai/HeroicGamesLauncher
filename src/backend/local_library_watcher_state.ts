import { promises as fs } from 'fs'
import { dirname, resolve } from 'path'

import { appFolder } from './constants/paths'
import { logWarning, LogPrefix } from './logger'

type LocalLibraryWatcherSnapshots = Record<string, string[]>

type LocalLibraryWatcherState = {
  load: (rootPath: string) => Promise<Set<string> | undefined>
  save: (rootPath: string, entries: Set<string>) => Promise<void>
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

async function readSnapshots(): Promise<LocalLibraryWatcherSnapshots> {
  try {
    return parseSnapshots(JSON.parse(await fs.readFile(statePath, 'utf8')))
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      return {}
    }

    logWarning(
      ['Unable to read the local library watcher state:', error],
      LogPrefix.Backend
    )
    return {}
  }
}

const localLibraryWatcherState: LocalLibraryWatcherState = {
  async load(rootPath) {
    await pendingWrite
    const entries = (await readSnapshots())[resolve(rootPath)]
    return entries ? new Set(entries) : undefined
  },

  save(rootPath, entries) {
    pendingWrite = pendingWrite.then(async () => {
      const snapshots = await readSnapshots()
      snapshots[resolve(rootPath)] = [...entries].sort()

      try {
        await fs.mkdir(dirname(statePath), { recursive: true })
        const temporaryPath = `${statePath}.tmp`
        await fs.writeFile(temporaryPath, JSON.stringify(snapshots, null, 2))
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
export type { LocalLibraryWatcherState }
