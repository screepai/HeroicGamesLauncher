import { addHandler, sendFrontendMessage } from 'backend/ipc'
import { randomUUID } from 'crypto'
import { hasStoredApiToken, setStoredApiToken } from './client'
import {
  getAllVndbGameMatches,
  getVndbUserOptions,
  getVndbGameMatch,
  hydrateVndbMatch,
  matchVndbGames,
  searchVndbVisualNovels,
  syncVndbGameMatches,
  syncVndbUserData,
  updateVndbUserRelease,
  updateVndbUserOptions
} from '.'

const matchGamesJobs = new Map<string, AbortController>()
const syncUserDataJobs = new Map<string, AbortController>()

async function runCancellableJob<T>(
  jobs: Map<string, AbortController>,
  jobId: string | undefined,
  run: (jobId: string | undefined, signal: AbortSignal) => Promise<T>
): Promise<T> {
  const trackingId = jobId ?? randomUUID()
  const controller = new AbortController()
  jobs.set(trackingId, controller)
  try {
    return await run(jobId, controller.signal)
  } finally {
    if (jobs.get(trackingId) === controller) {
      jobs.delete(trackingId)
    }
  }
}

/** Aborts the given job (or every running job when no id is given). */
function cancelJobs(
  jobs: Map<string, AbortController>,
  jobId?: string
): boolean {
  const controllers =
    jobId !== undefined
      ? [jobs.get(jobId)].filter((controller) => controller !== undefined)
      : [...jobs.values()]
  controllers.forEach((controller) => controller.abort())
  return controllers.length > 0
}

addHandler('vndb.hasApiToken', () => hasStoredApiToken())

addHandler('vndb.setApiToken', (_event, token) => {
  setStoredApiToken(token)
})

addHandler('vndb.searchVisualNovels', async (_event, args) =>
  searchVndbVisualNovels(args.query, args.limit)
)

addHandler('vndb.matchGames', async (_event, games, options) =>
  runCancellableJob(matchGamesJobs, options?.jobId, (jobId, signal) =>
    matchVndbGames(games, {
      signal,
      onProgress: (progress) =>
        sendFrontendMessage('vndbMatchGamesProgress', { jobId, ...progress })
    })
  )
)

addHandler('vndb.cancelMatchGames', (_event, jobId) =>
  cancelJobs(matchGamesJobs, jobId)
)

addHandler('vndb.syncGameMatches', (_event, updates) =>
  syncVndbGameMatches(updates)
)

addHandler('vndb.getGameMatch', (_event, args) =>
  getVndbGameMatch(args.appName, args.runner)
)

addHandler('vndb.hydrateMatch', (_event, args) =>
  hydrateVndbMatch(args.appName, args.runner)
)

addHandler('vndb.getAllGameMatches', () => getAllVndbGameMatches())

addHandler('vndb.getUserOptions', (_event, args) =>
  getVndbUserOptions(args.vnId)
)

addHandler('vndb.updateUserOptions', (_event, args) =>
  updateVndbUserOptions(args.vnId, args.update)
)

addHandler('vndb.updateUserRelease', (_event, args) =>
  updateVndbUserRelease(args.releaseId, args.selected)
)

addHandler('vndb.syncUserData', (_event, targets, options) =>
  runCancellableJob(syncUserDataJobs, options?.jobId, (jobId, signal) =>
    syncVndbUserData(targets, {
      signal,
      onProgress: (progress) =>
        sendFrontendMessage('vndbSyncUserDataProgress', {
          jobId,
          ...progress
        })
    })
  )
)

addHandler('vndb.cancelSyncUserData', (_event, jobId) =>
  cancelJobs(syncUserDataJobs, jobId)
)
