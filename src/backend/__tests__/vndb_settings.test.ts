const mockSettings = {
  enableVndbIntegration: true,
  syncVndbUserData: true
}

const mockVndbClient = {
  deleteUserReleaseEntry: jest.fn(),
  getAuthInfo: jest.fn(),
  searchVisualNovels: jest.fn(),
  updateUserReleaseEntry: jest.fn()
}
const mockConfigStoreGet = jest.fn()

jest.mock('../constants/key_value_stores', () => ({
  configStore: {
    get_nodefault: mockConfigStoreGet
  },
  tsStore: { get: jest.fn() }
}))
jest.mock('../logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  LogPrefix: { Backend: 'Backend' }
}))
jest.mock('../vndb/client', () => ({
  hasStoredApiToken: jest.fn(() => true),
  refreshVndbClientApiToken: jest.fn(),
  vndbClient: mockVndbClient
}))
jest.mock('../vndb/electronStore', () => ({
  vndbMatchesStore: {
    get: jest.fn(() => ({})),
    set: jest.fn()
  }
}))

import {
  matchVndbGames,
  searchVndbVisualNovels,
  syncVndbUserData,
  updateVndbUserRelease
} from '../vndb'

describe('VNDB global settings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSettings.enableVndbIntegration = true
    mockSettings.syncVndbUserData = true
    mockConfigStoreGet.mockReturnValue(mockSettings)
  })

  it('skips remote user-data writes when user-data sync is disabled', async () => {
    mockSettings.syncVndbUserData = false

    await expect(
      syncVndbUserData([
        {
          appName: 'game',
          runner: 'sideload'
        }
      ])
    ).resolves.toMatchObject({
      synced: 0,
      skipped: 1,
      errors: []
    })
    expect(mockVndbClient.getAuthInfo).not.toHaveBeenCalled()
  })

  it('does not update release status when user-data sync is disabled', async () => {
    mockSettings.syncVndbUserData = false

    await updateVndbUserRelease('r1', true)

    expect(mockVndbClient.updateUserReleaseEntry).not.toHaveBeenCalled()
  })

  it('suppresses VNDB search and matching when integration is disabled', async () => {
    mockSettings.enableVndbIntegration = false

    await expect(searchVndbVisualNovels('Visual Novel')).resolves.toEqual([])
    await expect(
      matchVndbGames([
        {
          appName: 'game',
          runner: 'sideload',
          title: 'Visual Novel'
        }
      ])
    ).resolves.toEqual([
      {
        game: {
          appName: 'game',
          runner: 'sideload',
          title: 'Visual Novel'
        },
        result: null
      }
    ])
    expect(mockVndbClient.searchVisualNovels).not.toHaveBeenCalled()
  })
})
