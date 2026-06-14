import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, join, resolve } from 'path'

import { path7z } from '7zip-bin-full'
import sanitizeFilename from 'sanitize-filename'

import {
  getArchivePart,
  getArchiveExtension,
  getArchiveTitle
} from 'common/local_library_archive'
import type {
  LocalLibraryArchiveEntry,
  LocalLibraryArchiveInfo
} from 'common/types'

import { fixAsarPath } from './constants/paths'
import { spawnAsync } from './utils'

type ExtractArchiveOptions = {
  archivePath: string
  destinationName: string
  password?: string
  rootPath?: string
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

async function inspectLocalLibraryArchive(
  archivePath: string
): Promise<LocalLibraryArchiveInfo> {
  const archiveStats = await fs.stat(archivePath)
  if (!archiveStats.isFile() || !getArchiveExtension(archivePath)) {
    throw new Error('The selected path is not a supported archive')
  }

  const selectedPart = getArchivePart(basename(archivePath))
  if (!selectedPart) {
    return {
      archivePath,
      isMultipart: false,
      missingParts: [],
      partPaths: [archivePath]
    }
  }

  const archiveDirectory = dirname(archivePath)
  const directoryEntries = await fs.readdir(archiveDirectory, {
    withFileTypes: true
  })
  const parts = directoryEntries
    .filter((entry) => entry.isFile())
    .map((entry) => ({
      entry,
      part: getArchivePart(entry.name)
    }))
    .filter(
      (
        candidate
      ): candidate is {
        entry: (typeof directoryEntries)[number]
        part: NonNullable<ReturnType<typeof getArchivePart>>
      } => candidate.part?.signature === selectedPart.signature
    )
    .sort((left, right) => left.part.partNumber - right.part.partNumber)

  const highestPartNumber = parts.at(-1)?.part.partNumber ?? 0
  const existingPartNumbers = new Set(parts.map(({ part }) => part.partNumber))
  const missingParts = Array.from(
    { length: highestPartNumber },
    (_, index) => index + 1
  ).filter((partNumber) => !existingPartNumbers.has(partNumber))
  const firstPart = parts.find(({ part }) => part.partNumber === 1)

  return {
    archivePath: firstPart
      ? join(archiveDirectory, firstPart.entry.name)
      : archivePath,
    isMultipart: true,
    missingParts,
    partPaths: parts.map(({ entry }) => join(archiveDirectory, entry.name))
  }
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
  const archiveInfo = await inspectLocalLibraryArchive(archivePath)
  if (archiveInfo.missingParts.length > 0) {
    throw new Error(
      `Archive parts are missing: ${archiveInfo.missingParts.join(', ')}`
    )
  }

  const { code, stdout, stderr } = await spawnAsync(
    fixAsarPath(path7z),
    [
      'l',
      '-slt',
      '-ba',
      getArchivePasswordArgument(password),
      '--',
      archiveInfo.archivePath
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

async function deleteLocalLibraryArchive(archivePath: string): Promise<void> {
  const archiveInfo = await inspectLocalLibraryArchive(archivePath)
  await Promise.all(
    archiveInfo.partPaths.map((partPath) => fs.unlink(partPath))
  )
}

function expandSelectedPaths(
  entries: LocalLibraryArchiveEntry[],
  selectedPaths: string[]
): { paths: Set<string>; hasMatchingEntry: boolean } {
  const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]))
  const selected = new Set<string>()
  let hasMatchingEntry = false

  for (const selectedPath of selectedPaths) {
    const normalizedPath = normalizeArchiveEntryPath(selectedPath)
    const selectedEntry = entriesByPath.get(normalizedPath)

    selected.add(normalizedPath)
    if (!selectedEntry) {
      continue
    }

    hasMatchingEntry = true
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

  return { paths: selected, hasMatchingEntry }
}

function validateExtractionRoot(
  entries: LocalLibraryArchiveEntry[],
  rootPath?: string
): string | undefined {
  if (!rootPath) {
    return
  }

  const normalizedRootPath = normalizeArchiveEntryPath(rootPath)
  const rootEntry = entries.find((entry) => entry.path === normalizedRootPath)
  if (!rootEntry?.isDirectory) {
    throw new Error('The selected final folder is not a directory')
  }

  return normalizedRootPath
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
  destinationPath: string,
  archivePath: string,
  rootPath?: string
): Promise<void> {
  if (rootPath) {
    await fs.rename(join(stagingPath, ...rootPath.split('/')), destinationPath)
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {})
    return
  }

  const topLevelEntries = await fs.readdir(stagingPath, {
    withFileTypes: true
  })

  if (topLevelEntries.length === 1 && topLevelEntries[0].isDirectory()) {
    let extractionRoot = join(stagingPath, topLevelEntries[0].name)
    const archiveTitle = getArchiveTitle(basename(archivePath))

    if (
      topLevelEntries[0].name.localeCompare(archiveTitle, undefined, {
        sensitivity: 'accent'
      }) === 0
    ) {
      const wrapperEntries = await fs.readdir(extractionRoot, {
        withFileTypes: true
      })
      if (wrapperEntries.length === 1 && wrapperEntries[0].isDirectory()) {
        extractionRoot = join(extractionRoot, wrapperEntries[0].name)
      }
    }

    await fs.rename(extractionRoot, destinationPath)
    await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {})
    return
  }

  await fs.rename(stagingPath, destinationPath)
}

async function extractLocalLibraryArchive({
  archivePath,
  destinationName,
  password,
  rootPath,
  selectedPaths,
  onBeforePathCreated
}: ExtractArchiveOptions): Promise<{ folderPath: string; title: string }> {
  const archiveInfo = await inspectLocalLibraryArchive(archivePath)
  const canonicalArchivePath = archiveInfo.archivePath
  const entries = await listLocalLibraryArchive(canonicalArchivePath, password)
  const { paths: selected, hasMatchingEntry } = expandSelectedPaths(
    entries,
    selectedPaths
  )
  const normalizedRootPath = validateExtractionRoot(entries, rootPath)
  if (selected.size === 0) {
    throw new Error('Select at least one file or directory to extract')
  }
  if (!hasMatchingEntry) {
    throw new Error('The selected archive entries no longer exist')
  }
  if (
    normalizedRootPath &&
    ![...selected].some(
      (selectedPath) =>
        selectedPath === normalizedRootPath ||
        selectedPath.startsWith(`${normalizedRootPath}/`)
    )
  ) {
    throw new Error('Select at least one item inside the final folder')
  }

  const normalizedDestinationName = validateDestinationName(destinationName)
  const archiveDirectory = resolve(dirname(canonicalArchivePath))
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
        canonicalArchivePath
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
    await moveExtractionResult(
      stagingPath,
      destinationPath,
      canonicalArchivePath,
      normalizedRootPath
    )

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
  deleteLocalLibraryArchive,
  extractLocalLibraryArchive,
  getArchiveExtension,
  getArchivePart,
  getArchiveTitle,
  inspectLocalLibraryArchive,
  listLocalLibraryArchive,
  parseArchiveListing,
  validateDestinationName
}
