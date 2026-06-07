import CacheStore from 'backend/cache'
import { logError, logInfo, LogPrefix } from 'backend/logger'
import { isVndbError, parseVndbId } from 'vndb-kana-api'
import type { Release, ReleaseVn, VisualNovel, VnRelation } from 'vndb-kana-api'
import type {
  VndbGameMatch,
  VndbGameMatchSuggestion,
  VndbGameMatchTarget,
  VndbGameMatchUpdate,
  VndbRelease,
  VndbReleaseVisualNovel,
  VndbRelation,
  VndbSearchResult
} from 'common/types/vndb'

import { vndbClient } from './client'
import { vndbMatchesStore } from './electronStore'

type PartialVisualNovel = Partial<
  Pick<
    VisualNovel,
    | 'id'
    | 'title'
    | 'image'
    | 'released'
    | 'rating'
    | 'votecount'
    | 'length_minutes'
    | 'description'
    | 'developers'
    | 'languages'
    | 'platforms'
  >
> & {
  id: string
  title: string
  relations?: PartialVndbRelation[]
}

type PartialVndbRelation = Partial<
  Pick<
    VnRelation,
    'id' | 'title' | 'image' | 'released' | 'relation' | 'relation_official'
  >
> & {
  id: string
  title: string
  relation: string
}

type PartialVndbReleaseVn = Partial<
  Pick<ReleaseVn, 'id' | 'title' | 'image' | 'released' | 'rtype'>
> & {
  id: string
  title: string
  relations?: PartialVndbRelation[]
}

type PartialVndbRelease = Partial<
  Pick<
    Release,
    | 'id'
    | 'title'
    | 'released'
    | 'official'
    | 'patch'
    | 'freeware'
    | 'languages'
    | 'platforms'
  >
> & {
  id: string
  title: string
  vns?: PartialVndbReleaseVn[]
}

const vndbSearchCache = new CacheStore<VndbSearchResult[]>(
  'vndb-search-v7',
  60 * 24 * 7
)

const maxSearchResults = 50
const maxVisualNovelReleases = 50

const searchFields = [
  'id',
  'title',
  'released',
  'rating',
  'votecount',
  'length_minutes',
  'description',
  'image{url}',
  'developers{name}',
  'languages',
  'platforms',
  'relations{id,title,relation,relation_official,released,image{url}}'
].join(',')

const releaseSearchFields = [
  'id',
  'title',
  'released',
  'official',
  'patch',
  'freeware',
  'languages{lang,title,latin,main,mtl}',
  'platforms',
  'vns{id,title,rtype,released,image{url},relations{id,title,relation,relation_official,released,image{url}}}'
].join(',')

const relationLabels: Record<string, string> = {
  seq: 'Sequel',
  preq: 'Prequel',
  set: 'Same setting',
  alt: 'Alternative version',
  char: 'Shares characters',
  side: 'Side story',
  par: 'Parent story',
  ser: 'Same series',
  fan: 'Fandisc',
  orig: 'Original version'
}

const mainRelationPriority: Record<string, number> = {
  orig: 0,
  par: 1,
  preq: 2,
  ser: 3
}

function normalizeSearchLimit(limit: number | undefined): number {
  if (!limit) {
    return 5
  }

  return Math.min(Math.max(Math.floor(limit), 1), maxSearchResults)
}

function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ')
}

function normalizeTitleForMatch(title: string): string {
  return normalizeSearchQuery(title)
    .toLocaleLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function getReleaseDateSortValue(released: string | null | undefined): number {
  if (!released || !/^\d{4}-\d{2}-\d{2}$/.test(released)) {
    return Number.NEGATIVE_INFINITY
  }

  return Date.parse(released)
}

function getSearchCacheKey(query: string, limit: number): string {
  return `${query.toLocaleLowerCase()}::${limit}`
}

function getSearchId(query: string): ReturnType<typeof parseVndbId> {
  return parseVndbId(query.toLocaleLowerCase())
}

function getMatchKey({
  runner,
  appName
}: Pick<VndbGameMatch, 'runner' | 'appName'>): string {
  return `${runner}:${appName}`
}

function getRelationLabel(relation: string): string {
  return relationLabels[relation] ?? relation
}

function mapRelation(relation: PartialVndbRelation): VndbRelation {
  return {
    id: relation.id,
    title: relation.title,
    relation: relation.relation,
    relationLabel: getRelationLabel(relation.relation),
    relationOfficial: relation.relation_official ?? false,
    imageUrl: relation.image?.url,
    released: relation.released
  }
}

function getMainRelation(relations: VndbRelation[]) {
  return relations
    .filter((relation) => relation.relation in mainRelationPriority)
    .sort((left, right) => {
      if (left.relationOfficial !== right.relationOfficial) {
        return left.relationOfficial ? -1 : 1
      }

      return (
        mainRelationPriority[left.relation] -
        mainRelationPriority[right.relation]
      )
    })[0]
}

function getUniqueRelations(relations: VndbRelation[]): VndbRelation[] {
  const uniqueRelations = new Map<string, VndbRelation>()

  for (const relation of relations) {
    uniqueRelations.set(`${relation.id}:${relation.relation}`, relation)
  }

  return [...uniqueRelations.values()]
}

function mapVisualNovel(vn: PartialVisualNovel): VndbSearchResult {
  const relations = vn.relations?.map(mapRelation) ?? []

  return {
    id: vn.id,
    title: vn.title,
    source: 'visualNovel',
    imageUrl: vn.image?.url,
    released: vn.released,
    rating: vn.rating,
    votecount: vn.votecount,
    lengthMinutes: vn.length_minutes,
    description: vn.description,
    developers: vn.developers?.map((developer) => developer.name) ?? [],
    languages: vn.languages ?? [],
    platforms: vn.platforms ?? [],
    relations,
    mainRelation: getMainRelation(relations)
  }
}

function mapReleaseVisualNovel(
  vn: PartialVndbReleaseVn
): VndbReleaseVisualNovel {
  const relations = vn.relations?.map(mapRelation) ?? []

  return {
    id: vn.id,
    title: vn.title,
    rtype: vn.rtype,
    imageUrl: vn.image?.url,
    released: vn.released,
    relations,
    mainRelation: getMainRelation(relations)
  }
}

function mapReleaseSummary(release: PartialVndbRelease): VndbRelease {
  const releaseVns = release.vns?.map(mapReleaseVisualNovel) ?? []

  return {
    id: release.id,
    title: release.title,
    imageUrl: releaseVns.find((releaseVn) => releaseVn.imageUrl)?.imageUrl,
    released: release.released,
    official: release.official,
    patch: release.patch,
    freeware: release.freeware,
    languages: release.languages?.map((language) => language.lang) ?? [],
    languageTitles: release.languages?.map((language) => ({
      lang: language.lang,
      title: language.title,
      latin: language.latin,
      main: language.main,
      mtl: language.mtl
    })),
    platforms: release.platforms ?? [],
    vns: releaseVns
  }
}

function sortReleasesByDate(releases: VndbRelease[]): VndbRelease[] {
  return [...releases].sort((left, right) => {
    const dateDifference =
      getReleaseDateSortValue(right.released) -
      getReleaseDateSortValue(left.released)

    if (dateDifference !== 0) {
      return dateDifference
    }

    if (left.official !== right.official) {
      return left.official ? -1 : 1
    }

    return left.title.localeCompare(right.title)
  })
}

function mapRelease(release: PartialVndbRelease): VndbSearchResult {
  const releaseSummary = mapReleaseSummary(release)
  const releaseVns = releaseSummary.vns
  const relations = getUniqueRelations(
    releaseVns.flatMap((releaseVn) => releaseVn.relations)
  )

  return {
    id: release.id,
    title: release.title,
    source: 'release',
    imageUrl: releaseSummary.imageUrl,
    released: release.released,
    developers: [],
    languages: [],
    platforms: release.platforms ?? [],
    relations,
    mainRelation: getMainRelation(relations),
    latestRelease: releaseSummary,
    releases: [releaseSummary],
    releaseVns
  }
}

async function getLatestReleasesForVisualNovel(
  visualNovelId: string
): Promise<VndbRelease[]> {
  const releases = await vndbClient.getReleases({
    filters: ['vn', '=', ['id', '=', visualNovelId]],
    fields: releaseSearchFields,
    results: maxVisualNovelReleases,
    sort: 'released',
    reverse: true
  })

  return sortReleasesByDate(
    (releases.results as PartialVndbRelease[]).map(mapReleaseSummary)
  ).slice(0, maxVisualNovelReleases)
}

async function mapVisualNovelWithReleases(
  vn: PartialVisualNovel
): Promise<VndbSearchResult> {
  const result = mapVisualNovel(vn)
  const releases = await getLatestReleasesForVisualNovel(result.id)

  return {
    ...result,
    latestRelease: releases[0],
    releases
  }
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

function getAllStoredMatches(): Record<string, VndbGameMatch> {
  return vndbMatchesStore.get('matches', {})
}

export async function searchVndbVisualNovels(
  query: string,
  limit?: number
): Promise<VndbSearchResult[]> {
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
    const mappedVisualNovels = await Promise.all(
      (visualNovels as PartialVisualNovel[]).map(mapVisualNovelWithReleases)
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

export async function matchVndbGames(
  games: VndbGameMatchTarget[]
): Promise<VndbGameMatchSuggestion[]> {
  const suggestions: VndbGameMatchSuggestion[] = []

  for (const game of games) {
    const results = await searchVndbVisualNovels(game.title, 1)
    suggestions.push({
      game,
      result: results[0] ?? null
    })
  }

  return suggestions
}

export function getVndbGameMatch(
  appName: string,
  runner: VndbGameMatch['runner']
): VndbGameMatch | null {
  return getAllStoredMatches()[getMatchKey({ appName, runner })] ?? null
}

export function getAllVndbGameMatches(): Record<string, VndbGameMatch> {
  return getAllStoredMatches()
}

export function syncVndbGameMatches(
  updates: VndbGameMatchUpdate[]
): Record<string, VndbGameMatch> {
  const currentMatches = getAllStoredMatches()
  const syncedAt = new Date().toISOString()

  for (const update of updates) {
    const key = getMatchKey(update)
    if (!update.vndbId) {
      delete currentMatches[key]
      continue
    }

    currentMatches[key] = {
      appName: update.appName,
      runner: update.runner,
      title: update.title,
      vndbId: update.vndbId,
      vndbTitle: update.vndbTitle ?? update.title,
      source: update.source,
      imageUrl: update.imageUrl,
      released: update.released,
      developers: update.developers,
      languages: update.languages,
      mainVndbId: update.mainRelation?.id,
      mainVndbTitle: update.mainRelation?.title,
      mainRelation: update.mainRelation,
      relations: update.relations,
      latestRelease: update.latestRelease,
      releases: update.releases,
      releaseVns: update.releaseVns,
      syncedAt
    }
  }

  vndbMatchesStore.set('matches', currentMatches)
  logInfo(['Synced VNDB matches:', updates.length], LogPrefix.Backend)
  return currentMatches
}
