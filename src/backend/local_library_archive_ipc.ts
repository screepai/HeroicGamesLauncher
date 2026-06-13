import { addHandler } from './ipc'
import {
  deleteLocalLibraryArchive,
  extractLocalLibraryArchive,
  listLocalLibraryArchive
} from './local_library_archive'
import { suppressLocalLibraryPath } from './local_library_watcher'

addHandler('listLocalLibraryArchive', (_event, args) =>
  listLocalLibraryArchive(args.archivePath, args.password)
)

addHandler('extractLocalLibraryArchive', (_event, args) =>
  extractLocalLibraryArchive({
    ...args,
    onBeforePathCreated: suppressLocalLibraryPath
  })
)

addHandler('deleteLocalLibraryArchive', (_event, archivePath) =>
  deleteLocalLibraryArchive(archivePath)
)
