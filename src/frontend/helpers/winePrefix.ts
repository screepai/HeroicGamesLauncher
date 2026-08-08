import { configStore } from './electronStores'

const userHome = configStore.get('userHome', '')

function normalizeWinePrefix(path: string): string {
  const normalized = path.trim().replace(/^~(?=\/|$)/, userHome)
  return normalized.replace(/\/+$/, '') || '/'
}

export function isDefaultWinePrefix(
  winePrefix: string,
  configuredPrefixes: string[]
): boolean {
  const normalizedPrefix = normalizeWinePrefix(winePrefix)
  return configuredPrefixes.some(
    (prefix) =>
      Boolean(prefix) && normalizeWinePrefix(prefix) === normalizedPrefix
  )
}
