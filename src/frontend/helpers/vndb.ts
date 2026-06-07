import type {
  VndbRelease,
  VndbReleaseVisualNovel,
  VndbSearchResult
} from 'common/types/vndb'

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

export function getVndbReleasesWithSelectedRelease(
  releases: VndbRelease[] | undefined,
  selectedRelease: VndbRelease
): VndbRelease[] {
  const releaseMap = new Map<string, VndbRelease>()

  releaseMap.set(selectedRelease.id, selectedRelease)
  for (const release of releases ?? []) {
    releaseMap.set(release.id, release)
  }

  return [...releaseMap.values()]
}

type ReleaseMainVisualNovel = Pick<
  VndbReleaseVisualNovel,
  'id' | 'title' | 'imageUrl' | 'released'
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
    const releases = getVndbReleasesWithSelectedRelease(
      mainResult.releases,
      release
    )

    return {
      ...mainResult,
      latestRelease:
        releases.find((currentRelease) => currentRelease.id === release.id) ??
        release,
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
    source: 'visualNovel',
    imageUrl: mainVisualNovel.imageUrl ?? result.imageUrl,
    released: mainVisualNovel.released,
    developers: result.developers,
    languages: [],
    platforms: [],
    relations: mainVisualNovel.relations ?? result.relations,
    mainRelation: mainVisualNovel.mainRelation,
    latestRelease: release,
    releases: getVndbReleasesWithSelectedRelease(result.releases, release),
    releaseVns: release.vns
  }
}

export function getVndbReleaseMainVisualNovelId(
  result: VndbSearchResult
): string | undefined {
  return getReleaseMainVisualNovel(result)?.id
}
