/**
 * The VNDB client shares one rate-limited queue. Bulk jobs (user-data sync,
 * bulk matching) call `waitForUserRequestsIdle()` before each request so
 * user-initiated calls (opening a game, editing labels, searching) always go
 * first.
 */
let activeUserRequests = 0
let idleWaiters: Array<() => void> = []

export async function runUserInitiated<T>(task: () => Promise<T>): Promise<T> {
  activeUserRequests += 1
  try {
    return await task()
  } finally {
    activeUserRequests -= 1
    if (activeUserRequests === 0) {
      const waiters = idleWaiters
      idleWaiters = []
      waiters.forEach((resolve) => resolve())
    }
  }
}

export function waitForUserRequestsIdle(): Promise<void> {
  if (activeUserRequests === 0) {
    return Promise.resolve()
  }

  return new Promise((resolve) => {
    idleWaiters.push(resolve)
  })
}

export class VndbJobCancelledError extends Error {
  constructor() {
    super('VNDB job cancelled')
    this.name = 'VndbJobCancelledError'
  }
}

/** Bulk-job checkpoint: yields to user requests and honours cancellation. */
export async function bulkRequestCheckpoint(
  signal: AbortSignal | undefined
): Promise<void> {
  await waitForUserRequestsIdle()
  if (signal?.aborted) {
    throw new VndbJobCancelledError()
  }
}
