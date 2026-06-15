import { StoreOptions } from './../../common/types/electron_store'
import tmp from 'tmp'
import { isAbsolute, join, parse, relative } from 'path'

const OriginalStore = jest.requireActual('electron-store')
const tmpStoreRootDirectory = tmp.dirSync({ unsafeCleanup: true })

export default class Store<
  T extends Record<string, any> = Record<string, unknown>
> extends OriginalStore<T> {
  constructor(options?: StoreOptions<T>) {
    if (options) {
      if (options.cwd) {
        const storePath = isAbsolute(options.cwd)
          ? relative(parse(options.cwd).root, options.cwd)
          : options.cwd
        options.cwd = join(tmpStoreRootDirectory.name, storePath)
      } else {
        options.cwd = tmpStoreRootDirectory.name
      }
    } else {
      options = {
        cwd: tmpStoreRootDirectory.name
      }
    }
    super(options)
  }
}
