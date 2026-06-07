import { safeStorage } from 'electron'
import { logWarning, LogPrefix } from 'backend/logger'

type SecretService = 'steamgriddb' | 'vndb'

const SECRET_CONFIG: Record<
  SecretService,
  {
    label: string
    prefix: string
  }
> = {
  steamgriddb: {
    label: 'SteamGridDB API key',
    prefix: 'sgdb:v1:'
  },
  vndb: {
    label: 'VNDB API token',
    prefix: 'vndb:v1:'
  }
}

function encryptionAvailable(): boolean {
  try {
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function isEncryptedSecretValue(
  stored: string,
  service: SecretService
): boolean {
  return stored.startsWith(SECRET_CONFIG[service].prefix)
}

export function encryptSecret(plain: string, service: SecretService): string {
  if (!plain) return ''
  const { label, prefix } = SECRET_CONFIG[service]

  if (!encryptionAvailable()) {
    logWarning(
      `safeStorage unavailable, storing ${label} in plaintext`,
      LogPrefix.Backend
    )
    return plain
  }

  const ciphertext = safeStorage.encryptString(plain).toString('base64')
  return `${prefix}${ciphertext}`
}

export function decryptSecret(stored: string, service: SecretService): string {
  if (!stored) return ''
  const { label, prefix } = SECRET_CONFIG[service]

  if (!isEncryptedSecretValue(stored, service)) {
    // Legacy plaintext from before encryption was introduced.
    return stored
  }

  if (!encryptionAvailable()) return ''

  try {
    const buf = Buffer.from(stored.slice(prefix.length), 'base64')
    return safeStorage.decryptString(buf)
  } catch (error) {
    logWarning([`Failed to decrypt ${label}:`, error], LogPrefix.Backend)
    return ''
  }
}
