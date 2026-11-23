import CacheStore from 'backend/cache'
import { logError, logInfo, LogPrefix } from 'backend/logger'
import type {
  VndbGameMatch,
  VndbGameMatchSuggestion,
  VndbGameMatchTarget,
  VndbGameMatchUpdate,
  VndbRelease,
  VndbSearchResult
} from 'common/types/vndb'
import { getVndbMatchKey } from 'common/vndb'
import { searchResultToMatchUpdate } from 'common/vndbMatchUpdate'

import { vndbClient } from './client'
import { waitForUserRequestsIdle } from './priority'
import { vndbMatchesStore } from './electronStore'
import {
  mapVisualNovel,
  normalizeSearchQuery,
  normalizeTitleForMatch
} from './mapping'
import type { PartialVisualNovel } from './mapping'
import { matchSearchFields, searchVndbVisualNovels } from './search'
import { getVndbFeatureSettings, getVndbRequestErrorMessage } from './shared'

const vndbMatchCache = new CacheStore<VndbSearchResult | null>(
  'vndb-match-v1',
  60 * 24 * 7
)

const matchSearchConcurrency = 5
const pendingMatchSearches = new Map<string, Promise<VndbSearchResult | null>>()

export function getAllStoredMatches(): Record<string, VndbGameMatch> {
  return vndbMatchesStore.get('matches', {})
}

async function findVndbMatchCandidate(
  title: string
): Promise<VndbSearchResult | null> {
  const normalizedTitle = normalizeSearchQuery(title)
  if (!normalizedTitle) {
    return null
  }

  const cacheKey = normalizeTitleForMatch(normalizedTitle)
  const cached = vndbMatchCache.get(cacheKey)
  if (cached !== undefined) {
    return cached
  }

  const pendingSearch = pendingMatchSearches.get(cacheKey)
  if (pendingSearch) {
    return pendingSearch
  }

  const search = (async () => {
    const [visualNovel] = (await vndbClient.searchVisualNovels(
      normalizedTitle,
      matchSearchFields,
      1
    )) as PartialVisualNovel[]
    const result = visualNovel ? mapVisualNovel(visualNovel) : null
    vndbMatchCache.set(cacheKey, result)
    return result
  })()
  pendingMatchSearches.set(cacheKey, search)

  try {
    return await search
  } finally {
    if (pendingMatchSearches.get(cacheKey) === search) {
      pendingMatchSearches.delete(cacheKey)
    }
  }
}

export interface VndbMatchGamesOptions {
  signal?: AbortSignal
  /** Called with each finished suggestion (partial results). */
  onProgress?: (progress: {
    completed: number
    total: number
    suggestion: VndbGameMatchSuggestion
  }) => void
}

export async function matchVndbGames(
  games: VndbGameMatchTarget[],
  options: VndbMatchGamesOptions = {}
): Promise<VndbGameMatchSuggestion[]> {
  const { signal, onProgress } = options

  if (!getVndbFeatureSettings().enableVndbIntegration) {
    return games.map((game) => ({ game, result: null }))
  }

  const suggestions = new Array<VndbGameMatchSuggestion | undefined>(
    games.length
  )
  let nextGameIndex = 0
  let completed = 0

  async function matchNextGame(): Promise<void> {
    while (nextGameIndex < games.length) {
      await waitForUserRequestsIdle()
      if (signal?.aborted) {
        return
      }

      const gameIndex = nextGameIndex
      nextGameIndex += 1
      const game = games[gameIndex]
      let suggestion: VndbGameMatchSuggestion
      try {
        suggestion = {
          game,
          result: await findVndbMatchCandidate(game.title)
        }
      } catch (error) {
        const message = getVndbRequestErrorMessage(error)
        logError(
          ['VNDB match search failed for', game.title, ':', message],
          LogPrefix.Backend
        )
        suggestion = { game, result: null, error: message }
      }

      suggestions[gameIndex] = suggestion
      completed += 1
      onProgress?.({ completed, total: games.length, suggestion })
    }
  }

  const workerCount = Math.min(matchSearchConcurrency, games.length)
  await Promise.all(Array.from({ length: workerCount }, () => matchNextGame()))

  return games.map(
    (game, index) =>
      suggestions[index] ?? { game, result: null, cancelled: true }
  )
}

export function getVndbGameMatch(
  appName: string,
  runner: VndbGameMatch['runner']
): VndbGameMatch | null {
  return getAllStoredMatches()[getVndbMatchKey({ appName, runner })] ?? null
}

export function getAllVndbGameMatches(): Record<string, VndbGameMatch> {
  return getAllStoredMatches()
}

export function syncVndbGameMatches(
  updates: VndbGameMatchUpdate[]
): Record<string, VndbGameMatch> {
  const currentMatches = getAllStoredMatches()
  const syncedAt = new Date().toISOString()
  let changed = false

  for (const update of updates) {
    const key = getVndbMatchKey(update)
    const previousMatch = currentMatches[key]
    if (!update.vndbId) {
      if (key in currentMatches) {
        delete currentMatches[key]
        changed = true
      }
      continue
    }

    const nextMatch: VndbGameMatch = {
      appName: update.appName,
      runner: update.runner,
      title: update.title,
      vndbId: update.vndbId,
      vndbTitle: update.vndbTitle ?? update.title,
      aliases: update.aliases,
      source: update.source,
      imageUrl: update.imageUrl,
      released: update.released,
      average: update.average,
      rating: update.rating,
      votecount: update.votecount,
      length: update.length,
      lengthMinutes: update.lengthMinutes,
      lengthVotes: update.lengthVotes,
      description: update.description,
      tags: update.tags,
      developers: update.developers,
      languages: update.languages,
      mainVndbId: update.mainRelation?.id,
      mainVndbTitle: update.mainRelation?.title,
      mainRelation: update.mainRelation,
      relations: update.relations,
      latestRelease: update.latestRelease,
      selectedReleases:
        update.selectedReleases ??
        (previousMatch?.vndbId === update.vndbId
          ? previousMatch.selectedReleases
          : undefined),
      releases: update.releases,
      releaseVns: update.releaseVns,
      syncedAt
    }

    // Re-syncing identical data (e.g. repeated hydration) must not rewrite
    // the store, so the previous entry is kept as is.
    if (
      previousMatch &&
      areMatchesEqualIgnoringSyncTime(previousMatch, nextMatch)
    ) {
      continue
    }

    currentMatches[key] = nextMatch
    changed = true
  }

  if (changed) {
    vndbMatchesStore.set('matches', currentMatches)
  }
  logInfo(['Synced VNDB matches:', updates.length], LogPrefix.Backend)
  return currentMatches
}

function areMatchesEqualIgnoringSyncTime(
  left: VndbGameMatch,
  right: VndbGameMatch
): boolean {
  return (
    JSON.stringify({ ...left, syncedAt: undefined }) ===
    JSON.stringify({ ...right, syncedAt: undefined })
  )
}

function releasesNeedLanguageTitles(releases: VndbRelease[] | undefined) {
  return (
    releases?.some(
      (release) => release.languages.length && !release.languageTitles?.length
    ) ?? false
  )
}

/** True when a release stored without engine info now has it. */
function releasesGainedEngineInfo(
  previous: VndbRelease[] | undefined,
  next: VndbRelease[] | undefined
): boolean {
  if (!previous?.length || !next?.length) {
    return false
  }

  const nextById = new Map(next.map((release) => [release.id, release]))
  return previous.some(
    (release) =>
      !release.engineKnown && nextById.get(release.id)?.engineKnown === true
  )
}

function matchNeedsVisualNovelDetails(match: VndbGameMatch) {
  return (
    match.released === undefined ||
    match.developers === undefined ||
    match.rating === undefined ||
    match.lengthMinutes === undefined ||
    match.description === undefined ||
    match.tags === undefined
  )
}

function getSelectedReleases(match: VndbGameMatch): VndbRelease[] {
  if (match.selectedReleases !== undefined) {
    return match.selectedReleases
  }

  if (match.latestRelease) {
    return [match.latestRelease]
  }

  if (match.source !== 'release') {
    return []
  }

  // Release matches without stored selections fall back to the matched
  // release itself.
  return [
    {
      id: match.vndbId,
      title: match.vndbTitle,
      imageUrl: match.imageUrl,
      released: match.released,
      languages: match.languages ?? [],
      platforms: [],
      vns: match.releaseVns ?? []
    }
  ]
}

function getMainVisualNovelId(match: VndbGameMatch): string {
  if (match.source !== 'release') {
    return match.vndbId
  }

  return match.mainRelation?.id ?? match.releaseVns?.[0]?.id ?? match.vndbId
}

function mergeReleases(
  releases: VndbRelease[] | undefined,
  selectedReleases: VndbRelease[]
): VndbRelease[] {
  const releaseMap = new Map<string, VndbRelease>()

  for (const selectedRelease of selectedReleases) {
    releaseMap.set(selectedRelease.id, selectedRelease)
  }
  for (const release of releases ?? []) {
    releaseMap.set(release.id, release)
  }

  return [...releaseMap.values()]
}

const pendingHydrations = new Map<string, Promise<VndbGameMatch | null>>()
// Matches (by key -> syncedAt) whose hydration found nothing new. They are not
// fetched again until the stored match changes or the app restarts.
const settledHydrations = new Map<string, string>()

export const testingExportsMatches = {
  clearSettledHydrations: () => settledHydrations.clear()
}

/**
 * Fills in missing visual novel details/releases of a stored match from VNDB
 * and persists the result. Returns the (possibly updated) stored match, or
 * null when no match is stored. Concurrent calls for one game share a request.
 */
export function hydrateVndbMatch(
  appName: string,
  runner: VndbGameMatch['runner']
): Promise<VndbGameMatch | null> {
  const key = getVndbMatchKey({ appName, runner })
  const pending = pendingHydrations.get(key)
  if (pending) {
    return pending
  }

  const hydration = hydrateVndbMatchInternal(appName, runner).finally(() => {
    if (pendingHydrations.get(key) === hydration) {
      pendingHydrations.delete(key)
    }
  })
  pendingHydrations.set(key, hydration)
  return hydration
}

async function hydrateVndbMatchInternal(
  appName: string,
  runner: VndbGameMatch['runner']
): Promise<VndbGameMatch | null> {
  const match = getVndbGameMatch(appName, runner)
  if (!match || !getVndbFeatureSettings().enableVndbIntegration) {
    return match
  }

  const key = getVndbMatchKey({ appName, runner })
  if (settledHydrations.get(key) === match.syncedAt) {
    return match
  }
  const settle = () => {
    settledHydrations.set(key, match.syncedAt)
    return match
  }

  const selectedReleases = getSelectedReleases(match)
  const shouldHydrateReleases =
    (match.releases?.length ?? 0) <= 1 ||
    releasesNeedLanguageTitles(match.releases) ||
    selectedReleases.some((release) => !release.engineKnown) ||
    match.releases?.some((release) => !release.engineKnown) === true
  const shouldHydrateDetails = matchNeedsVisualNovelDetails(match)
  if (!shouldHydrateReleases && !shouldHydrateDetails) {
    return match
  }

  const mainVisualNovelId = getMainVisualNovelId(match)
  if (!mainVisualNovelId.startsWith('v')) {
    return match
  }

  const [mainResult] = await searchVndbVisualNovels(mainVisualNovelId, 1)
  if (
    mainResult?.source !== 'visualNovel' ||
    mainResult.id !== mainVisualNovelId ||
    (!mainResult.releases?.length && !shouldHydrateDetails)
  ) {
    return settle()
  }

  const releases = selectedReleases.length
    ? mergeReleases(mainResult.releases, selectedReleases)
    : mainResult.releases
  const hydratedSelectedReleases = selectedReleases.map(
    (selectedRelease) =>
      releases?.find((release) => release.id === selectedRelease.id) ??
      selectedRelease
  )
  const selectedRelease = hydratedSelectedReleases[0]
  const hasReleaseUpdate =
    releasesNeedLanguageTitles(match.releases) ||
    (releases?.length ?? 0) > (match.releases?.length ?? 0) ||
    releasesGainedEngineInfo(match.releases, releases) ||
    releasesGainedEngineInfo(selectedReleases, hydratedSelectedReleases)

  if (!shouldHydrateDetails && !hasReleaseUpdate) {
    return settle()
  }

  const updatedMatches = syncVndbGameMatches([
    searchResultToMatchUpdate(match, mainResult, {
      source: 'visualNovel',
      latestRelease:
        selectedRelease ??
        (match.selectedReleases !== undefined
          ? undefined
          : (match.latestRelease ?? mainResult.latestRelease)),
      selectedReleases:
        match.selectedReleases === undefined
          ? undefined
          : hydratedSelectedReleases,
      releases,
      releaseVns:
        selectedRelease?.vns ??
        (match.selectedReleases !== undefined
          ? undefined
          : (match.releaseVns ?? mainResult.releaseVns))
    })
  ])

  return updatedMatches[getVndbMatchKey({ appName, runner })] ?? null
}
