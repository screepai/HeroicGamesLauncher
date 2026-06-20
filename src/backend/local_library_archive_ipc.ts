import { addHandler, sendFrontendMessage } from './ipc'
import {
  deleteLocalLibraryArchive,
  extractLocalLibraryArchive,
  findLocalLibraryNestedArchives,
  inspectLocalLibraryArchive,
  listLocalLibraryArchive
} from './local_library_archive'
import { suppressLocalLibraryPath } from './local_library_watcher'

addHandler('inspectLocalLibraryArchive', (_event, archivePath) =>
  inspectLocalLibraryArchive(archivePath)
)

addHandler('listLocalLibraryArchive', (_event, args) =>
  listLocalLibraryArchive(args.archivePath, args.password)
)

addHandler('extractLocalLibraryArchive', (_event, args) =>
  extractLocalLibraryArchive({
    ...args,
    onBeforePathCreated: suppressLocalLibraryPath,
    onProgress: (progress) =>
      sendFrontendMessage(
        'localLibraryArchiveExtractionProgress',
        args.archivePath,
        progress
      )
  })
)

addHandler('deleteLocalLibraryArchive', (_event, archivePath) =>
  deleteLocalLibraryArchive(archivePath)
)

addHandler('findLocalLibraryNestedArchives', (_event, folderPath) =>
  findLocalLibraryNestedArchives(folderPath)
)
