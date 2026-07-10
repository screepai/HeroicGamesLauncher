import type {
  VndbGameMatch,
  VndbRelease,
  VndbReleaseVisualNovel,
  VndbSearchResult,
  VndbTag
} from 'common/types/vndb'

const vndbLengthLabels: Record<number, string> = {
  1: 'Very short',
  2: 'Short',
  3: 'Medium',
  4: 'Long',
  5: 'Very long'
}

const vndbPlatformLabels: Record<string, string> = {
  and: 'Android',
  bdp: 'Blu-ray Player',
  dos: 'DOS',
  drc: 'Dreamcast',
  dvd: 'DVD Player',
  fm7: 'FM-7',
  fm8: 'FM-8',
  fmt: 'FM Towns',
  gba: 'Game Boy Advance',
  gbc: 'Game Boy Color',
  ios: 'Apple iProduct',
  lin: 'Linux',
  mac: 'Mac OS',
  mob: 'Other (mobile)',
  msx: 'MSX',
  n3d: 'Nintendo 3DS',
  nds: 'Nintendo DS',
  nes: 'Famicom',
  oth: 'Other',
  p88: 'PC-88',
  p98: 'PC-98',
  pce: 'PC Engine',
  pcf: 'PC-FX',
  ps1: 'PlayStation 1',
  ps2: 'PlayStation 2',
  ps3: 'PlayStation 3',
  ps4: 'PlayStation 4',
  ps5: 'PlayStation 5',
  psp: 'PlayStation Portable',
  psv: 'PlayStation Vita',
  sat: 'Sega Saturn',
  scd: 'Sega Mega-CD',
  sfc: 'Super Famicom',
  smd: 'Sega Mega Drive',
  sw2: 'Nintendo Switch 2',
  swi: 'Nintendo Switch',
  tdo: '3DO',
  vnd: 'VNDS',
  web: 'Website',
  wii: 'Nintendo Wii',
  win: 'Windows',
  wiu: 'Nintendo Wii U',
  x1s: 'Sharp X1',
  x68: 'Sharp X68000',
  xb1: 'Xbox',
  xb3: 'Xbox 360',
  xbo: 'Xbox One',
  xxs: 'Xbox X/S'
}

function getVndbPlatformLabel(platform: string): string {
  return vndbPlatformLabels[platform] ?? platform.toLocaleUpperCase()
}

export function getUniqueSortedVndbPlatforms(platforms: string[]): string[] {
  return Array.from(new Set(platforms.filter(Boolean))).toSorted(
    (left, right) =>
      getVndbPlatformLabel(left).localeCompare(getVndbPlatformLabel(right))
  )
}

export function getVndbPlatformsLabel(platforms: string[]): string {
  return getUniqueSortedVndbPlatforms(platforms)
    .map(getVndbPlatformLabel)
    .join(', ')
}

export function formatVndbScore(value: number | null | undefined): string {
  if (typeof value !== 'number') {
    return ''
  }

  return `${(value / 10).toFixed(1)}/10`
}

export function getVndbScoreValue(value: number | null | undefined): string {
  if (typeof value !== 'number') {
    return ''
  }

  return Math.round(value).toString()
}

export function formatVndbLength(
  match: Pick<VndbGameMatch, 'length' | 'lengthMinutes'>,
  t: (
    key: string,
    defaultValue: string,
    options?: Record<string, unknown>
  ) => string
): string {
  if (match.lengthMinutes) {
    const hours = Math.floor(match.lengthMinutes / 60)
    const minutes = match.lengthMinutes % 60

    return hours > 0
      ? t('vndb.length-hours-minutes', '{{hours}}h {{minutes}}m', {
          hours,
          minutes
        })
      : t('vndb.length-minutes', '{{minutes}}m', { minutes })
  }

  if (typeof match.length === 'number') {
    return vndbLengthLabels[match.length] ?? String(match.length)
  }

  return ''
}

export function getCleanVndbDescription(
  description: string | null | undefined
) {
  return (
    description
      ?.replace(/\[url=([^\]]+)\]([^[]+)\[\/url\]/gi, '$2')
      .replace(/\[url\]([^[]+)\[\/url\]/gi, '$1')
      .replace(/\[(\/)?[a-z0-9_=-]+\]/gi, '')
      .replace(/\n{3,}/g, '\n\n')
      .trim() ?? ''
  )
}

export function getTopVndbTags(
  tags: VndbTag[] | undefined,
  {
    category,
    limit
  }: {
    category?: string
    limit: number
  }
): VndbTag[] {
  return (tags ?? [])
    .filter(
      (tag) =>
        !tag.lie &&
        tag.spoiler === 0 &&
        (!category || tag.category === category)
    )
    .toSorted((left, right) => right.rating - left.rating)
    .slice(0, limit)
}

function getVndbReleaseDateSortValue(
  released: string | null | undefined
): number {
  if (!released || !/^\d{4}-\d{2}-\d{2}$/.test(released)) {
    return Number.NEGATIVE_INFINITY
  }

  return Date.parse(released)
}

export function sortVndbItemsByDate<
  T extends { released?: string | null; title: string }
>(items: T[]): T[] {
  return items.toSorted((left, right) => {
    const dateDifference =
      getVndbReleaseDateSortValue(right.released) -
      getVndbReleaseDateSortValue(left.released)

    if (dateDifference !== 0) {
      return dateDifference
    }

    return left.title.localeCompare(right.title)
  })
}

export function sortVndbReleasesByDate(releases: VndbRelease[]): VndbRelease[] {
  return sortVndbItemsByDate(releases)
}

export function getVndbReleasesWithSelectedReleases(
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

export function getSelectedVndbReleases(match: VndbGameMatch): VndbRelease[] {
  if (match.selectedReleases !== undefined) {
    return match.selectedReleases
  }

  const selectedRelease = getSelectedVndbRelease(match)
  return selectedRelease ? [selectedRelease] : []
}

export function getSelectedVndbRelease(
  match: VndbGameMatch
): VndbRelease | undefined {
  if (match.selectedReleases !== undefined) {
    return match.selectedReleases[0]
  }

  if (match.latestRelease) {
    return match.latestRelease
  }

  if (match.source !== 'release') {
    return undefined
  }

  return {
    id: match.vndbId,
    title: match.vndbTitle,
    imageUrl: match.imageUrl,
    released: match.released,
    languages: match.languages ?? [],
    platforms: [],
    vns: match.releaseVns ?? []
  }
}

type ReleaseMainVisualNovel = Pick<
  VndbReleaseVisualNovel,
  'id' | 'title' | 'aliases' | 'imageUrl' | 'released'
> & {
  relations?: VndbReleaseVisualNovel['relations']
  mainRelation?: VndbReleaseVisualNovel['mainRelation']
}

function getReleaseMainVisualNovel(
  result: VndbSearchResult
): ReleaseMainVisualNovel | undefined {
  if (result.source !== 'release') {
    return undefined
  }

  const releaseVn = result.releaseVns?.[0]
  if (releaseVn) {
    return releaseVn
  }

  return result.mainRelation
}

function getReleaseFromResult(result: VndbSearchResult): VndbRelease {
  return (
    result.latestRelease ?? {
      id: result.id,
      title: result.title,
      imageUrl: result.imageUrl,
      released: result.released,
      languages: result.languages,
      platforms: result.platforms,
      vns: result.releaseVns ?? []
    }
  )
}

export function normalizeVndbSelectedMatch(
  result: VndbSearchResult | null,
  mainResult?: VndbSearchResult
): VndbSearchResult | null {
  if (!result || result.source !== 'release') {
    return result
  }

  const release = getReleaseFromResult(result)
  const mainVisualNovel = getReleaseMainVisualNovel(result)

  if (mainResult?.source === 'visualNovel') {
    const releases = getVndbReleasesWithSelectedReleases(mainResult.releases, [
      release
    ])

    return {
      ...mainResult,
      latestRelease:
        releases.find((currentRelease) => currentRelease.id === release.id) ??
        release,
      selectedReleases: [release],
      releases,
      releaseVns: release.vns
    }
  }

  if (!mainVisualNovel) {
    return result
  }

  return {
    id: mainVisualNovel.id,
    title: mainVisualNovel.title,
    aliases: mainVisualNovel.aliases ?? result.aliases,
    source: 'visualNovel',
    imageUrl: mainVisualNovel.imageUrl ?? result.imageUrl,
    released: mainVisualNovel.released,
    average: result.average,
    rating: result.rating,
    votecount: result.votecount,
    length: result.length,
    lengthMinutes: result.lengthMinutes,
    lengthVotes: result.lengthVotes,
    description: result.description,
    tags: result.tags,
    developers: result.developers,
    languages: [],
    platforms: [],
    relations: mainVisualNovel.relations ?? result.relations,
    mainRelation: mainVisualNovel.mainRelation,
    latestRelease: release,
    selectedReleases: [release],
    releases: getVndbReleasesWithSelectedReleases(result.releases, [release]),
    releaseVns: release.vns
  }
}

export function getVndbReleaseMainVisualNovelId(
  result: VndbSearchResult
): string | undefined {
  return getReleaseMainVisualNovel(result)?.id
}
