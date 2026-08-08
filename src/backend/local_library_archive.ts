import { randomUUID } from 'crypto'
import { promises as fs } from 'fs'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'path'

import { path7z } from '7zip-bin-full'
import sanitizeFilename from 'sanitize-filename'

import {
  getArchivePart,
  getArchiveExtension,
  getArchiveTitle
} from 'common/local_library_archive'
import type {
  LocalLibraryArchiveEntry,
  LocalLibraryArchiveExtractionProgress,
  LocalLibraryArchiveInfo,
  LocalLibraryWatchEntry
} from 'common/types'

import { fixAsarPath } from './constants/paths'
import { spawnAsync } from './utils'

type ExtractArchiveOptions = {
  archivePath: string
  cleanupPath?: string
  destinationDirectory?: string
  destinationName: string
  password?: string
  rootPath?: string
  selectedPaths: string[]
  onBeforePathCreated?: (path: string) => void
  onProgress?: (progress: LocalLibraryArchiveExtractionProgress) => void
}

type ArchiveExtractionPlan = {
  archivePath: string
  cleanupPath?: string
  destinationName: string
  destinationPath: string
  rootPath?: string
  selectedPaths: Set<string>
  stagingPath: string
}

const PASSWORD_ERROR_PATTERN =
  /cannot open encrypted archive|wrong password|data error in encrypted file/i
const INCOMPLETE_ARCHIVE_ERROR_PATTERN =
  /unexpected end of archive|missing volume|cannot find volume/i
const BACKSPACE_CHARACTER = String.fromCharCode(8)

function getArchivePasswordArgument(password?: string): string {
  return `-p${password ?? ''}`
}

function getArchiveCommandError(
  stdout: string,
  stderr: string,
  fallbackMessage: string
): Error {
  const commandOutput = stderr.trim() || stdout.trim()
  const combinedOutput = `${stdout}\n${stderr}`
  if (PASSWORD_ERROR_PATTERN.test(combinedOutput)) {
    return new Error('Archive password is required or incorrect')
  }
  if (INCOMPLETE_ARCHIVE_ERROR_PATTERN.test(combinedOutput)) {
    return new Error(
      'The archive is incomplete. Add the remaining parts and try again.'
    )
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

function parseArchiveListingBlock(
  block: string
): LocalLibraryArchiveEntry | undefined {
  const values = new Map<string, string>()
  for (const line of block.split(/\r?\n/)) {
    const separatorIndex = line.indexOf(' = ')
    if (separatorIndex !== -1) {
      values.set(line.slice(0, separatorIndex), line.slice(separatorIndex + 3))
    }
  }

  const listedPath = values.get('Path')
  if (!listedPath) {
    return
  }

  const path = normalizeArchiveEntryPath(listedPath)
  const size = Number.parseInt(values.get('Size') ?? '0', 10)
  return {
    path,
    isDirectory:
      values.get('Folder') === '+' ||
      values.get('Attributes')?.startsWith('D') === true,
    size: Number.isFinite(size) ? size : 0,
    ...(values.get('Encrypted') === '+' ? { isEncrypted: true } : {})
  }
}

function addImplicitParentDirectories(
  entries: Map<string, LocalLibraryArchiveEntry>,
  entryPath: string
): void {
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

function parseArchiveListing(output: string): LocalLibraryArchiveEntry[] {
  const entries = new Map<string, LocalLibraryArchiveEntry>()

  for (const block of output.split(/\r?\n\r?\n/)) {
    const entry = parseArchiveListingBlock(block)
    if (entry) {
      entries.set(entry.path, entry)
      addImplicitParentDirectories(entries, entry.path)
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
      '-sccUTF-8',
      getArchivePasswordArgument(password),
      '--',
      archiveInfo.archivePath
    ],
    { windowsHide: true },
    undefined,
    { captureAllOutput: true }
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

function isPathInside(parentPath: string, childPath: string): boolean {
  const pathDifference = relative(parentPath, childPath)
  return (
    pathDifference.length > 0 &&
    !pathDifference.startsWith('..') &&
    !isAbsolute(pathDifference)
  )
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

async function removeStagingPath(stagingPath: string): Promise<void> {
  await fs.rm(stagingPath, { recursive: true, force: true }).catch(() => {})
}

async function moveExtractionResult(
  stagingPath: string,
  destinationPath: string,
  archivePath: string,
  rootPath?: string
): Promise<void> {
  if (rootPath) {
    await fs.rename(join(stagingPath, ...rootPath.split('/')), destinationPath)
    await removeStagingPath(stagingPath)
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
    await removeStagingPath(stagingPath)
    return
  }

  await fs.rename(stagingPath, destinationPath)
}

function getFileSystemErrorCode(error: unknown): string | undefined {
  return typeof error === 'object' && error !== null && 'code' in error
    ? String(error.code)
    : undefined
}

async function requireDirectory(
  directoryPath: string,
  invalidMessage: string
): Promise<void> {
  try {
    const stats = await fs.stat(directoryPath)
    if (stats.isDirectory()) {
      return
    }
  } catch (error) {
    if (getFileSystemErrorCode(error) !== 'ENOENT') {
      throw error
    }
  }

  throw new Error(invalidMessage)
}

async function ensureDestinationDoesNotExist(
  destinationPath: string,
  destinationName: string
): Promise<void> {
  try {
    await fs.access(destinationPath)
  } catch (error) {
    if (getFileSystemErrorCode(error) === 'ENOENT') {
      return
    }
    throw error
  }

  throw new Error(`The folder "${destinationName}" already exists`)
}

function validateSelectedArchivePaths(
  selectedPaths: Set<string>,
  hasMatchingEntry: boolean,
  rootPath?: string
): void {
  if (selectedPaths.size === 0) {
    throw new Error('Select at least one file or directory to extract')
  }
  if (!hasMatchingEntry) {
    throw new Error('The selected archive entries no longer exist')
  }
  if (
    rootPath &&
    ![...selectedPaths].some(
      (selectedPath) =>
        selectedPath === rootPath || selectedPath.startsWith(`${rootPath}/`)
    )
  ) {
    throw new Error('Select at least one item inside the final folder')
  }
}

async function createArchiveExtractionPlan(
  options: ExtractArchiveOptions
): Promise<ArchiveExtractionPlan> {
  const archiveInfo = await inspectLocalLibraryArchive(options.archivePath)
  const archivePath = archiveInfo.archivePath
  const entries = await listLocalLibraryArchive(archivePath, options.password)
  const { paths: selectedPaths, hasMatchingEntry } = expandSelectedPaths(
    entries,
    options.selectedPaths
  )
  const rootPath = validateExtractionRoot(entries, options.rootPath)
  validateSelectedArchivePaths(selectedPaths, hasMatchingEntry, rootPath)

  const destinationName = validateDestinationName(options.destinationName)
  const destinationDirectory = resolve(
    options.destinationDirectory ?? dirname(archivePath)
  )
  await requireDirectory(
    destinationDirectory,
    'The extraction destination must be an existing directory'
  )

  const destinationPath = join(destinationDirectory, destinationName)
  const cleanupPath = options.cleanupPath
    ? resolve(options.cleanupPath)
    : undefined
  if (cleanupPath) {
    await requireDirectory(cleanupPath, 'The cleanup path must be a directory')
    const [realArchivePath, realCleanupPath, realDestinationDirectory] =
      await Promise.all([
        fs.realpath(archivePath),
        fs.realpath(cleanupPath),
        fs.realpath(destinationDirectory)
      ])
    const realDestinationPath = join(realDestinationDirectory, destinationName)

    if (!isPathInside(realCleanupPath, realArchivePath)) {
      throw new Error('The archive must be inside the cleanup folder')
    }
    if (
      realDestinationPath === realCleanupPath ||
      isPathInside(realCleanupPath, realDestinationPath)
    ) {
      throw new Error(
        'The extraction folder must be outside the cleanup folder'
      )
    }
  }

  await ensureDestinationDoesNotExist(destinationPath, destinationName)

  return {
    archivePath,
    cleanupPath,
    destinationName,
    destinationPath,
    rootPath,
    selectedPaths,
    stagingPath: join(destinationDirectory, `.heroic-extract-${randomUUID()}`)
  }
}

function parseExtractionProgressLine(
  outputLine: string,
  currentProgress: LocalLibraryArchiveExtractionProgress
): LocalLibraryArchiveExtractionProgress {
  const line = outputLine.replaceAll(BACKSPACE_CHARACTER, '').trim()
  const percentMatch = /(\d{1,3})%/.exec(line)
  const fileMatch = /(?:^|\s)-\s+(.+)$/.exec(line)
  const extractedPath = fileMatch?.[1]
  const percent =
    line === 'Everything is Ok'
      ? 100
      : percentMatch
        ? Math.min(Number.parseInt(percentMatch[1], 10), 100)
        : currentProgress.percent
  const file =
    extractedPath && !/[\\/]$/.test(extractedPath)
      ? extractedPath
      : currentProgress.file

  return { percent, file }
}

function createExtractionProgressReporter(
  onProgress?: (progress: LocalLibraryArchiveExtractionProgress) => void
) {
  let outputBuffer = ''
  let progress: LocalLibraryArchiveExtractionProgress = { percent: 0 }

  return {
    start: () => {
      onProgress?.(progress)
    },
    handleOutput: (data: string) => {
      outputBuffer += data
      const lines = outputBuffer.split(/\r\n|\r|\n/)
      outputBuffer = lines.pop() ?? ''

      for (const line of lines) {
        const nextProgress = parseExtractionProgressLine(line, progress)
        if (
          nextProgress.percent !== progress.percent ||
          nextProgress.file !== progress.file
        ) {
          progress = nextProgress
          onProgress?.(progress)
        }
      }
    },
    complete: () => {
      onProgress?.({ ...progress, percent: 100 })
    }
  }
}

async function findLocalLibraryNestedArchives(
  folderPath: string
): Promise<LocalLibraryWatchEntry[]> {
  const resolvedFolderPath = resolve(folderPath)
  const folderStats = await fs.stat(resolvedFolderPath)
  if (!folderStats.isDirectory()) {
    return []
  }

  const entries = await fs.readdir(resolvedFolderPath, { withFileTypes: true })
  const archiveGroups = new Map<
    string,
    { archiveName?: string; entryNames: Set<string> }
  >()

  for (const entry of entries) {
    if (!entry.isFile() || !getArchiveExtension(entry.name)) {
      continue
    }

    const archivePart = getArchivePart(entry.name)
    const groupKey =
      archivePart?.signature ?? `file:${entry.name.toLowerCase()}`
    const group = archiveGroups.get(groupKey) ?? { entryNames: new Set() }
    group.entryNames.add(entry.name)
    if (!archivePart || archivePart.partNumber === 1) {
      group.archiveName = entry.name
    }
    archiveGroups.set(groupKey, group)
  }

  return [...archiveGroups.values()]
    .filter(
      (group): group is { archiveName: string; entryNames: Set<string> } =>
        group.archiveName !== undefined
    )
    .sort((left, right) => left.archiveName.localeCompare(right.archiveName))
    .map(({ archiveName, entryNames }) => {
      const shouldKeepWrapper = entries.some(
        (entry) => !entryNames.has(entry.name)
      )

      return {
        ...(shouldKeepWrapper
          ? {}
          : { cleanupAfterExtractionPath: resolvedFolderPath }),
        extractionDestinationDirectory: shouldKeepWrapper
          ? resolvedFolderPath
          : dirname(resolvedFolderPath),
        folderPath: join(resolvedFolderPath, archiveName),
        isArchive: true,
        title: getArchiveTitle(archiveName)
      }
    })
}

async function extractLocalLibraryArchive(
  options: ExtractArchiveOptions
): Promise<{ folderPath: string; title: string }> {
  const { onBeforePathCreated, onProgress, password } = options
  const plan = await createArchiveExtractionPlan(options)
  const progressReporter = createExtractionProgressReporter(onProgress)

  onBeforePathCreated?.(plan.stagingPath)
  onBeforePathCreated?.(plan.destinationPath)
  await fs.mkdir(plan.stagingPath)

  try {
    progressReporter.start()
    const { code, stdout, stderr } = await spawnAsync(
      fixAsarPath(path7z),
      [
        'x',
        '-y',
        '-bb1',
        '-bsp1',
        '-sccUTF-8',
        getArchivePasswordArgument(password),
        `-o${plan.stagingPath}`,
        '--',
        plan.archivePath
      ],
      { windowsHide: true },
      progressReporter.handleOutput
    )
    progressReporter.handleOutput('\n')

    if (code !== 0) {
      throw getArchiveCommandError(
        stdout,
        stderr,
        'Unable to extract the archive'
      )
    }

    await pruneExtractedTree(plan.stagingPath, plan.selectedPaths)
    await moveExtractionResult(
      plan.stagingPath,
      plan.destinationPath,
      plan.archivePath,
      plan.rootPath
    )
    if (plan.cleanupPath) {
      await fs.rm(plan.cleanupPath, { recursive: true, force: true })
    }
    progressReporter.complete()

    return {
      folderPath: plan.destinationPath,
      title: plan.destinationName
    }
  } catch (error) {
    await removeStagingPath(plan.stagingPath)
    throw error
  }
}

export {
  deleteLocalLibraryArchive,
  extractLocalLibraryArchive,
  findLocalLibraryNestedArchives,
  getArchiveExtension,
  getArchivePart,
  getArchiveTitle,
  inspectLocalLibraryArchive,
  listLocalLibraryArchive,
  parseArchiveListing,
  validateDestinationName
}
