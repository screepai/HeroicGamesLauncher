import { configStore } from 'backend/constants/key_value_stores'
import { isVndbError } from 'vndb-kana-api'
import type { AppSettings } from 'common/types'

export function getVndbFeatureSettings() {
  const settings =
    (configStore.get_nodefault('settings') as
      | Partial<AppSettings>
      | undefined) ?? {}
  return {
    enableVndbIntegration: settings.enableVndbIntegration ?? true,
    syncVndbUserData: settings.syncVndbUserData ?? true
  }
}

export function getVndbRequestErrorMessage(error: unknown): string {
  if (!isVndbError(error)) {
    return error instanceof Error ? error.message : String(error)
  }

  const status = error.status ? `HTTP ${error.status}` : undefined

  if (typeof error.response === 'string' && error.response.trim()) {
    return [status, error.response.trim()].filter(Boolean).join(': ')
  }

  if (
    typeof error.response === 'object' &&
    error.response !== null &&
    'message' in error.response &&
    typeof error.response.message === 'string'
  ) {
    return [status, error.response.message].filter(Boolean).join(': ')
  }

  if (error.response !== undefined) {
    try {
      return [status, JSON.stringify(error.response)].filter(Boolean).join(': ')
    } catch {
      // Fall back to the error message when the response is not serializable.
    }
  }

  return [status, error.message].filter(Boolean).join(': ')
}

export function getVndbRequestErrorDetails(error: unknown) {
  if (!isVndbError(error)) {
    return {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined
    }
  }

  return {
    name: error.name,
    message: error.message,
    status: error.status,
    code: error.code,
    response: error.response,
    stack: error.stack
  }
}
