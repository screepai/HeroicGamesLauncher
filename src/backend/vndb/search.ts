import CacheStore from 'backend/cache'
import { logError, LogPrefix } from 'backend/logger'
import { isVndbError, parseVndbId } from 'vndb-kana-api'
import type { Filter, FilterValue } from 'vndb-kana-api'
import type { VndbRelease, VndbSearchResult } from 'common/types/vndb'

import { refreshVndbClientApiToken, vndbClient } from './client'
import {
  mapRelease,
  mapReleaseSummary,
  mapVisualNovel,
  normalizeSearchQuery,
  normalizeTitleForMatch,
  sortReleasesByDate
} from './mapping'
import type { PartialVisualNovel, PartialVndbRelease } from './mapping'
import { runUserInitiated } from './priority'
import { getVndbFeatureSettings } from './shared'

const vndbSearchCache = new CacheStore<VndbSearchResult[]>(
  'vndb-search-v10',
  60 * 24 * 7
)

const maxSearchResults = 50
const releasesPageSize = 100
const maxVisualNovelReleasePages = 20
const maxHydratedVisualNovelSearchResults = 5

const searchFields = [
  'id',
  'title',
  'alttitle',
  'titles{title,latin}',
  'aliases',
  'released',
  'average',
  'rating',
  'votecount',
  'length',
  'length_minutes',
  'length_votes',
  'description',
  'tags{id,name,category,rating,spoiler,lie}',
  'image{url}',
  'developers{name}',
  'languages',
  'platforms',
  'relations{id,title,relation,relation_official,released,image{url}}'
].join(',')

export const matchSearchFields = [
  'id',
  'title',
  'alttitle',
  'titles{title,latin}',
  'aliases',
  'released',
  'image{url}'
].join(',')

const releaseSearchFields = [
  'id',
  'title',
  'alttitle',
  'released',
  'official',
  'patch',
  'freeware',
  'engine',
  'languages{lang,title,latin,main,mtl}',
  'platforms',
  'vns{id,title,alttitle,titles{title,latin},aliases,rtype,released,image{url},relations{id,title,relation,relation_official,released,image{url}}}'
].join(',')

function normalizeSearchLimit(limit: number | undefined): number {
  if (!limit) {
    return 5
  }

  return Math.min(Math.max(Math.floor(limit), 1), maxSearchResults)
}

function getSearchCacheKey(query: string, limit: number): string {
  return `${query.toLocaleLowerCase()}::${limit}`
}

function getSearchId(query: string): ReturnType<typeof parseVndbId> {
  return parseVndbId(query.toLocaleLowerCase())
}

/**
 * Fetches the releases of several visual novels with a single (paginated)
 * filter instead of one request per VN. Releases shared by several of the
 * requested VNs are attached to each of them.
 */
export async function getLatestReleasesForVisualNovels(
  visualNovelIds: string[]
): Promise<Map<string, VndbRelease[]>> {
  const uniqueIds = [...new Set(visualNovelIds)]
  const releasesByVisualNovel = new Map<string, VndbRelease[]>(
    uniqueIds.map((id) => [id, []])
  )
  if (!uniqueIds.length) {
    return releasesByVisualNovel
  }

  const requestedIds = new Set(uniqueIds)
  // Nested filters are valid API input but not representable in FilterValue.
  const visualNovelFilter = (uniqueIds.length === 1
    ? ['id', '=', uniqueIds[0]]
    : [
        'or',
        ...uniqueIds.map((id): Filter => ['id', '=', id])
      ]) as unknown as FilterValue
  const seenReleaseIds = new Set<string>()

  for (let page = 1; page <= maxVisualNovelReleasePages; page += 1) {
    const response = await vndbClient.getReleases({
      filters: ['vn', '=', visualNovelFilter],
      fields: releaseSearchFields,
      results: releasesPageSize,
      page,
      sort: 'released',
      reverse: true
    })

    for (const release of response.results as PartialVndbRelease[]) {
      if (seenReleaseIds.has(release.id)) {
        continue
      }
      seenReleaseIds.add(release.id)

      const summary = mapReleaseSummary(release)
      for (const releaseVn of summary.vns) {
        if (requestedIds.has(releaseVn.id)) {
          releasesByVisualNovel.get(releaseVn.id)?.push(summary)
        }
      }
    }

    if (!response.more) {
      break
    }
    if (page === maxVisualNovelReleasePages) {
      logError(
        ['VNDB releases truncated after', maxVisualNovelReleasePages, 'pages'],
        LogPrefix.Backend
      )
    }
  }

  for (const [id, releases] of releasesByVisualNovel) {
    releasesByVisualNovel.set(id, sortReleasesByDate(releases))
  }
  return releasesByVisualNovel
}

function attachReleases(
  result: VndbSearchResult,
  releasesByVisualNovel: Map<string, VndbRelease[]>
): VndbSearchResult {
  const releases = releasesByVisualNovel.get(result.id) ?? []

  return {
    ...result,
    latestRelease: releases[0],
    releases
  }
}

async function mapVisualNovelWithReleases(
  vn: PartialVisualNovel
): Promise<VndbSearchResult> {
  const result = mapVisualNovel(vn)
  return attachReleases(
    result,
    await getLatestReleasesForVisualNovels([result.id])
  )
}

async function searchVndbById(
  query: string
): Promise<VndbSearchResult[] | null> {
  const searchId = getSearchId(query)
  if (!searchId) {
    return null
  }

  const id = query.toLocaleLowerCase()
  if (searchId.type === 'v') {
    const visualNovel = await vndbClient.getVisualNovel(id, searchFields)
    if (!visualNovel) {
      return []
    }

    return [await mapVisualNovelWithReleases(visualNovel as PartialVisualNovel)]
  }

  if (searchId.type === 'r') {
    const release = await vndbClient.getRelease(id, releaseSearchFields)
    return release ? [mapRelease(release as PartialVndbRelease)] : []
  }

  return []
}

function sortSearchResults(
  query: string,
  visualNovels: VndbSearchResult[],
  releases: VndbSearchResult[],
  limit: number
): VndbSearchResult[] {
  const normalizedQuery = normalizeTitleForMatch(query)
  const hasExactVisualNovel = visualNovels.some(
    (visualNovel) =>
      normalizeTitleForMatch(visualNovel.title) === normalizedQuery
  )
  const exactReleases = releases.filter(
    (release) => normalizeTitleForMatch(release.title) === normalizedQuery
  )
  const promotableExactReleases = exactReleases.filter(
    (release) => !hasExactVisualNovel || (release.releaseVns?.length ?? 0) > 1
  )
  const demotedExactReleases = exactReleases.filter(
    (release) => !promotableExactReleases.includes(release)
  )
  const otherReleases = releases.filter(
    (release) => normalizeTitleForMatch(release.title) !== normalizedQuery
  )

  return [
    ...promotableExactReleases,
    ...visualNovels,
    ...demotedExactReleases,
    ...otherReleases
  ].slice(0, limit)
}

async function searchVndbVisualNovelsInternal(
  query: string,
  limit?: number
): Promise<VndbSearchResult[]> {
  if (!getVndbFeatureSettings().enableVndbIntegration) {
    return []
  }

  refreshVndbClientApiToken()

  const normalizedQuery = normalizeSearchQuery(query)
  if (!normalizedQuery) {
    return []
  }

  const normalizedLimit = normalizeSearchLimit(limit)
  const cacheKey = getSearchCacheKey(normalizedQuery, normalizedLimit)
  const cached = vndbSearchCache.get(cacheKey)
  if (cached) {
    return cached
  }

  try {
    const idResults = await searchVndbById(normalizedQuery)
    if (idResults) {
      vndbSearchCache.set(cacheKey, idResults)
      return idResults.slice(0, normalizedLimit)
    }

    const [visualNovels, releases] = await Promise.all([
      vndbClient.searchVisualNovels(
        normalizedQuery,
        searchFields,
        normalizedLimit
      ),
      vndbClient.getReleases({
        filters: ['search', '=', normalizedQuery],
        fields: releaseSearchFields,
        results: normalizedLimit,
        sort: 'searchrank'
      })
    ])
    const hydratedVisualNovels = (visualNovels as PartialVisualNovel[])
      .slice(0, maxHydratedVisualNovelSearchResults)
      .map(mapVisualNovel)
    const releasesByVisualNovel = await getLatestReleasesForVisualNovels(
      hydratedVisualNovels.map((visualNovel) => visualNovel.id)
    )
    const mappedVisualNovels = (visualNovels as PartialVisualNovel[]).map(
      (visualNovel, index) =>
        index < maxHydratedVisualNovelSearchResults
          ? attachReleases(hydratedVisualNovels[index], releasesByVisualNovel)
          : mapVisualNovel(visualNovel)
    )
    const mappedResults = sortSearchResults(
      normalizedQuery,
      mappedVisualNovels,
      (releases.results as PartialVndbRelease[]).map(mapRelease),
      normalizedLimit
    )
    vndbSearchCache.set(cacheKey, mappedResults)
    return mappedResults
  } catch (error) {
    const message = isVndbError(error) ? error.friendlyMessage : error
    logError(['VNDB search failed:', message], LogPrefix.Backend)
    throw error
  }
}

export function searchVndbVisualNovels(
  query: string,
  limit?: number
): Promise<VndbSearchResult[]> {
  return runUserInitiated(() => searchVndbVisualNovelsInternal(query, limit))
}
