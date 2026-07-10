export type VnCompatibilityStatus = string

export interface VnCompatibilityEntry {
  title: string
  linux: VnCompatibilityStatus
  steamDeck: VnCompatibilityStatus
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

export interface VnCompatibilityResult {
  match: 'title' | 'engine'
  engine?: string
  entries: VnCompatibilityEntry[]
  prefixSetups: Record<string, VnCompatibilityPrefixSetup>
}
