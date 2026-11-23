jest.mock('backend/cache', () => ({
  __esModule: true,
  default: class {
    private readonly values = new Map<string, unknown>()

    get(key: string) {
      return this.values.get(key)
    }

    set(key: string, value: unknown) {
      this.values.set(key, value)
    }
  }
}))

type VnCompatibilityModule = typeof import('..')

const fetchMock = jest.fn<Promise<unknown>, [string, RequestInit?]>()
const originalFetch = global.fetch

beforeAll(() => {
  global.fetch = fetchMock as unknown as typeof fetch
})

afterAll(() => {
  global.fetch = originalFetch
})

beforeEach(() => {
  fetchMock.mockReset()
  jest.restoreAllMocks()
})

// Every test gets a fresh module so the in-flight request and the cache of
// the previous test do not leak into it.
async function loadModule(): Promise<VnCompatibilityModule> {
  let loaded: VnCompatibilityModule | undefined
  await jest.isolateModulesAsync(async () => {
    loaded = await import('..')
  })
  return loaded as VnCompatibilityModule
}

function jsonResponse(body: unknown) {
  return {
    ok: true,
    status: 200,
    json: () => Promise.resolve(body),
    text: () => Promise.resolve('')
  }
}

function respondTo(url: string) {
  if (url.endsWith('vn_list.json')) {
    return jsonResponse([
      {
        'Visual Novel': 'Test VN',
        Linux: '✅',
        'Steam Deck': '✅',
        'Game engine': 'Ren’Py',
        Wineprefix: '',
        'Wine version': '',
        Notes: ''
      }
    ])
  }
  if (url.endsWith('vn_list_notes.json')) {
    return jsonResponse({})
  }
  return jsonResponse({})
}

describe('VNWiki dataset download', () => {
  it('shares one download between concurrent callers', async () => {
    const { getVnCompatibility } = await loadModule()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    fetchMock.mockImplementation(async (url) => {
      await gate
      return respondTo(url)
    })

    const lookups = [
      getVnCompatibility(['Test VN']),
      getVnCompatibility(['Test VN']),
      getVnCompatibility(['Test VN'])
    ]
    release()
    const results = await Promise.all(lookups)

    expect(results.every((result) => result?.match === 'title')).toBe(true)
    // list + notes + prefix guide, downloaded once for all three callers
    expect(fetchMock).toHaveBeenCalledTimes(3)

    await getVnCompatibility(['Test VN'])
    expect(fetchMock).toHaveBeenCalledTimes(3)
  })

  it('aborts downloads that exceed the timeout and allows a retry', async () => {
    const { getVnCompatibility } = await loadModule()
    const timeoutSpy = jest
      .spyOn(AbortSignal, 'timeout')
      .mockImplementation(() => {
        const controller = new AbortController()
        setTimeout(
          () =>
            controller.abort(
              new DOMException('The operation timed out', 'TimeoutError')
            ),
          10
        )
        return controller.signal
      })
    // A server that never answers; only the abort signal ends the request
    fetchMock.mockImplementation(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(init.signal?.reason as Error)
          )
        })
    )

    await expect(getVnCompatibility(['Test VN'])).rejects.toMatchObject({
      name: 'TimeoutError'
    })
    expect(timeoutSpy).toHaveBeenCalledTimes(3)
    timeoutSpy.mock.calls.forEach(([milliseconds]) =>
      expect(milliseconds).toBeGreaterThan(0)
    )

    // The failed request must not stay cached as the in-flight one
    timeoutSpy.mockRestore()
    fetchMock.mockReset()
    fetchMock.mockImplementation((url) => Promise.resolve(respondTo(url)))
    await expect(getVnCompatibility(['Test VN'])).resolves.toMatchObject({
      match: 'title'
    })
  })

  it('still returns the dataset when only the prefix guide fails', async () => {
    const { getVnCompatibility } = await loadModule()
    fetchMock.mockImplementation((url) =>
      url.endsWith('.md')
        ? Promise.reject(new Error('guide unavailable'))
        : Promise.resolve(respondTo(url))
    )

    await expect(getVnCompatibility(['Test VN'])).resolves.toMatchObject({
      match: 'title',
      prefixSetups: {}
    })
  })
})
