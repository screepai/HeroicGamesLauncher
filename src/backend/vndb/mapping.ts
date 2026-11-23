import type { Release, ReleaseVn, VisualNovel, VnRelation } from 'vndb-kana-api'
import type {
  VndbRelease,
  VndbReleaseVisualNovel,
  VndbRelation,
  VndbSearchResult,
  VndbTag
} from 'common/types/vndb'

export type PartialVisualNovel = Partial<
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

export type PartialVndbTag = Partial<
  Pick<VndbTag, 'id' | 'name' | 'category' | 'rating' | 'spoiler' | 'lie'>
> & {
  id: string
  name: string
}

export type PartialVndbRelation = Partial<
  Pick<
    VnRelation,
    'id' | 'title' | 'image' | 'released' | 'relation' | 'relation_official'
  >
> & {
  id: string
  title: string
  relation: string
}

export type PartialVndbReleaseVn = Partial<
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

export type PartialVndbRelease = Partial<
  Pick<
    Release,
    | 'id'
    | 'title'
    | 'alttitle'
    | 'released'
    | 'official'
    | 'patch'
    | 'freeware'
    | 'engine'
    | 'languages'
    | 'platforms'
  >
> & {
  id: string
  title: string
  vns?: PartialVndbReleaseVn[]
}

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

export function normalizeSearchQuery(query: string): string {
  return query.trim().replace(/\s+/g, ' ')
}

export function normalizeTitleForMatch(title: string): string {
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

export function mapVisualNovel(vn: PartialVisualNovel): VndbSearchResult {
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

export function mapReleaseSummary(release: PartialVndbRelease): VndbRelease {
  const releaseVns = release.vns?.map(mapReleaseVisualNovel) ?? []

  return {
    id: release.id,
    title: release.title,
    engine: release.engine ?? undefined,
    engineKnown: true,
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

export function sortReleasesByDate(releases: VndbRelease[]): VndbRelease[] {
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

export function mapRelease(release: PartialVndbRelease): VndbSearchResult {
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
