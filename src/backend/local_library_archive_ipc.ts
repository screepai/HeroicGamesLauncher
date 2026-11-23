import { app } from 'electron'

import { addHandler, sendFrontendMessage } from './ipc'
import {
  cancelAllLocalLibraryArchiveExtractions,
  cancelLocalLibraryArchiveExtraction,
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

addHandler('cancelLocalLibraryArchiveExtraction', (_event, archivePath) =>
  cancelLocalLibraryArchiveExtraction(archivePath)
)

// Do not leave 7z children running when the app quits mid-extraction
app.on('before-quit', cancelAllLocalLibraryArchiveExtractions)

addHandler('deleteLocalLibraryArchive', (_event, archivePath) =>
  deleteLocalLibraryArchive(archivePath)
)

addHandler('findLocalLibraryNestedArchives', (_event, folderPath) =>
  findLocalLibraryNestedArchives(folderPath)
)
