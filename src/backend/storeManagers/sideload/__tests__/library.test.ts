const mockLibraryStoreGet = jest.fn()
const mockLibraryStoreSet = jest.fn()
const mockAddShortcuts = jest.fn()
const mockSendFrontendMessage = jest.fn()
const mockSideloadGame = jest.fn().mockImplementation((id: string) => ({ id }))

jest.mock('../electronStores', () => ({
  libraryStore: {
    get: mockLibraryStoreGet,
    set: mockLibraryStoreSet
  }
}))
jest.mock('backend/shortcuts/shortcuts/shortcuts', () => ({
  addShortcuts: mockAddShortcuts
}))
jest.mock('backend/ipc', () => ({
  sendFrontendMessage: mockSendFrontendMessage
}))
jest.mock('backend/logger', () => ({
  logWarning: jest.fn()
}))
jest.mock('backend/constants/environment', () => ({
  isMac: false
}))
jest.mock('../games', () => ({
  __esModule: true,
  default: mockSideloadGame
}))

import type { GameInfo } from 'common/types'
import SideloadLibraryManager from '../library'

function makeGame(overrides: Partial<GameInfo> = {}): GameInfo {
  return {
    app_name: 'visual-novel',
    runner: 'sideload',
    title: 'Visual Novel',
    art_cover: 'cover.png',
    art_square: 'square.png',
    install: {
      executable: 'C:\\Games\\Visual Novel\\game.exe',
      platform: 'Windows'
    },
    is_installed: true,
    canRunOffline: true,
    ...overrides
  }
}

describe('SideloadLibraryManager.addNewApp', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('persists visual-novel metadata for a new sideloaded game', () => {
    mockLibraryStoreGet.mockReturnValue([])
    const manager = new SideloadLibraryManager()

    manager.addNewApp(makeGame({ isVisualNovel: true }))

    const [storeKey, storedGames] = mockLibraryStoreSet.mock.calls[0] as [
      string,
      GameInfo[]
    ]
    expect(storeKey).toBe('games')
    expect(storedGames).toHaveLength(1)
    expect(storedGames[0]).toMatchObject({
      app_name: 'visual-novel',
      runner: 'sideload',
      folder_name: 'C:\\Games\\Visual Novel',
      isVisualNovel: true,
      install: {
        executable: 'C:\\Games\\Visual Novel\\game.exe',
        is_dlc: false,
        platform: 'Windows'
      }
    })
    expect(typeof storedGames[0].install.installed_at).toBe('string')
    expect(mockSideloadGame).toHaveBeenCalledWith('visual-novel')
    expect(mockAddShortcuts).toHaveBeenCalledWith(
      mockSideloadGame.mock.instances[0]
    )
    expect(mockSendFrontendMessage).toHaveBeenCalledWith(
      'refreshLibrary',
      'sideload'
    )
  })

  it('preserves the original install date when editing metadata', () => {
    const existingGame = makeGame({
      install: {
        executable: 'C:\\Games\\Visual Novel\\old.exe',
        installed_at: '2026-01-02T03:04:05.000Z',
        platform: 'Windows'
      },
      isVisualNovel: false
    })
    mockLibraryStoreGet.mockReturnValue([existingGame])
    const manager = new SideloadLibraryManager()

    manager.addNewApp(
      makeGame({
        install: {
          executable: 'D:\\Games\\Visual Novel\\game.exe',
          platform: 'Windows'
        },
        isVisualNovel: true
      })
    )

    const [, storedGames] = mockLibraryStoreSet.mock.calls[0] as [
      string,
      GameInfo[]
    ]
    expect(storedGames[0]).toMatchObject({
      folder_name: 'D:\\Games\\Visual Novel',
      isVisualNovel: true,
      install: {
        executable: 'D:\\Games\\Visual Novel\\game.exe',
        installed_at: '2026-01-02T03:04:05.000Z'
      }
    })
    expect(mockAddShortcuts).not.toHaveBeenCalled()
  })
})
