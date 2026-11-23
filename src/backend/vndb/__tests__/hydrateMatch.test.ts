const mockSettings = {
  enableVndbIntegration: true,
  syncVndbUserData: true
}

const mockVndbClient = {
  searchVisualNovels: jest.fn()
}
const mockConfigStoreGet = jest.fn()
const mockSearchVndbVisualNovels = jest.fn()
const mockVndbMatchesStoreGet = jest.fn()
const mockVndbMatchesStoreSet = jest.fn()

jest.mock('../../constants/key_value_stores', () => ({
  configStore: {
    get_nodefault: mockConfigStoreGet
  }
}))
jest.mock('../../logger', () => ({
  logError: jest.fn(),
  logInfo: jest.fn(),
  LogPrefix: { Backend: 'Backend' }
}))
jest.mock('../client', () => ({
  vndbClient: mockVndbClient
}))
jest.mock('../electronStore', () => ({
  vndbMatchesStore: {
    get: mockVndbMatchesStoreGet,
    set: mockVndbMatchesStoreSet
  }
}))
jest.mock('../search', () => ({
  matchSearchFields: [],
  searchVndbVisualNovels: mockSearchVndbVisualNovels
}))

import type { VndbGameMatch, VndbSearchResult } from 'common/types/vndb'
import { hydrateVndbMatch, testingExportsMatches } from '../matches'

const release = {
  id: 'r1',
  title: 'Release',
  engineKnown: true,
  languages: ['en'],
  languageTitles: [{ lang: 'en', title: 'Release' }],
  platforms: ['win'],
  vns: []
}

const completeMatch: VndbGameMatch = {
  appName: 'game',
  runner: 'sideload',
  title: 'Game',
  vndbId: 'v1',
  vndbTitle: 'Game VN',
  source: 'visualNovel',
  released: '2020-01-01',
  rating: 80,
  lengthMinutes: 600,
  description: 'desc',
  tags: [],
  developers: ['Dev'],
  languages: ['en'],
  releases: [release, { ...release, id: 'r2' }],
  syncedAt: '2026-01-01T00:00:00.000Z'
}

const incompleteMatch: VndbGameMatch = {
  appName: 'game',
  runner: 'sideload',
  title: 'Game',
  vndbId: 'v1',
  vndbTitle: 'Game VN',
  source: 'visualNovel',
  syncedAt: '2026-01-01T00:00:00.000Z'
}

const mainResult: VndbSearchResult = {
  id: 'v1',
  title: 'Game VN',
  source: 'visualNovel',
  released: '2020-01-01',
  rating: 80,
  lengthMinutes: 600,
  description: 'desc',
  tags: [],
  developers: ['Dev'],
  languages: ['en'],
  platforms: ['win'],
  relations: [],
  releases: [release, { ...release, id: 'r2' }]
}

function storeMatches(match: VndbGameMatch | null) {
  const stored = match ? { 'sideload:game': match } : {}
  mockVndbMatchesStoreGet.mockImplementation(() => ({ ...stored }))
}

describe('hydrateVndbMatch', () => {
  beforeEach(() => {
    mockSettings.enableVndbIntegration = true
    mockConfigStoreGet.mockReturnValue(mockSettings)
    testingExportsMatches.clearSettledHydrations()
  })

  it('returns null when no match is stored', async () => {
    storeMatches(null)

    await expect(hydrateVndbMatch('game', 'sideload')).resolves.toBeNull()
    expect(mockSearchVndbVisualNovels).not.toHaveBeenCalled()
  })

  it('does not query VNDB when the match is already complete', async () => {
    storeMatches(completeMatch)

    await expect(hydrateVndbMatch('game', 'sideload')).resolves.toEqual(
      completeMatch
    )
    expect(mockSearchVndbVisualNovels).not.toHaveBeenCalled()
    expect(mockVndbMatchesStoreSet).not.toHaveBeenCalled()
  })

  it('does not query VNDB when the integration is disabled', async () => {
    mockSettings.enableVndbIntegration = false
    storeMatches(incompleteMatch)

    await expect(hydrateVndbMatch('game', 'sideload')).resolves.toEqual(
      incompleteMatch
    )
    expect(mockSearchVndbVisualNovels).not.toHaveBeenCalled()
  })

  it('fills in missing details and persists the result', async () => {
    storeMatches(incompleteMatch)
    mockSearchVndbVisualNovels.mockResolvedValue([mainResult])

    const hydrated = await hydrateVndbMatch('game', 'sideload')

    expect(mockSearchVndbVisualNovels).toHaveBeenCalledWith('v1', 1)
    expect(hydrated).toMatchObject({
      vndbId: 'v1',
      released: '2020-01-01',
      rating: 80,
      developers: ['Dev'],
      description: 'desc'
    })
    expect(hydrated?.releases).toHaveLength(2)
    expect(mockVndbMatchesStoreSet).toHaveBeenCalledWith(
      'matches',
      expect.objectContaining({ 'sideload:game': expect.any(Object) })
    )
  })

  it('keeps the stored match when VNDB returns a different entry', async () => {
    storeMatches(incompleteMatch)
    mockSearchVndbVisualNovels.mockResolvedValue([{ ...mainResult, id: 'v2' }])

    await expect(hydrateVndbMatch('game', 'sideload')).resolves.toEqual(
      incompleteMatch
    )
    expect(mockVndbMatchesStoreSet).not.toHaveBeenCalled()
  })

  it('shares one VNDB request between concurrent calls for a game', async () => {
    storeMatches(incompleteMatch)
    mockSearchVndbVisualNovels.mockResolvedValue([mainResult])

    const [first, second] = await Promise.all([
      hydrateVndbMatch('game', 'sideload'),
      hydrateVndbMatch('game', 'sideload')
    ])

    expect(mockSearchVndbVisualNovels).toHaveBeenCalledTimes(1)
    expect(first).toEqual(second)
  })

  it('persists releases that gained engine info without a count change', async () => {
    const legacyRelease = { ...release, engineKnown: undefined }
    storeMatches({
      ...completeMatch,
      releases: [legacyRelease, { ...legacyRelease, id: 'r2' }]
    })
    mockSearchVndbVisualNovels.mockResolvedValue([mainResult])

    const hydrated = await hydrateVndbMatch('game', 'sideload')

    expect(mockSearchVndbVisualNovels).toHaveBeenCalledTimes(1)
    expect(hydrated?.releases?.every((r) => r.engineKnown)).toBe(true)
    expect(mockVndbMatchesStoreSet).toHaveBeenCalledTimes(1)
  })

  it('does not query VNDB again when hydration found nothing new', async () => {
    const legacyRelease = { ...release, id: 'r9', engineKnown: undefined }
    storeMatches({
      ...completeMatch,
      releases: [legacyRelease, ...completeMatch.releases!]
    })
    // VNDB has no engine data for r9, so nothing changes.
    mockSearchVndbVisualNovels.mockResolvedValue([
      { ...mainResult, releases: [legacyRelease, ...mainResult.releases!] }
    ])

    await hydrateVndbMatch('game', 'sideload')
    await hydrateVndbMatch('game', 'sideload')

    expect(mockSearchVndbVisualNovels).toHaveBeenCalledTimes(1)
    expect(mockVndbMatchesStoreSet).not.toHaveBeenCalled()
  })
})
