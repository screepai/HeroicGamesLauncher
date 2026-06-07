import {
  decryptSecret,
  encryptSecret,
  isEncryptedSecretValue
} from 'backend/utils/secureSecret'

export function isEncryptedValue(stored: string): boolean {
  return isEncryptedSecretValue(stored, 'steamgriddb')
}

export function encryptApiKey(plain: string): string {
  return encryptSecret(plain, 'steamgriddb')
}

export function decryptApiKey(stored: string): string {
  return decryptSecret(stored, 'steamgriddb')
}
