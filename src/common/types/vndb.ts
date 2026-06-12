import type { Runner } from '../types'

export type VndbSearchResultSource = 'visualNovel' | 'release'

export interface VndbSearchResult {
  id: string
  title: string
  aliases?: string[]
  source: VndbSearchResultSource
  imageUrl?: string
  released?: string | null
  average?: number | null
  rating?: number | null
  votecount?: number
  length?: number | null
  lengthMinutes?: number | null
  lengthVotes?: number
  description?: string | null
  tags?: VndbTag[]
  developers: string[]
  languages: string[]
  platforms: string[]
  relations: VndbRelation[]
  mainRelation?: VndbRelation
  latestRelease?: VndbRelease
  selectedReleases?: VndbRelease[]
  releases?: VndbRelease[]
  releaseVns?: VndbReleaseVisualNovel[]
}

export interface VndbTag {
  id: string
  name: string
  category: string
  rating: number
  spoiler: number
  lie: boolean
}

export interface VndbRelation {
  id: string
  title: string
  relation: string
  relationLabel: string
  relationOfficial: boolean
  imageUrl?: string
  released?: string | null
}

export interface VndbReleaseVisualNovel {
  id: string
  title: string
  aliases?: string[]
  rtype?: string
  imageUrl?: string
  released?: string | null
  relations: VndbRelation[]
  mainRelation?: VndbRelation
}

export interface VndbRelease {
  id: string
  title: string
  imageUrl?: string
  released?: string | null
  official?: boolean
  patch?: boolean
  freeware?: boolean
  languages: string[]
  languageTitles?: VndbReleaseLanguageTitle[]
  platforms: string[]
  vns: VndbReleaseVisualNovel[]
}

export interface VndbReleaseLanguageTitle {
  lang: string
  title?: string | null
  latin?: string | null
  main?: boolean
  mtl?: boolean
}

export interface VndbGameMatchTarget {
  appName: string
  runner: Runner
  title: string
}

export interface VndbGameMatchSuggestion {
  game: VndbGameMatchTarget
  result: VndbSearchResult | null
}

export interface VndbGameMatch {
  appName: string
  runner: Runner
  title: string
  vndbId: string
  vndbTitle: string
  aliases?: string[]
  source?: VndbSearchResultSource
  imageUrl?: string
  released?: string | null
  average?: number | null
  rating?: number | null
  votecount?: number
  length?: number | null
  lengthMinutes?: number | null
  lengthVotes?: number
  description?: string | null
  tags?: VndbTag[]
  developers?: string[]
  languages?: string[]
  mainVndbId?: string
  mainVndbTitle?: string
  mainRelation?: VndbRelation
  relations?: VndbRelation[]
  latestRelease?: VndbRelease
  selectedReleases?: VndbRelease[]
  releases?: VndbRelease[]
  releaseVns?: VndbReleaseVisualNovel[]
  syncedAt: string
}

export interface VndbUserLabel {
  id: number
  label: string
  private?: boolean
  count?: number
}

export interface VndbUserOptions {
  hasToken: boolean
  canRead: boolean
  canWrite: boolean
  username?: string
  labels: VndbUserLabel[]
  selectedLabelIds: number[]
  vote: number | null
  started?: string | null
  finished?: string | null
  voted?: number | null
}

export interface VndbUserOptionsUpdate {
  labels?: number[]
  vote?: number | null
  started?: string | null
  finished?: string | null
}

export interface VndbUserDataSyncTarget {
  appName: string
  runner: Runner
  installedAt?: string
  includeReleases?: boolean
}

export interface VndbUserDataSyncResult {
  hasToken: boolean
  canWrite: boolean
  synced: number
  skipped: number
  errors: Array<{
    appName: string
    message: string
  }>
}

export interface VndbGameMatchUpdate {
  appName: string
  runner: Runner
  title: string
  vndbId: string | null
  vndbTitle?: string
  aliases?: string[]
  source?: VndbSearchResultSource
  imageUrl?: string
  released?: string | null
  average?: number | null
  rating?: number | null
  votecount?: number
  length?: number | null
  lengthMinutes?: number | null
  lengthVotes?: number
  description?: string | null
  tags?: VndbTag[]
  developers?: string[]
  languages?: string[]
  mainRelation?: VndbRelation
  relations?: VndbRelation[]
  latestRelease?: VndbRelease
  selectedReleases?: VndbRelease[]
  releases?: VndbRelease[]
  releaseVns?: VndbReleaseVisualNovel[]
}
