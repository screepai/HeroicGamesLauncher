import type {
  VndbGameMatchTarget,
  VndbGameMatchUpdate,
  VndbSearchResult
} from './types/vndb'

type VndbMatchUpdateTarget = Pick<
  VndbGameMatchTarget,
  'appName' | 'runner' | 'title'
>

/**
 * Maps a VNDB search result (or null to clear the match) to the payload
 * `vndb.syncGameMatches` expects. Fields in `overrides` win over the result.
 */
export function searchResultToMatchUpdate(
  target: VndbMatchUpdateTarget,
  result: VndbSearchResult | null | undefined,
  overrides: Partial<Omit<VndbGameMatchUpdate, 'appName' | 'runner'>> = {}
): VndbGameMatchUpdate {
  return {
    appName: target.appName,
    runner: target.runner,
    title: target.title,
    vndbId: result?.id ?? null,
    vndbTitle: result?.title,
    aliases: result?.aliases,
    source: result?.source,
    imageUrl: result?.imageUrl,
    released: result?.released,
    average: result?.average,
    rating: result?.rating,
    votecount: result?.votecount,
    length: result?.length,
    lengthMinutes: result?.lengthMinutes,
    lengthVotes: result?.lengthVotes,
    description: result?.description,
    tags: result?.tags,
    developers: result?.developers,
    languages: result?.languages,
    mainRelation: result?.mainRelation,
    relations: result?.relations,
    latestRelease: result?.latestRelease,
    selectedReleases: result?.selectedReleases,
    releases: result?.releases,
    releaseVns: result?.releaseVns,
    ...overrides
  }
}
