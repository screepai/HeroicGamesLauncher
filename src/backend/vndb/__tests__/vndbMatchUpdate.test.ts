import { searchResultToMatchUpdate } from 'common/vndbMatchUpdate'
import type { VndbSearchResult } from 'common/types/vndb'

const result: VndbSearchResult = {
  id: 'v1',
  title: 'VN Title',
  aliases: ['alias'],
  source: 'visualNovel',
  imageUrl: 'https://example.com/a.jpg',
  released: '2020-01-01',
  rating: 80,
  developers: ['Dev'],
  languages: ['en'],
  platforms: ['win'],
  relations: [],
  releases: []
}
const target = { appName: 'game', runner: 'sideload' as const, title: 'Game' }

describe('searchResultToMatchUpdate', () => {
  it('maps a search result to a match update', () => {
    expect(searchResultToMatchUpdate(target, result)).toMatchObject({
      appName: 'game',
      runner: 'sideload',
      title: 'Game',
      vndbId: 'v1',
      vndbTitle: 'VN Title',
      aliases: ['alias'],
      source: 'visualNovel',
      released: '2020-01-01',
      rating: 80,
      developers: ['Dev'],
      languages: ['en'],
      releases: []
    })
  })

  it('clears the match for a null result', () => {
    expect(searchResultToMatchUpdate(target, null)).toMatchObject({
      vndbId: null,
      vndbTitle: undefined
    })
  })

  it('lets overrides win over the result', () => {
    expect(
      searchResultToMatchUpdate(target, result, { source: 'release' })
    ).toMatchObject({ source: 'release', vndbId: 'v1' })
  })
})
