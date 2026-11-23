import { tsStore } from 'backend/constants/key_value_stores'
import { logError, LogPrefix } from 'backend/logger'
import { stat } from 'fs/promises'
import { chunk } from 'vndb-kana-api'
import type { Filter, UserLabelInfo, UserListEntry } from 'vndb-kana-api'
import type {
  VndbGameMatch,
  VndbRelease,
  VndbUserDataSyncProgress,
  VndbUserDataSyncResult,
  VndbUserDataSyncTarget,
  VndbUserLabel,
  VndbUserOptions,
  VndbUserOptionsUpdate
} from 'common/types/vndb'
import { getVndbMatchKey } from 'common/vndb'

import {
  hasStoredApiToken,
  refreshVndbClientApiToken,
  vndbClient
} from './client'
import { getAllStoredMatches } from './matches'
import {
  bulkRequestCheckpoint,
  runUserInitiated,
  VndbJobCancelledError,
  waitForUserRequestsIdle
} from './priority'
import {
  getCachedVndbAuthInfo,
  getCachedVndbUserLabels,
  invalidateVndbUserLabelsCache
} from './userCache'
import type { PartialAuthInfo } from './userCache'
import {
  getVndbFeatureSettings,
  getVndbRequestErrorDetails,
  getVndbRequestErrorMessage
} from './shared'

const maxVndbIdsPerRequest = 100
const finishedLabelId = 2

function mapUserLabel(label: UserLabelInfo): VndbUserLabel {
  return {
    id: label.id,
    label: label.label,
    private: label.private,
    count: label.count
  }
}

function getEmptyUserOptions(hasToken: boolean): VndbUserOptions {
  return {
    hasToken,
    canRead: false,
    canWrite: false,
    labels: [],
    selectedLabelIds: [],
    vote: null
  }
}

function isValidDate(date: Date): boolean {
  return Number.isFinite(date.getTime())
}

function formatVndbDate(date: Date | undefined): string | undefined {
  if (!date || !isValidDate(date)) {
    return undefined
  }

  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')

  return `${year}-${month}-${day}`
}

function getUnixTimestampDate(timestamp: number | null | undefined) {
  if (typeof timestamp !== 'number') {
    return undefined
  }

  return new Date(timestamp * 1000)
}

function getStoredLastPlayedDate(appName: string) {
  const value = tsStore.get_nodefault(`${appName}.lastPlayed`)
  if (typeof value !== 'string' || !value) {
    return undefined
  }

  return new Date(value)
}

function getRecordedInstallDate(installedAt: string | undefined) {
  if (!installedAt) {
    return undefined
  }

  const date = new Date(installedAt)
  return isValidDate(date) ? date : undefined
}

async function getFilesystemInstallDate(installPath: string | undefined) {
  if (!installPath) {
    return undefined
  }

  try {
    const stats = await stat(installPath)
    return stats.birthtimeMs > 0 && isValidDate(stats.birthtime)
      ? stats.birthtime
      : undefined
  } catch {
    return undefined
  }
}

async function getInstallStartDate(target: VndbUserDataSyncTarget) {
  const recordedDate = getRecordedInstallDate(target.installedAt)
  if (recordedDate) {
    return { date: recordedDate, source: 'metadata' as const }
  }

  const filesystemDate = await getFilesystemInstallDate(target.installPath)
  return filesystemDate
    ? { date: filesystemDate, source: 'filesystem' as const }
    : undefined
}

function isDateAfter(left: string, right: string): boolean {
  return left.localeCompare(right) > 0
}

function getStoredMatchMainVisualNovelId(
  match: VndbGameMatch
): string | undefined {
  if (match.source !== 'release') {
    return match.vndbId.startsWith('v') ? match.vndbId : undefined
  }

  return (
    match.mainVndbId ??
    match.mainRelation?.id ??
    match.latestRelease?.vns[0]?.id ??
    match.releaseVns?.[0]?.id ??
    (match.vndbId.startsWith('v') ? match.vndbId : undefined)
  )
}

function getStoredMatchSelectedReleases(match: VndbGameMatch): VndbRelease[] {
  if (match.selectedReleases !== undefined) {
    return match.selectedReleases
  }

  if (match.latestRelease) {
    return [match.latestRelease]
  }

  return []
}

function getPermissions(authInfo: PartialAuthInfo) {
  const permissions = authInfo.permissions ?? []

  return {
    canRead: permissions.includes('listread'),
    canWrite: permissions.includes('listwrite')
  }
}

function getUserListEntry(
  entries: UserListEntry[],
  visualNovelId: string
): UserListEntry | undefined {
  return entries.find((entry) => entry.id === visualNovelId)
}

function getVisualNovelIdsFilter(visualNovelIds: string[]): Filter {
  if (visualNovelIds.length === 1) {
    return ['id', '=', visualNovelIds[0]]
  }

  return [
    'or',
    ...visualNovelIds.map((visualNovelId): Filter => ['id', '=', visualNovelId])
  ]
}

async function getUserListEntriesForSync(
  userId: string,
  visualNovelIds: string[],
  signal?: AbortSignal
): Promise<{
  entries: Map<string, UserListEntry>
  errors: Map<string, string>
}> {
  const entries = new Map<string, UserListEntry>()
  const errors = new Map<string, string>()
  const uniqueIds = [...new Set(visualNovelIds)]

  for (const visualNovelIdChunk of chunk(uniqueIds, maxVndbIdsPerRequest)) {
    await waitForUserRequestsIdle()
    if (signal?.aborted) {
      break
    }

    try {
      const response = await vndbClient.getUserList({
        user: userId,
        filters: getVisualNovelIdsFilter(visualNovelIdChunk),
        fields:
          'id,voted,started,finished,labels{id,label},releases{id,list_status}',
        results: visualNovelIdChunk.length
      })

      for (const entry of response.results) {
        entries.set(entry.id, entry)
      }
    } catch (error) {
      const message = getVndbRequestErrorMessage(error)
      for (const visualNovelId of visualNovelIdChunk) {
        errors.set(visualNovelId, message)
      }
    }
  }

  return { entries, errors }
}

interface UserListSyncState {
  voted: number | null
  started: string | null
  finished: string | null
  labels: UserListEntry['labels']
}

function getChangedUserListSyncUpdate(
  update: VndbUserOptionsUpdate,
  state: UserListSyncState | undefined
): VndbUserOptionsUpdate {
  const changedUpdate: VndbUserOptionsUpdate = {}

  if (update.started !== undefined && update.started !== state?.started) {
    changedUpdate.started = update.started
  }
  if (update.finished !== undefined && update.finished !== state?.finished) {
    changedUpdate.finished = update.finished
  }

  return changedUpdate
}

function applyUserListSyncUpdate(
  state: UserListSyncState | undefined,
  update: VndbUserOptionsUpdate
): UserListSyncState {
  return {
    voted: state?.voted ?? null,
    started:
      update.started !== undefined ? update.started : (state?.started ?? null),
    finished:
      update.finished !== undefined
        ? update.finished
        : (state?.finished ?? null),
    labels: state?.labels ?? []
  }
}

function normalizeUserOptionsUpdate(
  update: VndbUserOptionsUpdate
): VndbUserOptionsUpdate {
  const normalizedUpdate: VndbUserOptionsUpdate = {}

  if (update.labels !== undefined) {
    normalizedUpdate.labels = update.labels
      .filter((labelId) => labelId !== 0 && labelId !== 7)
      .sort((left, right) => left - right)
  }

  if (update.vote !== undefined) {
    normalizedUpdate.vote = update.vote
  }

  if (update.started !== undefined) {
    normalizedUpdate.started =
      typeof update.started === 'string'
        ? update.started.trim() || null
        : update.started
  }

  if (update.finished !== undefined) {
    normalizedUpdate.finished = update.finished
  } else if (normalizedUpdate.labels?.includes(finishedLabelId)) {
    normalizedUpdate.finished = formatVndbDate(new Date())
  }

  return normalizedUpdate
}

async function getVndbUserOptionsInternal(
  visualNovelId: string
): Promise<VndbUserOptions> {
  if (!getVndbFeatureSettings().enableVndbIntegration) {
    return getEmptyUserOptions(false)
  }

  refreshVndbClientApiToken()

  if (!hasStoredApiToken()) {
    return getEmptyUserOptions(false)
  }

  const authInfo = await getCachedVndbAuthInfo()
  const { canRead, canWrite } = getPermissions(authInfo)

  if (!canRead) {
    return {
      ...getEmptyUserOptions(true),
      username: authInfo.username,
      canWrite
    }
  }

  const [labels, userListResponse] = await Promise.all([
    getCachedVndbUserLabels(),
    vndbClient.getUserList({
      user: authInfo.id,
      filters: ['id', '=', visualNovelId],
      fields: 'id,vote,voted,started,finished,labels{id,label}',
      results: 1
    })
  ])
  const userListEntry = getUserListEntry(
    userListResponse.results,
    visualNovelId
  )

  return {
    hasToken: true,
    username: authInfo.username,
    canRead,
    canWrite,
    labels: labels.map(mapUserLabel),
    selectedLabelIds:
      userListEntry?.labels.map((label) => label.id).filter((id) => id !== 7) ??
      [],
    vote: userListEntry?.vote ?? null,
    started: userListEntry?.started ?? null,
    finished: userListEntry?.finished ?? null,
    voted: userListEntry?.voted ?? null
  }
}

async function updateVndbUserOptionsInternal(
  visualNovelId: string,
  update: VndbUserOptionsUpdate
): Promise<VndbUserOptions> {
  const settings = getVndbFeatureSettings()
  if (!settings.enableVndbIntegration) {
    return getEmptyUserOptions(false)
  }

  refreshVndbClientApiToken()

  if (!hasStoredApiToken()) {
    return getEmptyUserOptions(false)
  }

  const normalizedUpdate = normalizeUserOptionsUpdate(update)

  if (!Object.keys(normalizedUpdate).length) {
    return getVndbUserOptionsInternal(visualNovelId)
  }

  try {
    await vndbClient.updateUserListEntry(visualNovelId, normalizedUpdate)
    invalidateVndbUserLabelsCache()
  } catch (error) {
    const message = getVndbRequestErrorMessage(error)
    logError(
      [
        'VNDB user options update failed:',
        {
          visualNovelId,
          update: normalizedUpdate,
          error: getVndbRequestErrorDetails(error)
        }
      ],
      LogPrefix.Backend
    )
    throw new Error(
      `Unable to update VNDB user options for ${visualNovelId}: ${message}`
    )
  }

  return getVndbUserOptionsInternal(visualNovelId)
}

async function updateVndbUserReleaseInternal(
  releaseId: string,
  selected: boolean
): Promise<void> {
  const settings = getVndbFeatureSettings()
  if (!settings.enableVndbIntegration || !settings.syncVndbUserData) {
    return
  }

  refreshVndbClientApiToken()

  if (!hasStoredApiToken()) {
    throw new Error('VNDB API token is not configured')
  }

  if (selected) {
    await vndbClient.updateUserReleaseEntry(releaseId, { status: 2 })
  } else {
    await vndbClient.deleteUserReleaseEntry(releaseId)
  }
}

export function getVndbUserOptions(
  visualNovelId: string
): Promise<VndbUserOptions> {
  return runUserInitiated(() => getVndbUserOptionsInternal(visualNovelId))
}

export function updateVndbUserOptions(
  visualNovelId: string,
  update: VndbUserOptionsUpdate
): Promise<VndbUserOptions> {
  return runUserInitiated(() =>
    updateVndbUserOptionsInternal(visualNovelId, update)
  )
}

export function updateVndbUserRelease(
  releaseId: string,
  selected: boolean
): Promise<void> {
  return runUserInitiated(() =>
    updateVndbUserReleaseInternal(releaseId, selected)
  )
}

export interface VndbUserDataSyncOptions {
  signal?: AbortSignal
  onProgress?: (progress: VndbUserDataSyncProgress) => void
}

export async function syncVndbUserData(
  targets: VndbUserDataSyncTarget[],
  options: VndbUserDataSyncOptions = {}
): Promise<VndbUserDataSyncResult> {
  const { signal, onProgress } = options
  const settings = getVndbFeatureSettings()
  if (!settings.enableVndbIntegration || !settings.syncVndbUserData) {
    return {
      hasToken: false,
      canWrite: false,
      synced: 0,
      skipped: targets.length,
      errors: []
    }
  }

  refreshVndbClientApiToken()

  if (!hasStoredApiToken()) {
    return {
      hasToken: false,
      canWrite: false,
      synced: 0,
      skipped: targets.length,
      errors: []
    }
  }

  const authInfo = await getCachedVndbAuthInfo()
  const { canRead, canWrite } = getPermissions(authInfo)
  const result: VndbUserDataSyncResult = {
    hasToken: true,
    canWrite,
    synced: 0,
    skipped: 0,
    errors: []
  }

  if (!canWrite) {
    return {
      ...result,
      skipped: targets.length
    }
  }

  const storedMatches = getAllStoredMatches()
  const targetMatches = targets.map((target) => {
    const match = storedMatches[getVndbMatchKey(target)]
    return {
      match,
      visualNovelId: match ? getStoredMatchMainVisualNovelId(match) : undefined
    }
  })
  const { entries: userListEntries, errors: userListReadErrors } = canRead
    ? await getUserListEntriesForSync(
        authInfo.id,
        targetMatches.flatMap(({ visualNovelId }) =>
          visualNovelId ? [visualNovelId] : []
        ),
        signal
      )
    : {
        entries: new Map<string, UserListEntry>(),
        errors: new Map<string, string>()
      }
  const userListStates = new Map<string, UserListSyncState>(
    [...userListEntries].map(([visualNovelId, entry]) => [
      visualNovelId,
      {
        voted: entry.voted,
        started: entry.started,
        finished: entry.finished,
        labels: entry.labels
      }
    ])
  )
  const releaseStatuses = new Map<string, number>(
    [...userListEntries.values()].flatMap((entry) =>
      entry.releases.map(
        (release) => [release.id, release.list_status] as const
      )
    )
  )

  let completed = 0
  let cancelled = false
  let wroteUserList = false
  const reportProgress = (appName: string) => {
    completed += 1
    onProgress?.({
      completed,
      total: targets.length,
      appName,
      synced: result.synced,
      skipped: result.skipped,
      errors: result.errors.length
    })
  }

  for (const [targetIndex, target] of targets.entries()) {
    const { match, visualNovelId } = targetMatches[targetIndex]

    await waitForUserRequestsIdle()
    if (signal?.aborted) {
      cancelled = true
      break
    }

    if (!match || !visualNovelId) {
      result.skipped += 1
      reportProgress(target.appName)
      continue
    }

    const userListReadError = userListReadErrors.get(visualNovelId)
    if (userListReadError) {
      result.errors.push({
        appName: target.appName,
        message: userListReadError
      })
      reportProgress(target.appName)
      continue
    }

    try {
      const userListState = userListStates.get(visualNovelId)
      const hasFinishedLabel =
        userListState?.labels.some((label) => label.id === finishedLabelId) ??
        false
      const finished = hasFinishedLabel
        ? formatVndbDate(
            getUnixTimestampDate(userListState?.voted) ??
              getStoredLastPlayedDate(target.appName)
          )
        : undefined
      const effectiveFinished = finished ?? userListState?.finished ?? undefined
      const installStart =
        target.runner === 'sideload'
          ? await getInstallStartDate(target)
          : undefined
      const recordedStarted = formatVndbDate(installStart?.date)
      const update: VndbUserOptionsUpdate = {}

      if (recordedStarted) {
        const filesystemStartAfterVoteDate =
          installStart?.source === 'filesystem' &&
          finished !== undefined &&
          isDateAfter(recordedStarted, finished)

        if (
          !filesystemStartAfterVoteDate &&
          (!effectiveFinished ||
            !isDateAfter(recordedStarted, effectiveFinished))
        ) {
          update.started = recordedStarted
        }
      }

      if (finished) {
        update.finished = finished
      }

      const selectedReleases = getStoredMatchSelectedReleases(match)

      const normalizedUpdate = normalizeUserOptionsUpdate(update)
      const changedUpdate = canRead
        ? getChangedUserListSyncUpdate(normalizedUpdate, userListState)
        : normalizedUpdate
      if (Object.keys(changedUpdate).length) {
        await bulkRequestCheckpoint(signal)
        await vndbClient.updateUserListEntry(visualNovelId, changedUpdate)
        wroteUserList = true
        if (canRead) {
          userListStates.set(
            visualNovelId,
            applyUserListSyncUpdate(userListState, changedUpdate)
          )
        }
      }

      if (target.includeReleases !== false) {
        for (const release of selectedReleases) {
          if (releaseStatuses.get(release.id) === 2) {
            continue
          }

          await bulkRequestCheckpoint(signal)
          await vndbClient.updateUserReleaseEntry(release.id, { status: 2 })
          releaseStatuses.set(release.id, 2)
        }
      }

      result.synced += 1
    } catch (error) {
      if (error instanceof VndbJobCancelledError) {
        cancelled = true
        break
      }

      result.errors.push({
        appName: target.appName,
        message: getVndbRequestErrorMessage(error)
      })
    }

    reportProgress(target.appName)
  }

  if (wroteUserList) {
    // Label counts change when entries are created or updated.
    invalidateVndbUserLabelsCache()
  }

  if (cancelled) {
    result.skipped += targets.length - completed
    result.cancelled = true
  }

  return result
}
