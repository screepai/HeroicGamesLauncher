const LOCAL_LIBRARY_ARCHIVE_EXTENSIONS = [
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

type LocalLibraryArchivePart = {
  archiveExtension: string
  baseName: string
  partNumber: number
  signature: string
}

function getRegularArchiveExtension(fileName: string): string | undefined {
  const normalizedFileName = fileName.toLowerCase()
  return LOCAL_LIBRARY_ARCHIVE_EXTENSIONS.find((extension) =>
    normalizedFileName.endsWith(extension)
  )
}

function getArchivePart(fileName: string): LocalLibraryArchivePart | undefined {
  const archiveExtension = getRegularArchiveExtension(fileName)
  if (archiveExtension) {
    const stem = fileName.slice(0, -archiveExtension.length)
    const partMatch = /^(.*)([._ -]part)(\d+)$/i.exec(stem)
    if (!partMatch) {
      return
    }

    return {
      archiveExtension,
      baseName: partMatch[1],
      partNumber: Number.parseInt(partMatch[3], 10),
      signature:
        `${partMatch[1]}${partMatch[2]}#${archiveExtension}`.toLowerCase()
    }
  }

  const volumeMatch = /^(.*)\.(\d{3,})$/.exec(fileName)
  if (!volumeMatch) {
    return
  }

  const baseArchiveExtension = getRegularArchiveExtension(volumeMatch[1])
  if (!baseArchiveExtension) {
    return
  }

  return {
    archiveExtension: `${baseArchiveExtension}.${volumeMatch[2]}`,
    baseName: volumeMatch[1].slice(0, -baseArchiveExtension.length),
    partNumber: Number.parseInt(volumeMatch[2], 10),
    signature: `${volumeMatch[1]}.#`.toLowerCase()
  }
}

function getArchiveExtension(fileName: string): string | undefined {
  return (
    getArchivePart(fileName)?.archiveExtension ??
    getRegularArchiveExtension(fileName)
  )
}

function getArchiveTitle(fileName: string): string {
  const archivePart = getArchivePart(fileName)
  if (archivePart) {
    return archivePart.baseName || fileName
  }

  const archiveExtension = getArchiveExtension(fileName)
  if (!archiveExtension) {
    return fileName
  }

  return fileName.slice(0, -archiveExtension.length) || fileName
}

export {
  getArchivePart,
  getArchiveExtension,
  getArchiveTitle,
  LOCAL_LIBRARY_ARCHIVE_EXTENSIONS
}
export type { LocalLibraryArchivePart }
