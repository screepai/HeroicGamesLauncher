import { promises as fs } from 'fs'
import { rm } from 'fs/promises'

jest.mock('../constants/paths', () => {
  const actualFs = jest.requireActual<typeof import('fs')>('fs')
  const actualOs = jest.requireActual<typeof import('os')>('os')
  const actualPath = jest.requireActual<typeof import('path')>('path')
  return {
    appFolder: actualFs.mkdtempSync(
      actualPath.join(actualOs.tmpdir(), 'heroic-watcher-state-')
    )
  }
})
jest.mock('../logger', () => ({
  logWarning: jest.fn(),
  LogPrefix: { Backend: 'Backend' }
}))

import { appFolder } from '../constants/paths'
import { logWarning } from '../logger'
import { localLibraryWatcherState } from '../local_library_watcher_state'

afterEach(() => {
  jest.restoreAllMocks()
})

afterAll(async () => {
  await rm(appFolder, { recursive: true, force: true })
})

describe('local library watcher state', () => {
  it('persists snapshots and queues', async () => {
    await localLibraryWatcherState.save('/library', new Set(['b', 'a']))
    await localLibraryWatcherState.saveQueue('/library', [
      { folderPath: '/library/a', isArchive: false, title: 'a' }
    ])

    await expect(localLibraryWatcherState.load('/library')).resolves.toEqual(
      new Set(['a', 'b'])
    )
    await expect(
      localLibraryWatcherState.loadQueue('/library')
    ).resolves.toEqual([
      { folderPath: '/library/a', isArchive: false, title: 'a' }
    ])
  })

  it('keeps saving and loading after a rejected write', async () => {
    jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk is full'))

    // The caller learns about the failure...
    await expect(
      localLibraryWatcherState.save('/library', new Set(['lost']))
    ).rejects.toThrow('disk is full')
    expect(logWarning).toHaveBeenCalled()

    // ...but the shared write chain is not poisoned by it
    await expect(
      localLibraryWatcherState.save('/library', new Set(['kept']))
    ).resolves.toBeUndefined()
    await expect(localLibraryWatcherState.load('/library')).resolves.toEqual(
      new Set(['kept'])
    )
  })

  it('runs writes queued behind a failing write', async () => {
    jest.spyOn(fs, 'writeFile').mockRejectedValueOnce(new Error('disk is full'))

    const failedWrite = localLibraryWatcherState.save(
      '/library',
      new Set(['lost'])
    )
    const queuedWrite = localLibraryWatcherState.save(
      '/library',
      new Set(['queued'])
    )

    await expect(failedWrite).rejects.toThrow('disk is full')
    await expect(queuedWrite).resolves.toBeUndefined()
    await expect(localLibraryWatcherState.load('/library')).resolves.toEqual(
      new Set(['queued'])
    )
  })
})
