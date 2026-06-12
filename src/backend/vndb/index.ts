import CacheStore from 'backend/cache'
import { tsStore } from 'backend/constants/key_value_stores'
import { logError, logInfo, LogPrefix } from 'backend/logger'
import { isVndbError, parseVndbId } from 'vndb-kana-api'
import type {
  AuthInfo,
  Release,
  ReleaseVn,
  UserLabelInfo,
  UserListEntry,
  VisualNovel,
  VnRelation
} from 'vndb-kana-api'
import type {
  VndbGameMatch,
  VndbGameMatchSuggestion,
  VndbGameMatchTarget,
  VndbGameMatchUpdate,
  VndbRelease,
  VndbReleaseVisualNovel,
  VndbRelation,
  VndbSearchResult,
  VndbTag,
  VndbUserDataSyncResult,
  VndbUserDataSyncTarget,
  VndbUserLabel,
  VndbUserOptions,
  VndbUserOptionsUpdate
} from 'common/types/vndb'

import {
  hasStoredApiToken,
  refreshVndbClientApiToken,
  vndbClient
} from './client'
import { vndbMatchesStore } from './electronStore'

type PartialVisualNovel = Partial<
  Pick<
    VisualNovel,
    | 'id'
    | 'title'
    | 'alttitle'
    | 'titles'
    | 'aliases'
    | 'image'
    | 'released'
    | 'average'
    | 'rating'
    | 'votecount'
    | 'length'
    | 'length_minutes'
    | 'length_votes'
    | 'description'
    | 'developers'
    | 'languages'
    | 'platforms'
  >
> & {
  id: string
  title: string
  relations?: PartialVndbRelation[]
  tags?: PartialVndbTag[]
}

type PartialVndbTag = Partial<
  Pick<VndbTag, 'id' | 'name' | 'category' | 'rating' | 'spoiler' | 'lie'>
> & {
  id: string
  name: string
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
  Pick<
    ReleaseVn,
    | 'id'
    | 'title'
    | 'alttitle'
    | 'titles'
    | 'aliases'
    | 'image'
    | 'released'
    | 'rtype'
  >
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
    | 'alttitle'
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

type PartialAuthInfo = Partial<AuthInfo> & Pick<AuthInfo, 'id' | 'username'>

const vndbSearchCache = new CacheStore<VndbSearchResult[]>(
  'vndb-search-v8',
  60 * 24 * 7
)

const maxSearchResults = 50
const maxVisualNovelReleases = 50
const finishedLabelId = 2

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

const releaseSearchFields = [
  'id',
  'title',
  'alttitle',
  'released',
  'official',
  'patch',
  'freeware',
  'languages{lang,title,latin,main,mtl}',
  'platforms',
  'vns{id,title,alttitle,titles{title,latin},aliases,rtype,released,image{url},relations{id,title,relation,relation_official,released,image{url}}}'
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

function mapTag(tag: PartialVndbTag): VndbTag {
  return {
    id: tag.id,
    name: tag.name,
    category: tag.category ?? '',
    rating: tag.rating ?? 0,
    spoiler: tag.spoiler ?? 0,
    lie: tag.lie ?? false
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

function getUniqueSearchAliases(values: Array<string | null | undefined>) {
  return [
    ...new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  ]
}

function getVisualNovelAliases(
  vn: Pick<PartialVisualNovel, 'alttitle' | 'titles' | 'aliases'>
): string[] {
  return getUniqueSearchAliases([
    vn.alttitle,
    ...(vn.aliases ?? []),
    ...(vn.titles?.flatMap((title) => [title.title, title.latin]) ?? [])
  ])
}

function mapVisualNovel(vn: PartialVisualNovel): VndbSearchResult {
  const relations = vn.relations?.map(mapRelation) ?? []

  return {
    id: vn.id,
    title: vn.title,
    aliases: getVisualNovelAliases(vn),
    source: 'visualNovel',
    imageUrl: vn.image?.url,
    released: vn.released,
    average: vn.average,
    rating: vn.rating,
    votecount: vn.votecount,
    length: vn.length,
    lengthMinutes: vn.length_minutes,
    lengthVotes: vn.length_votes,
    description: vn.description,
    tags: vn.tags?.map(mapTag),
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
    aliases: getVisualNovelAliases(vn),
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
    aliases: getUniqueSearchAliases([
      release.alttitle,
      ...releaseVns.flatMap((vn) => [vn.title, ...(vn.aliases ?? [])])
    ]),
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

function mapUserLabel(label: UserLabelInfo): VndbUserLabel {
  return {
    id: label.id,
    label: label.label,
    private: label.private,
    count: label.count
  }
}

function getEmptyUserOptions(hasToken: boolean): VndbUserOptions {
  return {
    hasToken,
    canRead: false,
    canWrite: false,
    labels: [],
    selectedLabelIds: [],
    vote: null
  }
}

function isValidDate(date: Date): boolean {
  return Number.isFinite(date.getTime())
}

function formatVndbDate(date: Date | undefined): string | undefined {
  if (!date || !isValidDate(date)) {
    return undefined
  }

  return date.toISOString().slice(0, 10)
}

function getUnixTimestampDate(timestamp: number | null | undefined) {
  if (typeof timestamp !== 'number') {
    return undefined
  }

  return new Date(timestamp * 1000)
}

function getStoredLastPlayedDate(appName: string) {
  const value = tsStore.get_nodefault(`${appName}.lastPlayed`)
  if (typeof value !== 'string' || !value) {
    return undefined
  }

  return new Date(value)
}

function getRecordedInstallDate(installedAt: string | undefined) {
  if (!installedAt) {
    return undefined
  }

  const date = new Date(installedAt)
  return isValidDate(date) ? date : undefined
}

function isDateAfter(left: string, right: string): boolean {
  return left.localeCompare(right) > 0
}

function getStoredMatchMainVisualNovelId(
  match: VndbGameMatch
): string | undefined {
  if (match.source !== 'release') {
    return match.vndbId.startsWith('v') ? match.vndbId : undefined
  }

  return (
    match.mainVndbId ??
    match.mainRelation?.id ??
    match.latestRelease?.vns[0]?.id ??
    match.releaseVns?.[0]?.id ??
    (match.vndbId.startsWith('v') ? match.vndbId : undefined)
  )
}

function getStoredMatchSelectedReleases(match: VndbGameMatch): VndbRelease[] {
  if (match.selectedReleases !== undefined) {
    return match.selectedReleases
  }

  if (match.latestRelease) {
    return [match.latestRelease]
  }

  return []
}

function getPermissions(authInfo: PartialAuthInfo) {
  const permissions = authInfo.permissions ?? []

  return {
    canRead: permissions.includes('listread'),
    canWrite: permissions.includes('listwrite')
  }
}

function getUserListEntry(
  entries: UserListEntry[],
  visualNovelId: string
): UserListEntry | undefined {
  return entries.find((entry) => entry.id === visualNovelId)
}

function normalizeUserOptionsUpdate(
  update: VndbUserOptionsUpdate
): VndbUserOptionsUpdate {
  return {
    ...update,
    labels: update.labels
      ?.filter((labelId) => labelId !== 0 && labelId !== 7)
      .sort((left, right) => left - right)
  }
}

function getVndbRequestErrorMessage(error: unknown): string {
  if (!isVndbError(error)) {
    return error instanceof Error ? error.message : String(error)
  }

  const status = error.status ? `HTTP ${error.status}` : undefined

  if (typeof error.response === 'string' && error.response.trim()) {
    return [status, error.response.trim()].filter(Boolean).join(': ')
  }

  if (
    typeof error.response === 'object' &&
    error.response !== null &&
    'message' in error.response &&
    typeof error.response.message === 'string'
  ) {
    return [status, error.response.message].filter(Boolean).join(': ')
  }

  if (error.response !== undefined) {
    try {
      return [status, JSON.stringify(error.response)].filter(Boolean).join(': ')
    } catch {
      // Fall back to the error message when the response is not serializable.
    }
  }

  return [status, error.message].filter(Boolean).join(': ')
}

function getVndbRequestErrorDetails(error: unknown) {
  if (!isVndbError(error)) {
    return {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }
  }

  return {
    name: error.name,
    message: error.message,
    status: error.status,
    code: error.code,
    response: error.response,
    stack: error.stack
  }
}

export async function getVndbUserOptions(
  visualNovelId: string
): Promise<VndbUserOptions> {
  refreshVndbClientApiToken()

  if (!hasStoredApiToken()) {
    return getEmptyUserOptions(false)
  }

  const authInfo = (await vndbClient.getAuthInfo()) as PartialAuthInfo
  const { canRead, canWrite } = getPermissions(authInfo)

  if (!canRead) {
    return {
      ...getEmptyUserOptions(true),
      username: authInfo.username,
      canWrite
    }
  }

  const [labelResponse, userListResponse] = await Promise.all([
    vndbClient.getUserLabels(undefined, ['count']),
    vndbClient.getUserList({
      user: authInfo.id,
      filters: ['id', '=', visualNovelId],
      fields: 'id,vote,voted,started,finished,labels{id,label}',
      results: 1
    })
  ])
  const userListEntry = getUserListEntry(
    userListResponse.results,
    visualNovelId
  )

  return {
    hasToken: true,
    username: authInfo.username,
    canRead,
    canWrite,
    labels: labelResponse.labels.map(mapUserLabel),
    selectedLabelIds:
      userListEntry?.labels.map((label) => label.id).filter((id) => id !== 7) ??
      [],
    vote: userListEntry?.vote ?? null,
    started: userListEntry?.started ?? null,
    finished: userListEntry?.finished ?? null,
    voted: userListEntry?.voted ?? null
  }
}

export async function updateVndbUserOptions(
  visualNovelId: string,
  update: VndbUserOptionsUpdate
): Promise<VndbUserOptions> {
  refreshVndbClientApiToken()

  if (!hasStoredApiToken()) {
    return getEmptyUserOptions(false)
  }

  const normalizedUpdate = normalizeUserOptionsUpdate(update)

  try {
    await vndbClient.updateUserListEntry(visualNovelId, normalizedUpdate)
  } catch (error) {
    const message = getVndbRequestErrorMessage(error)
    logError(
      [
        'VNDB user options update failed:',
        {
          visualNovelId,
          update: normalizedUpdate,
          error: getVndbRequestErrorDetails(error)
        }
      ],
      LogPrefix.Backend
    )
    throw new Error(
      `Unable to update VNDB user options for ${visualNovelId}: ${message}`
    )
  }

  return getVndbUserOptions(visualNovelId)
}

export async function updateVndbUserRelease(
  releaseId: string,
  selected: boolean
): Promise<void> {
  refreshVndbClientApiToken()

  if (!hasStoredApiToken()) {
    throw new Error('VNDB API token is not configured')
  }

  if (selected) {
    await vndbClient.updateUserReleaseEntry(releaseId, { status: 2 })
  } else {
    await vndbClient.deleteUserReleaseEntry(releaseId)
  }
}

export async function syncVndbUserData(
  targets: VndbUserDataSyncTarget[]
): Promise<VndbUserDataSyncResult> {
  refreshVndbClientApiToken()

  if (!hasStoredApiToken()) {
    return {
      hasToken: false,
      canWrite: false,
      synced: 0,
      skipped: targets.length,
      errors: []
    }
  }

  const authInfo = (await vndbClient.getAuthInfo()) as PartialAuthInfo
  const { canRead, canWrite } = getPermissions(authInfo)
  const result: VndbUserDataSyncResult = {
    hasToken: true,
    canWrite,
    synced: 0,
    skipped: 0,
    errors: []
  }

  if (!canWrite) {
    return {
      ...result,
      skipped: targets.length
    }
  }

  const storedMatches = getAllStoredMatches()

  for (const target of targets) {
    const match = storedMatches[getMatchKey(target)]
    const visualNovelId = match ? getStoredMatchMainVisualNovelId(match) : ''

    if (!match || !visualNovelId) {
      result.skipped += 1
      continue
    }

    try {
      const userListEntry = canRead
        ? getUserListEntry(
            (
              await vndbClient.getUserList({
                user: authInfo.id,
                filters: ['id', '=', visualNovelId],
                fields: 'id,voted,started,finished,labels{id,label}',
                results: 1
              })
            ).results,
            visualNovelId
          )
        : undefined
      const hasFinishedLabel =
        userListEntry?.labels.some((label) => label.id === finishedLabelId) ??
        false
      const finished = hasFinishedLabel
        ? formatVndbDate(
            getUnixTimestampDate(userListEntry?.voted) ??
              getStoredLastPlayedDate(target.appName)
          )
        : undefined
      const effectiveFinished = finished ?? userListEntry?.finished ?? undefined
      const recordedStarted = formatVndbDate(
        getRecordedInstallDate(target.installedAt)
      )
      const update: VndbUserOptionsUpdate = {}

      if (target.runner === 'sideload') {
        if (
          recordedStarted &&
          (!effectiveFinished ||
            !isDateAfter(recordedStarted, effectiveFinished))
        ) {
          update.started = recordedStarted
        }
      }

      if (finished) {
        update.finished = finished
      }

      const selectedReleases = getStoredMatchSelectedReleases(match)

      if (Object.keys(update).length) {
        await vndbClient.updateUserListEntry(visualNovelId, update)
      }

      if (target.includeReleases !== false) {
        await Promise.all(
          selectedReleases.map((release) =>
            vndbClient.updateUserReleaseEntry(release.id, { status: 2 })
          )
        )
      }

      result.synced += 1
    } catch (error) {
      result.errors.push({
        appName: target.appName,
        message: getVndbRequestErrorMessage(error)
      })
    }
  }

  return result
}

export async function searchVndbVisualNovels(
  query: string,
  limit?: number
): Promise<VndbSearchResult[]> {
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
    const previousMatch = currentMatches[key]
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
  }

  vndbMatchesStore.set('matches', currentMatches)
  logInfo(['Synced VNDB matches:', updates.length], LogPrefix.Backend)
  return currentMatches
}
