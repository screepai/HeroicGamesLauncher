import { promises as fs } from 'fs'
import { join } from 'path'

jest.mock('../backend_events', () => ({
  backendEvents: { on: jest.fn() }
}))
jest.mock('../config', () => ({
  GlobalConfig: {
    get: () => ({
      getSettings: () => ({ localLibrarySyncPath: '' })
    })
  }
}))
jest.mock('../ipc', () => ({
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
  LocalLibraryWatcher,
  matchesExclusionRule
} from '../local_library_watcher'

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
    const watcher = new LocalLibraryWatcher((folder) =>
      resolveAddedFolder(folder)
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
    const watcher = new LocalLibraryWatcher((folder) =>
      resolveAddedFolder(folder)
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

  it('does not report newly added folders matching an exclusion rule', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-local-library-')
    )
    const onFolderAdded = jest.fn()
    const watcher = new LocalLibraryWatcher(onFolderAdded)
    watcher.setExclusionRules(['_temp-*'])

    try {
      await watcher.setPath(rootPath)
      await fs.mkdir(join(rootPath, '_temp-download'))
      await new Promise((resolve) => setTimeout(resolve, 700))

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
    const watcher = new LocalLibraryWatcher(onFolderAdded)

    try {
      await watcher.setPath(rootPath)
      watcher.suppressPath(stagingPath)
      watcher.suppressPath(destinationPath)

      await fs.mkdir(stagingPath)
      await new Promise((resolve) => setTimeout(resolve, 700))
      await fs.rm(stagingPath, { recursive: true })
      await fs.mkdir(destinationPath)
      await new Promise((resolve) => setTimeout(resolve, 700))

      expect(onFolderAdded).not.toHaveBeenCalled()
    } finally {
      watcher.stop()
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })
})
