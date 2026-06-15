const mockSettings = {
  enableVndbIntegration: true,
  syncVndbUserData: true
}

const mockVndbClient = {
  deleteUserReleaseEntry: jest.fn(),
  getAuthInfo: jest.fn(),
  getUserLabels: jest.fn(),
  getUserList: jest.fn(),
  searchVisualNovels: jest.fn(),
  updateUserListEntry: jest.fn(),
  updateUserReleaseEntry: jest.fn()
}
const mockConfigStoreGet = jest.fn()
const mockHasStoredApiToken = jest.fn()
const mockVndbMatchesStoreGet = jest.fn()
const mockVndbMatchesStoreSet = jest.fn()

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
  hasStoredApiToken: mockHasStoredApiToken,
  refreshVndbClientApiToken: jest.fn(),
  vndbClient: mockVndbClient
}))
jest.mock('../vndb/electronStore', () => ({
  vndbMatchesStore: {
    get: mockVndbMatchesStoreGet,
    set: mockVndbMatchesStoreSet
  }
}))

import {
  getVndbGameMatch,
  matchVndbGames,
  searchVndbVisualNovels,
  syncVndbGameMatches,
  syncVndbUserData,
  updateVndbUserOptions,
  updateVndbUserRelease
} from '../vndb'

describe('VNDB global settings', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSettings.enableVndbIntegration = true
    mockSettings.syncVndbUserData = true
    mockConfigStoreGet.mockReturnValue(mockSettings)
    mockHasStoredApiToken.mockReturnValue(true)
    mockVndbMatchesStoreGet.mockReturnValue({})
    mockVndbClient.getAuthInfo.mockResolvedValue({
      id: 'u1',
      username: 'test-user',
      permissions: ['listread', 'listwrite']
    })
    mockVndbClient.getUserLabels.mockResolvedValue({ labels: [] })
    mockVndbClient.getUserList.mockResolvedValue({ results: [] })
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

  it('allows explicit date edits when automatic user-data sync is disabled', async () => {
    mockSettings.syncVndbUserData = false

    await updateVndbUserOptions('v1', {
      started: null,
      finished: '2026-06-16'
    })

    expect(mockVndbClient.updateUserListEntry).toHaveBeenCalledWith('v1', {
      started: null,
      finished: '2026-06-16'
    })
  })

  it('sets the finish date when the Finished label is selected', async () => {
    jest.useFakeTimers().setSystemTime(new Date('2026-06-16T12:00:00.000Z'))

    try {
      await updateVndbUserOptions('v1', { labels: [2] })

      expect(mockVndbClient.updateUserListEntry).toHaveBeenCalledWith('v1', {
        labels: [2],
        finished: '2026-06-16'
      })
    } finally {
      jest.useRealTimers()
    }
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

describe('VNDB match persistence', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockConfigStoreGet.mockReturnValue(mockSettings)
    mockVndbMatchesStoreGet.mockReturnValue({})
  })

  it('persists fork-specific metadata fields under a runner-scoped key', () => {
    const selectedRelease = {
      id: 'r1',
      title: 'English Release',
      languages: ['en'],
      platforms: ['win'],
      vns: []
    }

    const matches = syncVndbGameMatches([
      {
        appName: 'game',
        runner: 'sideload',
        title: 'Local Title',
        vndbId: 'v1',
        vndbTitle: 'VNDB Title',
        aliases: ['Alias'],
        developers: ['Developer'],
        languages: ['ja'],
        selectedReleases: [selectedRelease]
      }
    ])

    expect(matches['sideload:game']).toEqual(
      expect.objectContaining({
        appName: 'game',
        runner: 'sideload',
        vndbId: 'v1',
        aliases: ['Alias'],
        developers: ['Developer'],
        languages: ['ja'],
        selectedReleases: [selectedRelease]
      })
    )
    expect(typeof matches['sideload:game'].syncedAt).toBe('string')
    expect(mockVndbMatchesStoreSet).toHaveBeenCalledWith('matches', matches)
    expect(getVndbGameMatch('game', 'sideload')).toEqual(
      matches['sideload:game']
    )
  })

  it('preserves selected releases when refreshing the same VNDB match', () => {
    const selectedReleases = [
      {
        id: 'r1',
        title: 'Selected Release',
        languages: ['en'],
        platforms: ['win'],
        vns: []
      }
    ]
    mockVndbMatchesStoreGet.mockReturnValue({
      'sideload:game': {
        appName: 'game',
        runner: 'sideload',
        title: 'Old Title',
        vndbId: 'v1',
        vndbTitle: 'VNDB Title',
        selectedReleases,
        syncedAt: '2026-01-01T00:00:00.000Z'
      }
    })

    const matches = syncVndbGameMatches([
      {
        appName: 'game',
        runner: 'sideload',
        title: 'New Title',
        vndbId: 'v1',
        developers: ['Updated Developer']
      }
    ])

    expect(matches['sideload:game']).toEqual(
      expect.objectContaining({
        title: 'New Title',
        developers: ['Updated Developer'],
        selectedReleases
      })
    )
  })

  it('removes a stored match when an update clears the VNDB id', () => {
    mockVndbMatchesStoreGet.mockReturnValue({
      'gog:game': {
        appName: 'game',
        runner: 'gog',
        title: 'Game',
        vndbId: 'v1',
        vndbTitle: 'Game',
        syncedAt: '2026-01-01T00:00:00.000Z'
      }
    })

    const matches = syncVndbGameMatches([
      {
        appName: 'game',
        runner: 'gog',
        title: 'Game',
        vndbId: null
      }
    ])

    expect(matches).toEqual({})
    expect(mockVndbMatchesStoreSet).toHaveBeenCalledWith('matches', {})
  })
})
