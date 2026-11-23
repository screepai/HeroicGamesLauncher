import { app } from 'electron'
import { VndbClient } from 'vndb-kana-api'
import { GlobalConfig } from 'backend/config'
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecretValue
} from 'backend/utils/secureSecret'
import { notifyVndbApiTokenChanged } from './tokenEvents'

export const vndbClient = new VndbClient({
  userAgent: `HeroicGamesLauncher/${app.getVersion()}`
})

function readStoredApiToken(): string {
  const stored = GlobalConfig.get().getSettings().vndbApiToken
  return stored ?? ''
}

export function hasStoredApiToken(): boolean {
  return !!readStoredApiToken()
}

export function getDecryptedApiToken(): string {
  const stored = readStoredApiToken()
  if (!stored) return ''

  // Migrate legacy plaintext values on first read.
  if (!isEncryptedSecretValue(stored, 'vndb')) {
    const reEncrypted = encryptSecret(stored, 'vndb')
    if (isEncryptedSecretValue(reEncrypted, 'vndb')) {
      GlobalConfig.get().setSetting('vndbApiToken', reEncrypted)
    }
    return stored
  }

  return decryptSecret(stored, 'vndb')
}

// The client token only changes through setStoredApiToken, so the stored token
// is read once (lazily, on first use) instead of before every request.
let clientTokenLoaded = false

/**
 * Loads the stored token into the shared client. No-op after the first call
 * unless `force` is set; token changes go through setStoredApiToken.
 */
export function refreshVndbClientApiToken(options?: { force?: boolean }): void {
  if (clientTokenLoaded && !options?.force) {
    return
  }

  const token = getDecryptedApiToken()
  if (token) {
    vndbClient.setToken(token)
  } else {
    vndbClient.clearToken()
  }
  clientTokenLoaded = true
}

export function setStoredApiToken(token: string): void {
  const trimmed = token.trim()
  const stored = trimmed ? encryptSecret(trimmed, 'vndb') : ''
  GlobalConfig.get().setSetting('vndbApiToken', stored)

  if (trimmed) {
    vndbClient.setToken(trimmed)
  } else {
    vndbClient.clearToken()
  }
  clientTokenLoaded = true
  notifyVndbApiTokenChanged()
}
