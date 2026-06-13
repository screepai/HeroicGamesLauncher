import { execFile } from 'child_process'
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
