import type { Runner } from '../types'

export interface VnCompatibilityEntry {
  title: string
  linux: string
  steamDeck: string
  engine: string
  winePrefix: string
  wineVersion: string
  notes: string[]
}

export interface VnCompatibilityPrefixSetup {
  architecture: '32-bit' | '64-bit'
  specialCodecs: string[]
  winetricks: string[]
}

export interface VnCompatibilityPrefixRecipe extends VnCompatibilityPrefixSetup {
  name: string
}

export interface VnCompatibilityResult {
  match: 'title' | 'engine'
  engine?: string
  entries: VnCompatibilityEntry[]
  prefixSetups: Record<string, VnCompatibilityPrefixSetup>
}

export interface VnCompatibilityCodecProgress {
  appName: string
  runner: Runner
  messages: string[]
}

export interface VnCompatibilityCodecInstallArgs {
  appName: string
  runner: Runner
  codecs: string[]
}

export type VnCompatibilityCodecInstallResult =
  | { status: 'done' }
  | { status: 'error'; error: string }

export type VnCompatibilityPrefixCreateResult =
  | { status: 'done'; winePrefix: string }
  | { status: 'error'; error: string }

export interface VnCompatibilityPrefixCreateArgs {
  appName: string
  runner: Runner
  recipe?: VnCompatibilityPrefixRecipe
}
