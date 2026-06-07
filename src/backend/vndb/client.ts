import { app } from 'electron'
import { VndbClient } from 'vndb-kana-api'
import { GlobalConfig } from 'backend/config'
import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecretValue
} from 'backend/utils/secureSecret'

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

export function refreshVndbClientApiToken(): void {
  const token = getDecryptedApiToken()
  if (token) {
    vndbClient.setToken(token)
  } else {
    vndbClient.clearToken()
  }
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
}
