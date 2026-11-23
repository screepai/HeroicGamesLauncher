import type { AuthInfo, UserLabelInfo } from 'vndb-kana-api'

import { vndbClient } from './client'
import { onVndbApiTokenChanged } from './tokenEvents'

export type PartialAuthInfo = Partial<AuthInfo> &
  Pick<AuthInfo, 'id' | 'username'>

export const vndbUserCacheTtlMs = 10 * 60 * 1000

interface CacheEntry<T> {
  promise: Promise<T>
  expiresAt: number
}

let authInfoEntry: CacheEntry<PartialAuthInfo> | undefined
let userLabelsEntry: CacheEntry<UserLabelInfo[]> | undefined

function getOrCreate<T>(
  entry: CacheEntry<T> | undefined,
  assign: (entry: CacheEntry<T> | undefined) => void,
  load: () => Promise<T>
): Promise<T> {
  if (entry && entry.expiresAt > Date.now()) {
    return entry.promise
  }

  const promise = load()
  const newEntry: CacheEntry<T> = {
    promise,
    expiresAt: Date.now() + vndbUserCacheTtlMs
  }
  assign(newEntry)
  // Never keep failed requests around: the next caller should retry.
  promise.catch(() => {
    if (newEntry.promise === promise) {
      newEntry.expiresAt = 0
    }
  })
  return promise
}

/** Auth info for the current token, cached for a short TTL. */
export function getCachedVndbAuthInfo(): Promise<PartialAuthInfo> {
  return getOrCreate(
    authInfoEntry,
    (entry) => {
      authInfoEntry = entry
    },
    async () => (await vndbClient.getAuthInfo()) as PartialAuthInfo
  )
}

/** The user's labels (with counts) for the current token, cached for a short TTL. */
export function getCachedVndbUserLabels(): Promise<UserLabelInfo[]> {
  return getOrCreate(
    userLabelsEntry,
    (entry) => {
      userLabelsEntry = entry
    },
    async () => (await vndbClient.getUserLabels(undefined, ['count'])).labels
  )
}

/** Labels carry list counts, so drop them whenever the user's list changes. */
export function invalidateVndbUserLabelsCache(): void {
  userLabelsEntry = undefined
}

export function clearVndbUserCache(): void {
  authInfoEntry = undefined
  userLabelsEntry = undefined
}

onVndbApiTokenChanged(clearVndbUserCache)
