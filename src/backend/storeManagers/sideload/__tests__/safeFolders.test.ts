import { join, parse, resolve } from 'path'
import { homedir, tmpdir } from 'os'

const mockLibraryRoot = resolve(tmpdir(), 'heroic-safe-folders', 'Library')
const mockHome = homedir()
const libraryRoot = mockLibraryRoot
const downloads = join(mockHome, 'Downloads')

// The factories only read these variables when the functions are called.
jest.mock('electron', () => ({
  app: {
    getPath: (name: string) => {
      if (name === 'music') throw new Error('not available')
      return join(mockHome, name === 'downloads' ? 'Downloads' : name)
    }
  }
}))
jest.mock('backend/config', () => ({
  GlobalConfig: {
    get: () => ({
      getSettings: () => ({
        localLibrarySyncPath: mockLibraryRoot,
        defaultInstallPath: '',
        defaultWinePrefixDir: undefined
      })
    })
  }
}))

import { getUnsafeGameFolderReason } from '../safeFolders'

describe('getUnsafeGameFolderReason', () => {
  it('allows a folder that belongs to one game', () => {
    expect(getUnsafeGameFolderReason(join(libraryRoot, 'My VN'))).toBe(
      undefined
    )
    expect(
      getUnsafeGameFolderReason(join(downloads, 'Some Game', 'bin'))
    ).toBeUndefined()
  })

  it('refuses a drive or filesystem root', () => {
    const root = parse(resolve('.')).root
    expect(getUnsafeGameFolderReason(root)).toMatch(/root/)
  })

  it('refuses user folders such as Downloads and home', () => {
    expect(getUnsafeGameFolderReason(downloads)).toBeDefined()
    expect(getUnsafeGameFolderReason(homedir())).toBeDefined()
  })

  it('refuses parents of protected folders', () => {
    expect(getUnsafeGameFolderReason(resolve(homedir(), '..'))).toBeDefined()
  })

  it('refuses the folder that holds the whole local library', () => {
    expect(getUnsafeGameFolderReason(libraryRoot)).toBeDefined()
  })

  it('refuses an empty path', () => {
    expect(getUnsafeGameFolderReason('  ')).toBeDefined()
  })
})
