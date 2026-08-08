import CacheStore from 'backend/cache'
import type {
  VnCompatibilityEntry,
  VnCompatibilityPrefixSetup,
  VnCompatibilityResult
} from 'common/types/vnCompatibility'

const compatibilityListUrl =
  'https://raw.githubusercontent.com/VNWiki/visual-novel-wiki/main/docs/public/vn_list.json'
const compatibilityNotesUrl =
  'https://raw.githubusercontent.com/VNWiki/visual-novel-wiki/main/docs/public/vn_list_notes.json'
const winePrefixesGuideUrl =
  'https://raw.githubusercontent.com/VNWiki/visual-novel-wiki/main/docs/linux/wineprefixes.md'

type VnWikiRecord = {
  'Visual Novel'?: unknown
  Linux?: unknown
  'Steam Deck'?: unknown
  'Game engine'?: unknown
  Wineprefix?: unknown
  'Wine version'?: unknown
  Notes?: unknown
}

type VnCompatibilityDataset = {
  entries: VnCompatibilityEntry[]
  notes: Record<string, string>
  prefixSetups: Record<string, VnCompatibilityPrefixSetup>
}

const compatibilityCache = new CacheStore<VnCompatibilityDataset>(
  'vnwiki-compatibility-v2',
  60 * 24
)

function getString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

function normalizeEngine(value: string): string {
  return normalize(value)
    .replace(/engine$/, '')
    .trim()
}

function getNoteIds(notes: string): string[] {
  return [...notes.matchAll(/\[(\d+)\]/g)].map((match) => match[1])
}

function normalizePrefix(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9]+/g, '')
}

export function parsePrefixSetups(
  guide: string
): Record<string, VnCompatibilityPrefixSetup> {
  const setups: Record<string, VnCompatibilityPrefixSetup> = {}
  const sectionPattern =
    /^#### (.+?) \((32|64)bit\)[\s\S]*?```bash\n([\s\S]*?)\n```/gm

  for (const match of guide.matchAll(sectionPattern)) {
    const prefix = normalizePrefix(match[1])
    const command = match[3].replace(/\n/g, ' ')
    const specialCodecs =
      command
        .match(/codec\.sh\s+([^&]+)/)?.[1]
        .trim()
        .split(/\s+/)
        .filter(Boolean) ?? []
    const winetricksCommand = command.match(/winetricks\s+([^&]+)/)?.[1]
    const winetricks = winetricksCommand
      ? winetricksCommand
          .trim()
          .split(/\s+/)
          .filter((part) => !part.startsWith('-'))
      : []

    setups[prefix] = {
      architecture: match[2] === '32' ? '32-bit' : '64-bit',
      specialCodecs,
      winetricks
    }
  }

  return setups
}

function parseDataset(
  records: unknown,
  notes: unknown
): VnCompatibilityDataset {
  if (!Array.isArray(records)) {
    throw new Error('VNWiki compatibility list is not an array')
  }

  const parsedNotes =
    notes && typeof notes === 'object'
      ? Object.fromEntries(
          Object.entries(notes).filter(
            (entry): entry is [string, string] => typeof entry[1] === 'string'
          )
        )
      : {}

  const entries = records.flatMap((record): VnCompatibilityEntry[] => {
    if (!record || typeof record !== 'object') {
      return []
    }

    const data = record as VnWikiRecord
    const title = getString(data['Visual Novel'])
    if (!title) {
      return []
    }

    return [
      {
        title,
        linux: getString(data.Linux),
        steamDeck: getString(data['Steam Deck']),
        engine: getString(data['Game engine']),
        winePrefix: getString(data.Wineprefix),
        wineVersion: getString(data['Wine version']),
        notes: getNoteIds(getString(data.Notes))
      }
    ]
  })

  return { entries, notes: parsedNotes, prefixSetups: {} }
}

async function getDataset(): Promise<VnCompatibilityDataset> {
  const cached = compatibilityCache.get('dataset')
  if (cached) {
    return cached
  }

  const [listResponse, notesResponse, prefixesResponse] = await Promise.all([
    fetch(compatibilityListUrl),
    fetch(compatibilityNotesUrl),
    fetch(winePrefixesGuideUrl)
  ])

  if (!listResponse.ok || !notesResponse.ok) {
    throw new Error(
      `Could not fetch VNWiki compatibility data (${listResponse.status}, ${notesResponse.status})`
    )
  }

  const dataset = parseDataset(
    await listResponse.json(),
    await notesResponse.json()
  )
  if (prefixesResponse.ok) {
    dataset.prefixSetups = parsePrefixSetups(await prefixesResponse.text())
  }
  compatibilityCache.set('dataset', dataset)
  return dataset
}

function withNotes(
  entry: VnCompatibilityEntry,
  notes: Record<string, string>
): VnCompatibilityEntry {
  return {
    ...entry,
    notes: entry.notes.map((note) => notes[note] ?? `Note ${note}`)
  }
}

function getPrefixSetups(
  entries: VnCompatibilityEntry[],
  prefixSetups: Record<string, VnCompatibilityPrefixSetup>
) {
  return Object.fromEntries(
    entries.flatMap((entry) => {
      const prefix = entry.winePrefix
      const setup = findPrefixSetup(prefix, prefixSetups)
      return prefix && setup ? [[prefix, setup]] : []
    })
  )
}

export function findPrefixSetup(
  recommendation: string,
  prefixSetups: Record<string, VnCompatibilityPrefixSetup>
): VnCompatibilityPrefixSetup | undefined {
  const normalizedRecommendation = normalizePrefix(recommendation)
  const exactMatch = prefixSetups[normalizedRecommendation]
  if (exactMatch) return exactMatch

  return Object.entries(prefixSetups)
    .filter(([prefix]) => normalizedRecommendation.includes(prefix))
    .sort(([left], [right]) => right.length - left.length)[0]?.[1]
}

export async function getVnCompatibility(
  titles: string[],
  engine?: string
): Promise<VnCompatibilityResult | null> {
  const dataset = await getDataset()
  const normalizedTitles = new Set(
    titles.map(normalize).filter((title) => title.length > 0)
  )
  const matchingTitles = dataset.entries.filter((entry) =>
    normalizedTitles.has(normalize(entry.title))
  )

  if (matchingTitles.length) {
    return {
      match: 'title',
      entries: matchingTitles.map((entry) => withNotes(entry, dataset.notes)),
      prefixSetups: getPrefixSetups(matchingTitles, dataset.prefixSetups)
    }
  }

  const normalizedEngine = normalizeEngine(engine ?? '')
  if (!normalizedEngine) {
    return null
  }

  const matchingEngine = dataset.entries.filter(
    (entry) => normalizeEngine(entry.engine) === normalizedEngine
  )
  if (!matchingEngine.length) {
    return null
  }

  return {
    match: 'engine',
    engine,
    entries: matchingEngine.map((entry) => withNotes(entry, dataset.notes)),
    prefixSetups: getPrefixSetups(matchingEngine, dataset.prefixSetups)
  }
}
