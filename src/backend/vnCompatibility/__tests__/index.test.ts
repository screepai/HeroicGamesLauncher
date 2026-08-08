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

import { findPrefixSetup, getVnCompatibility, parsePrefixSetups } from '..'

const fetchMock = jest.fn()
const originalFetch = global.fetch

beforeAll(() => {
  global.fetch = fetchMock as typeof fetch
})

afterAll(() => {
  global.fetch = originalFetch
})

beforeEach(() => {
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () =>
      Promise.resolve([
        {
          'Visual Novel': 'DRACU-RIOT!',
          Linux: '✅',
          'Steam Deck': '✅',
          'Game engine': 'KiriKiri Engine',
          Wineprefix: 'wmp11quartz',
          'Wine version': 'Proton 7+',
          Notes: '[1]'
        },
        {
          'Visual Novel': 'Riddle Joker',
          Linux: '✅',
          'Steam Deck': '✅',
          'Game engine': 'KiriKiri',
          Wineprefix: 'wmp11',
          'Wine version': 'Proton GE 8.8+',
          Notes: ''
        }
      ])
  })
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    json: () => Promise.resolve({ 1: 'Disable Esync' })
  })
  fetchMock.mockResolvedValueOnce({
    ok: true,
    status: 200,
    text: () =>
      Promise.resolve(`#### wmp11quartz (64bit)
\`\`\`bash
sh ~/Documents/vn_winestuff-main/codec.sh wmp11 quartz2
\`\`\``)
  })
})

describe('getVnCompatibility', () => {
  it('uses a normalized exact title before considering an engine', async () => {
    await expect(
      getVnCompatibility(['DRACU RIOT'], 'KiriKiri')
    ).resolves.toEqual({
      match: 'title',
      entries: [
        expect.objectContaining({
          title: 'DRACU-RIOT!',
          notes: ['Disable Esync']
        })
      ],
      prefixSetups: {
        wmp11quartz: {
          architecture: '64-bit',
          specialCodecs: ['wmp11', 'quartz2'],
          winetricks: []
        }
      }
    })
  })

  it('returns same-engine entries only when no title matches', async () => {
    const result = await getVnCompatibility(['Unknown title'], 'kirikiri')

    expect(result).toMatchObject({
      match: 'engine',
      engine: 'kirikiri'
    })
    expect(result?.entries.map((entry) => entry.title)).toEqual([
      'DRACU-RIOT!',
      'Riddle Joker'
    ])
  })

  it('extracts Special Codecs and Winetricks components from the prefix guide', () => {
    expect(
      parsePrefixSetups(`#### xact (64bit)
\`\`\`bash
winetricks -q --force xact
\`\`\`

#### wmp10quartz (32bit)
\`\`\`bash
winetricks -q --force wmp10 && sh ~/Documents/vn_winestuff-main/codec.sh quartz2
\`\`\``)
    ).toEqual({
      xact: {
        architecture: '64-bit',
        specialCodecs: [],
        winetricks: ['xact']
      },
      wmp10quartz: {
        architecture: '32-bit',
        specialCodecs: ['quartz2'],
        winetricks: ['wmp10']
      }
    })
  })

  it('finds the most specific recipe inside a combined recommendation', () => {
    const setups = {
      vanilla: {
        architecture: '64-bit' as const,
        specialCodecs: [],
        winetricks: []
      },
      wmp11quartz: {
        architecture: '64-bit' as const,
        specialCodecs: ['wmp11', 'quartz2'],
        winetricks: []
      }
    }

    expect(findPrefixSetup('wmp11quartz or vanilla', setups)).toBe(
      setups.wmp11quartz
    )
  })
})
