import type { Runner } from '../types'

export type VndbSearchResultSource = 'visualNovel' | 'release'

export interface VndbSearchResult {
  id: string
  title: string
  source: VndbSearchResultSource
  imageUrl?: string
  released?: string | null
  rating?: number | null
  votecount?: number
  lengthMinutes?: number | null
  description?: string | null
  developers: string[]
  languages: string[]
  platforms: string[]
  relations: VndbRelation[]
  mainRelation?: VndbRelation
  latestRelease?: VndbRelease
  releases?: VndbRelease[]
  releaseVns?: VndbReleaseVisualNovel[]
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
  source?: VndbSearchResultSource
  imageUrl?: string
  released?: string | null
  developers?: string[]
  languages?: string[]
  mainVndbId?: string
  mainVndbTitle?: string
  mainRelation?: VndbRelation
  relations?: VndbRelation[]
  latestRelease?: VndbRelease
  releases?: VndbRelease[]
  releaseVns?: VndbReleaseVisualNovel[]
  syncedAt: string
}

export interface VndbGameMatchUpdate {
  appName: string
  runner: Runner
  title: string
  vndbId: string | null
  vndbTitle?: string
  source?: VndbSearchResultSource
  imageUrl?: string
  released?: string | null
  developers?: string[]
  languages?: string[]
  mainRelation?: VndbRelation
  relations?: VndbRelation[]
  latestRelease?: VndbRelease
  releases?: VndbRelease[]
  releaseVns?: VndbReleaseVisualNovel[]
}
