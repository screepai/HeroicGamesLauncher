const mockSettings = {
  enableVndbIntegration: true,
  syncVndbUserData: true
}

const mockVndbClient = {
  deleteUserReleaseEntry: jest.fn(),
  getAuthInfo: jest.fn(),
  getUserLabels: jest.fn(),
  getUserList: jest.fn(),
  getReleases: jest.fn(),
  getRelease: jest.fn(),
  getVisualNovel: jest.fn(),
  searchVisualNovels: jest.fn(),
  updateUserListEntry: jest.fn(),
  updateUserReleaseEntry: jest.fn()
}
const mockConfigStoreGet = jest.fn()
const mockHasStoredApiToken = jest.fn()
const mockTimestampStoreGet = jest.fn()
const mockVndbMatchesStoreGet = jest.fn()
const mockVndbMatchesStoreSet = jest.fn()

jest.mock('../constants/key_value_stores', () => ({
  configStore: {
    get_nodefault: mockConfigStoreGet
  },
  tsStore: { get_nodefault: mockTimestampStoreGet }
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

import { notifyVndbApiTokenChanged } from '../vndb/tokenEvents'
import { clearVndbUserCache } from '../vndb/userCache'
import {
  getVndbGameMatch,
  getVndbUserOptions,
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
    clearVndbUserCache()
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

  it('batches user-list reads in groups of 100 visual novel IDs', async () => {
    const targets = Array.from({ length: 101 }, (_, index) => ({
      appName: `game-${index}`,
      runner: 'gog' as const
    }))
    mockVndbMatchesStoreGet.mockReturnValue(
      Object.fromEntries(
        targets.map((target, index) => [
          `gog:${target.appName}`,
          {
            ...target,
            title: target.appName,
            vndbId: `v${index + 1}`,
            vndbTitle: target.appName,
            syncedAt: '2026-06-21T00:00:00.000Z'
          }
        ])
      )
    )

    await expect(syncVndbUserData(targets)).resolves.toMatchObject({
      synced: 101,
      skipped: 0,
      errors: []
    })

    expect(mockVndbClient.getUserList).toHaveBeenCalledTimes(2)
    expect(mockVndbClient.getUserList).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        filters: [
          'or',
          ...Array.from({ length: 100 }, (_, index) => [
            'id',
            '=',
            `v${index + 1}`
          ])
        ],
        results: 100
      })
    )
    expect(mockVndbClient.getUserList).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        filters: ['id', '=', 'v101'],
        results: 1
      })
    )
    expect(mockVndbClient.updateUserListEntry).not.toHaveBeenCalled()
    expect(mockVndbClient.updateUserReleaseEntry).not.toHaveBeenCalled()
  })

  it('deduplicates shared VN and release work and skips unchanged dates', async () => {
    const selectedRelease = {
      id: 'r1',
      title: 'Shared Release',
      languages: ['en'],
      platforms: ['win'],
      vns: []
    }
    mockVndbMatchesStoreGet.mockReturnValue({
      'sideload:game-1': {
        appName: 'game-1',
        runner: 'sideload',
        title: 'Game 1',
        vndbId: 'v1',
        vndbTitle: 'Shared VN',
        selectedReleases: [selectedRelease],
        syncedAt: '2026-06-21T00:00:00.000Z'
      },
      'sideload:game-2': {
        appName: 'game-2',
        runner: 'sideload',
        title: 'Game 2',
        vndbId: 'v1',
        vndbTitle: 'Shared VN',
        selectedReleases: [selectedRelease],
        syncedAt: '2026-06-21T00:00:00.000Z'
      }
    })
    mockVndbClient.getUserList.mockResolvedValue({
      results: [
        {
          id: 'v1',
          voted: null,
          started: '2026-06-01',
          finished: null,
          labels: [],
          releases: []
        }
      ]
    })

    await expect(
      syncVndbUserData([
        {
          appName: 'game-1',
          runner: 'sideload',
          installedAt: '2026-06-01T12:00:00.000Z'
        },
        {
          appName: 'game-2',
          runner: 'sideload',
          installedAt: '2026-06-01T12:00:00.000Z'
        }
      ])
    ).resolves.toMatchObject({ synced: 2, skipped: 0, errors: [] })

    expect(mockVndbClient.getUserList).toHaveBeenCalledTimes(1)
    expect(mockVndbClient.getUserList).toHaveBeenCalledWith(
      expect.objectContaining({
        filters: ['id', '=', 'v1'],
        fields:
          'id,voted,started,finished,labels{id,label},releases{id,list_status}',
        results: 1
      })
    )
    expect(mockVndbClient.updateUserListEntry).not.toHaveBeenCalled()
    expect(mockVndbClient.updateUserReleaseEntry).toHaveBeenCalledTimes(1)
    expect(mockVndbClient.updateUserReleaseEntry).toHaveBeenCalledWith('r1', {
      status: 2
    })
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

  it('returns every VNDB label and preserves multiple selections', async () => {
    const labels = [
      { id: 1, label: 'Playing' },
      { id: 2, label: 'Finished' },
      { id: 3, label: 'Stalled' },
      { id: 4, label: 'Dropped' },
      { id: 5, label: 'Wishlist' },
      { id: 6, label: 'Blacklist' },
      { id: 7, label: 'Voted' },
      { id: 10, label: 'Custom' }
    ]
    mockVndbClient.getUserLabels.mockResolvedValue({ labels })
    mockVndbClient.getUserList.mockResolvedValue({
      results: [
        {
          id: 'v1',
          labels: [labels[4], labels[0], labels[7], labels[6]]
        }
      ]
    })

    await expect(getVndbUserOptions('v1')).resolves.toMatchObject({
      labels,
      selectedLabelIds: [5, 1, 10]
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

  it('sets the finish date in the local timezone', async () => {
    const originalTimezone = process.env.TZ
    process.env.TZ = 'Asia/Bangkok'
    jest.useFakeTimers().setSystemTime(new Date('2026-06-16T17:30:00.000Z'))

    try {
      await updateVndbUserOptions('v1', { labels: [2] })

      expect(mockVndbClient.updateUserListEntry).toHaveBeenCalledWith('v1', {
        labels: [2],
        finished: '2026-06-17'
      })
    } finally {
      jest.useRealTimers()
      if (originalTimezone === undefined) {
        delete process.env.TZ
      } else {
        process.env.TZ = originalTimezone
      }
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

describe('VNDB bulk matching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    mockSettings.enableVndbIntegration = true
    mockConfigStoreGet.mockReturnValue(mockSettings)
  })

  it('returns a per-game error instead of rejecting the whole batch', async () => {
    mockVndbClient.searchVisualNovels.mockImplementation(
      async (query: string) => {
        if (query === 'Broken Match Title') {
          throw new Error('boom')
        }
        return [{ id: 'v1', title: query }]
      }
    )
    const games = [
      { appName: 'ok', runner: 'sideload' as const, title: 'Fine Match Title' },
      {
        appName: 'bad',
        runner: 'sideload' as const,
        title: 'Broken Match Title'
      }
    ]

    const suggestions = await matchVndbGames(games)

    expect(suggestions).toHaveLength(2)
    expect(suggestions[0]).toMatchObject({
      game: games[0],
      result: { id: 'v1' }
    })
    expect(suggestions[1]).toEqual({
      game: games[1],
      result: null,
      error: 'boom'
    })
  })

  it('reports progress per game and stops when cancelled', async () => {
    mockVndbClient.searchVisualNovels.mockImplementation(
      async (query: string) => [{ id: 'v2', title: query }]
    )
    const controller = new AbortController()
    const games = Array.from({ length: 12 }, (_, index) => ({
      appName: `cancel-${index}`,
      runner: 'sideload' as const,
      title: `Cancellable Title ${index}`
    }))
    const onProgress = jest.fn(({ completed }: { completed: number }) => {
      if (completed >= 3) {
        controller.abort()
      }
    })

    const suggestions = await matchVndbGames(games, {
      signal: controller.signal,
      onProgress
    })

    expect(suggestions).toHaveLength(games.length)
    expect(suggestions.some((suggestion) => suggestion.cancelled)).toBe(true)
    expect(onProgress).toHaveBeenCalledWith(
      expect.objectContaining({ total: games.length })
    )
    expect(
      suggestions.filter((suggestion) => !suggestion.cancelled)
    ).toHaveLength(onProgress.mock.calls.length)
  })
})

describe('VNDB user auth/label caching', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearVndbUserCache()
    mockSettings.enableVndbIntegration = true
    mockConfigStoreGet.mockReturnValue(mockSettings)
    mockHasStoredApiToken.mockReturnValue(true)
    mockVndbClient.getAuthInfo.mockResolvedValue({
      id: 'u1',
      username: 'test-user',
      permissions: ['listread', 'listwrite']
    })
    mockVndbClient.getUserLabels.mockResolvedValue({ labels: [] })
    mockVndbClient.getUserList.mockResolvedValue({ results: [] })
  })

  it('fetches auth info and labels once across repeated reads', async () => {
    await getVndbUserOptions('v1')
    await getVndbUserOptions('v2')
    await getVndbUserOptions('v3')

    expect(mockVndbClient.getAuthInfo).toHaveBeenCalledTimes(1)
    expect(mockVndbClient.getUserLabels).toHaveBeenCalledTimes(1)
    expect(mockVndbClient.getUserList).toHaveBeenCalledTimes(3)
  })

  it('refetches after the cache TTL expires', async () => {
    const now = jest.spyOn(Date, 'now')
    now.mockReturnValue(1_000_000)
    await getVndbUserOptions('v1')

    now.mockReturnValue(1_000_000 + 10 * 60 * 1000 + 1)
    await getVndbUserOptions('v1')
    now.mockRestore()

    expect(mockVndbClient.getAuthInfo).toHaveBeenCalledTimes(2)
  })

  it('invalidates the cache when the API token changes', async () => {
    await getVndbUserOptions('v1')
    notifyVndbApiTokenChanged()
    await getVndbUserOptions('v1')

    expect(mockVndbClient.getAuthInfo).toHaveBeenCalledTimes(2)
    expect(mockVndbClient.getUserLabels).toHaveBeenCalledTimes(2)
  })

  it('does not cache failed auth requests', async () => {
    mockVndbClient.getAuthInfo.mockRejectedValueOnce(new Error('offline'))

    await expect(getVndbUserOptions('v1')).rejects.toThrow('offline')
    await expect(getVndbUserOptions('v1')).resolves.toMatchObject({
      hasToken: true
    })
    expect(mockVndbClient.getAuthInfo).toHaveBeenCalledTimes(2)
  })

  it('refetches labels (counts) after the list was changed', async () => {
    mockVndbClient.updateUserListEntry.mockResolvedValue(undefined)
    await getVndbUserOptions('v1')
    await updateVndbUserOptions('v1', { vote: 80 })

    expect(mockVndbClient.getAuthInfo).toHaveBeenCalledTimes(1)
    expect(mockVndbClient.getUserLabels).toHaveBeenCalledTimes(2)
  })
})

describe('VNDB release lookup', () => {
  function makeRelease(id: string, vnIds: string[], released: string) {
    return {
      id,
      title: id,
      released,
      languages: [],
      platforms: [],
      vns: vnIds.map((vnId) => ({ id: vnId, title: vnId }))
    }
  }

  beforeEach(() => {
    jest.clearAllMocks()
    mockSettings.enableVndbIntegration = true
    mockConfigStoreGet.mockReturnValue(mockSettings)
  })

  it('fetches releases for all hydrated search results in one request', async () => {
    mockVndbClient.searchVisualNovels.mockResolvedValue([
      { id: 'v10', title: 'One' },
      { id: 'v11', title: 'Two' },
      { id: 'v12', title: 'Three' }
    ])
    mockVndbClient.getReleases.mockImplementation(
      async (query: { filters: unknown[] }) => {
        // Distinguish the title search from the per-VN release lookup
        if (query.filters[0] === 'search') {
          return { results: [], more: false }
        }
        return {
          results: [
            makeRelease('r1', ['v10'], '2020-01-01'),
            makeRelease('r2', ['v11', 'v12'], '2021-01-01')
          ],
          more: false
        }
      }
    )

    const results = await searchVndbVisualNovels('batched releases query')

    const releaseLookups = mockVndbClient.getReleases.mock.calls.filter(
      ([query]) => query.filters[0] === 'vn'
    )
    expect(releaseLookups).toHaveLength(1)
    expect(releaseLookups[0][0].filters).toEqual([
      'vn',
      '=',
      ['or', ['id', '=', 'v10'], ['id', '=', 'v11'], ['id', '=', 'v12']]
    ])
    expect(results.map((result) => result.releases?.map((r) => r.id))).toEqual([
      ['r1'],
      ['r2'],
      ['r2']
    ])
  })

  it('follows pagination instead of stopping at the first page', async () => {
    mockVndbClient.getVisualNovel.mockResolvedValue({ id: 'v20', title: 'Big' })
    const firstPage = Array.from({ length: 100 }, (_, index) =>
      makeRelease(`r${index}`, ['v20'], '2019-01-01')
    )
    const secondPage = [makeRelease('r-last', ['v20'], '2022-02-02')]
    mockVndbClient.getReleases
      .mockResolvedValueOnce({ results: firstPage, more: true })
      .mockResolvedValueOnce({ results: secondPage, more: false })

    const [result] = await searchVndbVisualNovels('v20')

    expect(mockVndbClient.getReleases).toHaveBeenCalledTimes(2)
    expect(mockVndbClient.getReleases.mock.calls[0][0]).toMatchObject({
      page: 1
    })
    expect(mockVndbClient.getReleases.mock.calls[1][0]).toMatchObject({
      page: 2
    })
    expect(result.releases).toHaveLength(101)
    expect(result.releases?.[0].id).toBe('r-last')
    expect(result.latestRelease?.id).toBe('r-last')
  })
})

describe('VNDB user-data sync progress and cancellation', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    clearVndbUserCache()
    mockSettings.enableVndbIntegration = true
    mockSettings.syncVndbUserData = true
    mockConfigStoreGet.mockReturnValue(mockSettings)
    mockHasStoredApiToken.mockReturnValue(true)
    mockVndbClient.getAuthInfo.mockResolvedValue({
      id: 'u1',
      username: 'test-user',
      permissions: ['listread', 'listwrite']
    })
    mockVndbClient.getUserList.mockResolvedValue({ results: [] })
    mockVndbClient.updateUserListEntry.mockResolvedValue(undefined)
  })

  it('emits progress per target and skips the rest once cancelled', async () => {
    const targets = Array.from({ length: 5 }, (_, index) => ({
      appName: `sync-${index}`,
      runner: 'gog' as const
    }))
    mockVndbMatchesStoreGet.mockReturnValue(
      Object.fromEntries(
        targets.map((target, index) => [
          `gog:${target.appName}`,
          {
            ...target,
            title: target.appName,
            vndbId: `v${index + 1}`,
            vndbTitle: target.appName,
            syncedAt: '2026-06-21T00:00:00.000Z'
          }
        ])
      )
    )
    const controller = new AbortController()
    const onProgress = jest.fn(({ completed }: { completed: number }) => {
      if (completed === 2) {
        controller.abort()
      }
    })

    const result = await syncVndbUserData(targets, {
      signal: controller.signal,
      onProgress
    })

    expect(onProgress).toHaveBeenCalledTimes(2)
    expect(onProgress).toHaveBeenLastCalledWith(
      expect.objectContaining({ completed: 2, total: 5 })
    )
    expect(result).toMatchObject({ cancelled: true, synced: 2, skipped: 3 })
  })
})

describe('VNDB match persistence rewrites', () => {
  beforeEach(() => {
    jest.clearAllMocks()
  })

  it('does not rewrite the store when a re-sync changes nothing', () => {
    mockVndbMatchesStoreGet.mockReturnValue({})
    const update = {
      appName: 'same',
      runner: 'sideload' as const,
      title: 'Same',
      vndbId: 'v99',
      vndbTitle: 'Same VN'
    }
    syncVndbGameMatches([update])
    const [, storedMatches] = mockVndbMatchesStoreSet.mock.calls[0]
    mockVndbMatchesStoreSet.mockClear()
    mockVndbMatchesStoreGet.mockReturnValue(
      JSON.parse(JSON.stringify(storedMatches))
    )

    syncVndbGameMatches([update])

    expect(mockVndbMatchesStoreSet).not.toHaveBeenCalled()
  })
})
