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

function getArchiveExtension(fileName: string): string | undefined {
  const normalizedFileName = fileName.toLowerCase()
  return LOCAL_LIBRARY_ARCHIVE_EXTENSIONS.find((extension) =>
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

export {
  getArchiveExtension,
  getArchiveTitle,
  LOCAL_LIBRARY_ARCHIVE_EXTENSIONS
}
