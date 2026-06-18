import { execFile } from 'child_process'
import { randomBytes } from 'crypto'
import { promises as fs } from 'fs'
import { join } from 'path'
import { promisify } from 'util'

import { path7z } from '7zip-bin-full'

jest.mock('../utils', () => ({
  spawnAsync: (
    command: string,
    args: string[],
    options: Record<string, unknown>
  ) =>
    new Promise((resolve, reject) => {
      const { spawn } =
        jest.requireActual<typeof import('child_process')>('child_process')
      const child = spawn(command, args, options)
      let stdout = ''
      let stderr = ''

      child.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString()
      })
      child.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString()
      })
      child.on('error', reject)
      child.on('close', (code) => resolve({ code, stdout, stderr }))
    })
}))

import {
  deleteLocalLibraryArchive,
  extractLocalLibraryArchive,
  findLocalLibraryNestedArchives,
  inspectLocalLibraryArchive,
  listLocalLibraryArchive,
  parseArchiveListing,
  validateDestinationName
} from '../local_library_archive'

const execFileAsync = promisify(execFile)

describe('local library archive', () => {
  it('parses files, directories, and implicit parent directories', () => {
    expect(
      parseArchiveListing(`Path = Game\\Data\\config.ini
Size = 8
Attributes = A

Path = Game\\game.exe
Size = 5
Attributes = A
`)
    ).toEqual([
      { path: 'Game', isDirectory: true, size: 0 },
      { path: 'Game/Data', isDirectory: true, size: 0 },
      { path: 'Game/game.exe', isDirectory: false, size: 5 },
      { path: 'Game/Data/config.ini', isDirectory: false, size: 8 }
    ])
  })

  it('rejects unsafe archive paths', () => {
    expect(() =>
      parseArchiveListing(`Path = ..\\outside.exe
Size = 5
Attributes = A
`)
    ).toThrow('Archive contains an unsafe path')
  })

  it.each(['', '.', '..', 'nested/folder', 'invalid?', 'trailing.'])(
    'rejects invalid destination name %p',
    (destinationName) => {
      expect(() => validateDestinationName(destinationName)).toThrow(
        'Enter a valid folder name'
      )
    }
  )

  it('discards an archive-named wrapper and keeps its selected parent folder as the result', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-local-library-archive-')
    )
    const sourcePath = join(rootPath, 'Game')
    const archivePath = join(rootPath, 'Game.7z')
    const suppressedPaths: string[] = []

    try {
      await fs.mkdir(join(sourcePath, 'Keep'), { recursive: true })
      await fs.mkdir(join(sourcePath, 'Delete'), { recursive: true })
      await fs.writeFile(join(sourcePath, 'Keep', 'keep.txt'), 'keep')
      await fs.writeFile(join(sourcePath, 'Delete', 'delete.txt'), 'delete')
      await execFileAsync(path7z, ['a', archivePath, 'Game'], {
        cwd: rootPath,
        windowsHide: true
      })
      await fs.rm(sourcePath, { recursive: true, force: true })

      const entries = await listLocalLibraryArchive(archivePath)
      expect(entries.some((entry) => entry.path === 'Game/Keep/keep.txt')).toBe(
        true
      )

      const result = await extractLocalLibraryArchive({
        archivePath,
        destinationName: 'Renamed Game',
        rootPath: 'Game/Keep',
        selectedPaths: ['Game/Keep/keep.txt', 'Game/Keep/no-longer-listed.txt'],
        onBeforePathCreated: (path) => suppressedPaths.push(path)
      })

      expect(result).toEqual({
        folderPath: join(rootPath, 'Renamed Game'),
        title: 'Renamed Game'
      })
      await expect(
        fs.readFile(join(result.folderPath, 'keep.txt'), 'utf8')
      ).resolves.toBe('keep')
      await expect(
        fs.access(join(result.folderPath, 'Keep'))
      ).rejects.toMatchObject({ code: 'ENOENT' })
      expect(suppressedPaths).toHaveLength(2)
      expect(suppressedPaths).toContain(result.folderPath)
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('lists and extracts a password-protected archive', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-password-archive-')
    )
    const sourcePath = join(rootPath, 'secret.txt')
    const archivePath = join(rootPath, 'secret.7z')

    try {
      await fs.writeFile(sourcePath, 'classified')
      await execFileAsync(
        path7z,
        ['a', archivePath, sourcePath, '-psecret', '-mhe=on'],
        {
          cwd: rootPath,
          windowsHide: true
        }
      )
      await fs.rm(sourcePath)

      await expect(listLocalLibraryArchive(archivePath)).rejects.toThrow(
        'Archive password is required or incorrect'
      )

      const entries = await listLocalLibraryArchive(archivePath, 'secret')
      expect(entries).toEqual([
        {
          path: 'secret.txt',
          isDirectory: false,
          size: 10,
          isEncrypted: true
        }
      ])

      const result = await extractLocalLibraryArchive({
        archivePath,
        destinationName: 'Decrypted',
        password: 'secret',
        selectedPaths: ['secret.txt']
      })

      await expect(
        fs.readFile(join(result.folderPath, 'secret.txt'), 'utf8')
      ).resolves.toBe('classified')
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('finds a nested archive wrapper without treating game folders as nested archives', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-nested-archive-')
    )
    const wrapperPath = join(rootPath, 'Extracted Wrapper')
    const nestedArchivePath = join(wrapperPath, 'Inner Game.rar')
    const gameFolderPath = join(rootPath, 'Game Folder')

    try {
      await fs.mkdir(wrapperPath)
      await fs.writeFile(nestedArchivePath, 'archive')
      await fs.writeFile(join(wrapperPath, 'readme.txt'), 'sidecar')
      await expect(
        findLocalLibraryNestedArchives(wrapperPath)
      ).resolves.toEqual([
        {
          cleanupAfterExtractionPath: wrapperPath,
          extractionDestinationDirectory: rootPath,
          folderPath: nestedArchivePath,
          isArchive: true,
          title: 'Inner Game'
        }
      ])

      await fs.mkdir(gameFolderPath)
      await fs.writeFile(join(gameFolderPath, 'assets.zip'), 'asset archive')
      await fs.mkdir(join(gameFolderPath, 'GameData'))
      await expect(
        findLocalLibraryNestedArchives(gameFolderPath)
      ).resolves.toEqual([])
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('extracts a nested archive beside the wrapper and removes the wrapper', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-nested-extract-')
    )
    const wrapperPath = join(rootPath, 'Extracted Wrapper')
    const sourcePath = join(rootPath, 'payload.txt')
    const nestedArchivePath = join(wrapperPath, 'Inner Game.7z')

    try {
      await fs.mkdir(wrapperPath)
      await fs.writeFile(sourcePath, 'nested payload')
      await execFileAsync(path7z, ['a', nestedArchivePath, sourcePath], {
        cwd: rootPath,
        windowsHide: true
      })
      await fs.rm(sourcePath)

      const result = await extractLocalLibraryArchive({
        archivePath: nestedArchivePath,
        cleanupPath: wrapperPath,
        destinationDirectory: rootPath,
        destinationName: 'Final Game',
        selectedPaths: ['payload.txt']
      })

      expect(result).toEqual({
        folderPath: join(rootPath, 'Final Game'),
        title: 'Final Game'
      })
      await expect(
        fs.readFile(join(result.folderPath, 'payload.txt'), 'utf8')
      ).resolves.toBe('nested payload')
      await expect(fs.access(wrapperPath)).rejects.toMatchObject({
        code: 'ENOENT'
      })
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('accepts a complete split archive that only has a first volume', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-single-volume-archive-')
    )
    const sourcePath = join(rootPath, 'small.txt')
    const archiveBasePath = join(rootPath, 'Small Game.7z')
    const firstPartPath = `${archiveBasePath}.001`

    try {
      await fs.writeFile(sourcePath, 'complete')
      await execFileAsync(path7z, ['a', '-v1m', archiveBasePath, sourcePath], {
        cwd: rootPath,
        windowsHide: true
      })
      await fs.rm(sourcePath)

      await expect(fs.readdir(rootPath)).resolves.toEqual(['Small Game.7z.001'])
      await expect(inspectLocalLibraryArchive(firstPartPath)).resolves.toEqual({
        archivePath: firstPartPath,
        isMultipart: true,
        missingParts: [],
        partPaths: [firstPartPath]
      })
      await expect(listLocalLibraryArchive(firstPartPath)).resolves.toEqual([
        {
          path: 'small.txt',
          isDirectory: false,
          size: 8
        }
      ])
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('inspects, extracts, and deletes multipart archives from their first volume', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-multipart-archive-')
    )
    const sourcePath = join(rootPath, 'payload.bin')
    const archiveBasePath = join(rootPath, 'Multipart Game.7z')

    try {
      const payload = randomBytes(8 * 1024)
      await fs.writeFile(sourcePath, payload)
      await execFileAsync(path7z, ['a', '-v1k', archiveBasePath, sourcePath], {
        cwd: rootPath,
        windowsHide: true
      })
      await fs.rm(sourcePath)

      const partNames = (await fs.readdir(rootPath))
        .filter((name) => name.startsWith('Multipart Game.7z.'))
        .sort()
      expect(partNames.length).toBeGreaterThan(2)

      const firstPartPath = join(rootPath, partNames[0])
      const secondPartPath = join(rootPath, partNames[1])
      const lastPartPath = join(rootPath, partNames.at(-1)!)
      const lastPartContents = await fs.readFile(lastPartPath)
      await fs.rm(lastPartPath)

      await expect(listLocalLibraryArchive(firstPartPath)).rejects.toThrow(
        'The archive is incomplete. Add the remaining parts and try again.'
      )

      await fs.writeFile(lastPartPath, lastPartContents)
      const secondPartContents = await fs.readFile(secondPartPath)
      await fs.rm(secondPartPath)

      await expect(
        inspectLocalLibraryArchive(lastPartPath)
      ).resolves.toMatchObject({
        archivePath: firstPartPath,
        isMultipart: true,
        missingParts: [2]
      })
      await expect(listLocalLibraryArchive(firstPartPath)).rejects.toThrow(
        'Archive parts are missing: 2'
      )

      await fs.writeFile(secondPartPath, secondPartContents)
      const archiveInfo = await inspectLocalLibraryArchive(lastPartPath)
      expect(archiveInfo).toEqual({
        archivePath: firstPartPath,
        isMultipart: true,
        missingParts: [],
        partPaths: partNames.map((name) => join(rootPath, name))
      })

      const entries = await listLocalLibraryArchive(lastPartPath)
      expect(entries).toEqual([
        {
          path: 'payload.bin',
          isDirectory: false,
          size: payload.length
        }
      ])

      const result = await extractLocalLibraryArchive({
        archivePath: lastPartPath,
        destinationName: 'Extracted Multipart Game',
        selectedPaths: ['payload.bin']
      })
      await expect(
        fs.readFile(join(result.folderPath, 'payload.bin'))
      ).resolves.toEqual(payload)

      await deleteLocalLibraryArchive(lastPartPath)
      await Promise.all(
        archiveInfo.partPaths.map((partPath) =>
          expect(fs.access(partPath)).rejects.toMatchObject({ code: 'ENOENT' })
        )
      )
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })

  it('deletes only supported archive files', async () => {
    const rootPath = await fs.mkdtemp(
      join(process.cwd(), '.tmp-heroic-delete-archive-')
    )
    const archivePath = join(rootPath, 'game.zip')
    const ordinaryFilePath = join(rootPath, 'game.exe')

    try {
      await fs.writeFile(archivePath, 'archive')
      await fs.writeFile(ordinaryFilePath, 'game')

      await deleteLocalLibraryArchive(archivePath)
      await expect(fs.access(archivePath)).rejects.toMatchObject({
        code: 'ENOENT'
      })
      await expect(deleteLocalLibraryArchive(ordinaryFilePath)).rejects.toThrow(
        'not a supported archive'
      )
      await expect(fs.readFile(ordinaryFilePath, 'utf8')).resolves.toBe('game')
    } finally {
      await fs.rm(rootPath, { recursive: true, force: true })
    }
  })
})
