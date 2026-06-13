import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, join, resolve } from 'path'

import { path7z } from '7zip-bin-full'
import sanitizeFilename from 'sanitize-filename'

import type { LocalLibraryArchiveEntry } from 'common/types'

import { fixAsarPath } from './constants/paths'
import { spawnAsync } from './utils'

const ARCHIVE_EXTENSIONS = [
  '.tar.bz2',
  '.tar.gz',
  '.tar.lz',
  '.tar.lz4',
  '.tar.lzma',
  '.tar.xz',
  '.tar.zst',
  '.tbz2',
  '.zipx',
  '.7z',
  '.ace',
  '.alz',
  '.arc',
  '.arj',
  '.bz',
  '.bz2',
  '.cab',
  '.cpio',
  '.gz',
  '.gzip',
  '.lha',
  '.lzh',
  '.lz',
  '.lz4',
  '.lzma',
  '.rar',
  '.tar',
  '.taz',
  '.tbz',
  '.tgz',
  '.tlz',
  '.txz',
  '.tzst',
  '.xz',
  '.zip',
  '.zst'
] as const

type ExtractArchiveOptions = {
  archivePath: string
  destinationName: string
  password?: string
  selectedPaths: string[]
  onBeforePathCreated?: (path: string) => void
}

const PASSWORD_ERROR_PATTERN =
  /cannot open encrypted archive|wrong password|data error in encrypted file/i

function getArchivePasswordArgument(password?: string): string {
  return `-p${password ?? ''}`
}

function getArchiveCommandError(
  stdout: string,
  stderr: string,
  fallbackMessage: string
): Error {
  const commandOutput = stderr.trim() || stdout.trim()
  if (PASSWORD_ERROR_PATTERN.test(commandOutput)) {
    return new Error('Archive password is required or incorrect')
  }

  return new Error(commandOutput || fallbackMessage)
}

function getArchiveExtension(fileName: string): string | undefined {
  const normalizedFileName = fileName.toLowerCase()
  return ARCHIVE_EXTENSIONS.find((extension) =>
    normalizedFileName.endsWith(extension)
  )
}

function getArchiveTitle(fileName: string): string {
  const archiveExtension = getArchiveExtension(fileName)
  if (!archiveExtension) {
    return fileName
  }

  return fileName.slice(0, -archiveExtension.length) || fileName
}

function normalizeArchiveEntryPath(entryPath: string): string {
  const normalizedPath = entryPath
    .replaceAll('\\', '/')
    .replace(/^\.\/+/, '')
    .replace(/\/+$/, '')
  const pathParts = normalizedPath.split('/')

  if (
    !normalizedPath ||
    normalizedPath.includes('\0') ||
    normalizedPath.startsWith('/') ||
    /^[a-z]:/i.test(normalizedPath) ||
    pathParts.some((part) => !part || part === '.' || part === '..')
  ) {
    throw new Error(`Archive contains an unsafe path: ${entryPath}`)
  }

  return pathParts.join('/')
}

function parseArchiveListing(output: string): LocalLibraryArchiveEntry[] {
  const entries = new Map<string, LocalLibraryArchiveEntry>()

  for (const block of output.split(/\r?\n\r?\n/)) {
    const values = new Map<string, string>()

    for (const line of block.split(/\r?\n/)) {
      const separatorIndex = line.indexOf(' = ')
      if (separatorIndex === -1) {
        continue
      }

      values.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 3))
    }

    const listedPath = values.get('Path')
    if (!listedPath) {
      continue
    }

    const entryPath = normalizeArchiveEntryPath(listedPath)
    const isDirectory =
      values.get('Folder') === '+' ||
      values.get('Attributes')?.startsWith('D') === true
    const size = Number.parseInt(values.get('Size') ?? '0', 10)
    entries.set(entryPath, {
      path: entryPath,
      isDirectory,
      size: Number.isFinite(size) ? size : 0,
      ...(values.get('Encrypted') === '+' ? { isEncrypted: true } : {})
    })

    const pathParts = entryPath.split('/')
    pathParts.pop()
    while (pathParts.length > 0) {
      const parentPath = pathParts.join('/')
      if (!entries.has(parentPath)) {
        entries.set(parentPath, {
          path: parentPath,
          isDirectory: true,
          size: 0
        })
      }
      pathParts.pop()
    }
  }

  return [...entries.values()].sort((left, right) => {
    const depthDifference =
      left.path.split('/').length - right.path.split('/').length
    return depthDifference || left.path.localeCompare(right.path)
  })
}

async function listLocalLibraryArchive(
  archivePath: string,
  password?: string
): Promise<LocalLibraryArchiveEntry[]> {
  const archiveStats = await fs.stat(archivePath)
  if (!archiveStats.isFile() || !getArchiveExtension(archivePath)) {
    throw new Error('The selected path is not a supported archive')
  }

  const { code, stdout, stderr } = await spawnAsync(
    fixAsarPath(path7z),
    [
      'l',
      '-slt',
      '-ba',
      getArchivePasswordArgument(password),
      '--',
      archivePath
    ],
    { windowsHide: true }
  )

  if (code !== 0) {
    throw getArchiveCommandError(stdout, stderr, 'Unable to read the archive')
  }

  const entries = parseArchiveListing(stdout)
  if (entries.length === 0) {
    throw new Error('The archive does not contain any files or directories')
  }

  return entries
}

function validateDestinationName(destinationName: string): string {
  const normalizedName = destinationName.trim()
  if (
    !normalizedName ||
    normalizedName === '.' ||
    normalizedName === '..' ||
    basename(normalizedName) !== normalizedName ||
    sanitizeFilename(normalizedName) !== normalizedName
  ) {
    throw new Error('Enter a valid folder name')
  }

  return normalizedName
}

function expandSelectedPaths(
  entries: LocalLibraryArchiveEntry[],
  selectedPaths: string[]
): Set<string> {
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]))
  const selected = new Set<string>()

  for (const selectedPath of selectedPaths) {
    const normalizedPath = normalizeArchiveEntryPath(selectedPath)
    const selectedEntry = entriesByPath.get(normalizedPath)
    if (!selectedEntry) {
      throw new Error(`Archive entry no longer exists: ${selectedPath}`)
    }

    selected.add(normalizedPath)
    if (selectedEntry.isDirectory) {
      for (const entry of entries) {
        if (entry.path.startsWith(`${normalizedPath}/`)) {
          selected.add(entry.path)
        }
      }
    }
  }

  for (const selectedPath of [...selected]) {
    const pathParts = selectedPath.split('/')
    pathParts.pop()
    while (pathParts.length > 0) {
      selected.add(pathParts.join('/'))
      pathParts.pop()
    }
  }

  return selected
}

async function pruneExtractedTree(
  rootPath: string,
  selectedPaths: Set<string>,
  relativePath = ''
): Promise<void> {
  const entries = await fs.readdir(join(rootPath, relativePath), {
    withFileTypes: true
  })

  for (const entry of entries) {
    const entryPath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name
    const fullPath = join(rootPath, ...entryPath.split('/'))

    if (!selectedPaths.has(entryPath)) {
      await fs.rm(fullPath, { recursive: true, force: true })
      continue
    }

    if (entry.isDirectory()) {
      await pruneExtractedTree(rootPath, selectedPaths, entryPath)
    }
  }
}

async function moveExtractionResult(
  stagingPath: string,
  destinationPath: string
): Promise<void> {
  const topLevelEntries = await fs.readdir(stagingPath, {
    withFileTypes: true
  })

  if (topLevelEntries.length === 1 && topLevelEntries[0].isDirectory()) {
    await fs.rename(join(stagingPath, topLevelEntries[0].name), destinationPath)
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {})
    return
  }

  await fs.rename(stagingPath, destinationPath)
}

async function extractLocalLibraryArchive({
  archivePath,
  destinationName,
  password,
  selectedPaths,
  onBeforePathCreated
}: ExtractArchiveOptions): Promise<{ folderPath: string; title: string }> {
  const entries = await listLocalLibraryArchive(archivePath, password)
  const selected = expandSelectedPaths(entries, selectedPaths)
  if (selected.size === 0) {
    throw new Error('Select at least one file or directory to extract')
  }

  const normalizedDestinationName = validateDestinationName(destinationName)
  const archiveDirectory = resolve(dirname(archivePath))
  const destinationPath = resolve(archiveDirectory, normalizedDestinationName)
  if (dirname(destinationPath) !== archiveDirectory) {
    throw new Error('The extraction folder must be beside the archive')
  }

  try {
    await fs.access(destinationPath)
    throw new Error(`The folder "${normalizedDestinationName}" already exists`)
  } catch (error) {
    if (
      typeof error === 'object' &&
      error !== null &&
      'code' in error &&
      error.code === 'ENOENT'
    ) {
      // The destination must not exist before extraction.
    } else {
      throw error
    }
  }

  const stagingPath = join(archiveDirectory, `.heroic-extract-${randomUUID()}`)
  onBeforePathCreated?.(stagingPath)
  onBeforePathCreated?.(destinationPath)
  await fs.mkdir(stagingPath)

  try {
    const { code, stdout, stderr } = await spawnAsync(
      fixAsarPath(path7z),
      [
        'x',
        '-y',
        getArchivePasswordArgument(password),
        `-o${stagingPath}`,
        '--',
        archivePath
      ],
      { windowsHide: true }
    )

    if (code !== 0) {
      throw getArchiveCommandError(
        stdout,
        stderr,
        'Unable to extract the archive'
      )
    }

    await pruneExtractedTree(stagingPath, selected)
    await moveExtractionResult(stagingPath, destinationPath)

    return {
      folderPath: destinationPath,
      title: normalizedDestinationName
    }
  } catch (error) {
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {})
    throw error
  }
}

export {
  extractLocalLibraryArchive,
  getArchiveExtension,
  getArchiveTitle,
  listLocalLibraryArchive,
  parseArchiveListing,
  validateDestinationName
}
