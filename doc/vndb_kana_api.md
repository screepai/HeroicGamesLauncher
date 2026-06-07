# vndb-kana-api

This project has `vndb-kana-api` installed as a direct dependency. The installed package is version `0.3.0` and exports a TypeScript wrapper around the VNDB Kana API at `https://api.vndb.org/kana`.

Use it when Heroic needs VNDB metadata for visual novels: title search, VN details, releases, producers, characters, staff, tags, traits, quotes, or VNDB user lists.

## Import

```ts
import {
  VndbClient,
  filters,
  fields,
  selectFields,
  selectSubFields,
  isRateLimitError,
  isVndbError
} from 'vndb-kana-api'

import type { VisualNovel, VnField } from 'vndb-kana-api'
```

The package also exports:

- `createVndbClient(config)`
- a default `VndbClient`
- a shared `vndb` instance

Prefer creating an app-owned client instead of using the shared `vndb` instance so configuration, token state, and tests stay explicit.

## Client

```ts
const vndb = new VndbClient({
  token: process.env.VNDB_TOKEN,
  timeout: 30_000,
  userAgent: 'HeroicGamesLauncher/2.22.0',
  rateLimit: {
    requests: 200,
    window: 300_000
  }
})
```

Client config:

- `baseURL`: defaults to `https://api.vndb.org/kana`
- `token`: optional for public read operations, required for authenticated user-list operations
- `timeout`: defaults to `30000`
- `userAgent`: defaults to `vndb-kana-api/1.0.0` in the built package
- `rateLimit.requests`: defaults to `200`
- `rateLimit.window`: defaults to `300000` ms

For Heroic, authenticated calls should stay in the backend. Do not pass VNDB API tokens through frontend state or renderer components. Expose a narrow typed IPC function if the frontend needs VNDB data.

## Core Methods

Public read methods:

- `getStats()`
- `getSchema()`
- `getUsers(queries, fields?)`
- `getVisualNovels(query?)`
- `getVisualNovel(id, fields?)`
- `getReleases(query?)`
- `getRelease(id, fields?)`
- `getProducers(query?)`
- `getProducer(id, fields?)`
- `getCharacters(query?)`
- `getCharacter(id, fields?)`
- `getStaff(query?)`
- `getStaffMember(id, fields?)`
- `getTags(query?)`
- `getTag(id, fields?)`
- `getTraits(query?)`
- `getTrait(id, fields?)`
- `getQuotes(query?)`
- `getRandomQuote(fields?)`
- `request<T>(axiosConfig)`

Convenience methods:

- `searchVisualNovels(title, fields?, limit?)`
- `getVisualNovelsByIds(ids, fields?)`
- `getCharacterVoiceActors(characterId, vnid)`
- `getAllCharacterVoiceActors(vnid)`
- `getAllResults(queryFn, maxPages?, delayMs?)`

Authenticated methods:

- `getAuthInfo()`
- `getUserLabels(userId?, fields?)`
- `getUserList(query)` where `query.user` is required
- `updateUserListEntry(vnId, data)`
- `deleteUserListEntry(vnId)`
- `updateUserReleaseEntry(releaseId, data)`
- `deleteUserReleaseEntry(releaseId)`

`setToken(token)` updates the client authorization header. `clearToken()` removes it.

## Query Shape

Most list methods accept an `ApiQuery<T>`:

```ts
const response = await vndb.getVisualNovels({
  filters: filters.search('clannad'),
  fields: fields.vnDetailed,
  sort: 'searchrank',
  results: 10,
  page: 1,
  count: true
})

for (const vn of response.results) {
  console.log(vn.id, vn.title)
}
```

Response shape:

```ts
type ApiResponse<T> = {
  results: T[]
  more: boolean
  count?: number
  compact_filters?: string
  normalized_filters?: Filter[]
}
```

Use `getAllResults()` for paginated fetches when the caller really needs every page:

```ts
const all = await vndb.getAllResults(
  (page) =>
    vndb.getVisualNovels({
      filters: filters.language('en'),
      fields: fields.vnBasic,
      results: 100,
      page
    }),
  20
)
```

## Filters

The library represents filters as VNDB filter tuples:

```ts
;['title', '=', 'CLANNAD'][('and', ['lang', '=', 'en'], ['rating', '>=', 80])][
  ('or', ['id', '=', 'v4'], ['id', '=', 'v17'])
]
```

Use helpers for common filters:

```ts
import { and, or, filter, filters } from 'vndb-kana-api'

const queryFilter = and(
  filters.language(['en', 'ja']),
  filters.ratingRange(80, 100),
  or(filters.platform('win'), filters.platform('lin')),
  filter('has_description', '=', 1)
)
```

Available helper groups:

- `filter(field, operator, value)`
- `and(...filters)`
- `or(...filters)`
- `filters.id(idOrIds)`
- `filters.search(term)`
- `filters.language(langOrLangs)`
- `filters.platform(platformOrPlatforms)`
- `filters.dateRange(after?, before?)`
- `filters.ratingRange(min?, max?)`
- `filters.tag(tagId, maxSpoiler?, minLevel?)`
- `filters.trait(traitId, maxSpoiler?)`
- `filters.hasDescription()`
- `filters.hasAnime()`
- `filters.hasScreenshot()`
- `filters.hasReview()`
- `filters.finished()`
- `filters.inDevelopment()`
- `filters.cancelled()`
- `filters.patch()`
- `filters.freeware()`
- `filters.official()`
- `filters.hasEro()`
- `filters.uncensored()`
- `filters.male()`
- `filters.female()`
- `filters.mainStaff()`

## Fields

VNDB field selection is a comma-separated string. The package includes presets:

- `fields.vnBasic`, `fields.vnDetailed`, `fields.vnFull`
- `fields.releaseBasic`, `fields.releaseDetailed`
- `fields.characterBasic`, `fields.characterDetailed`, `fields.characterFull`
- `fields.producerBasic`, `fields.producerDetailed`
- `fields.staffBasic`, `fields.staffDetailed`
- `fields.tagBasic`, `fields.traitBasic`
- Nested presets such as `fields.vn.basic`, `fields.vn.full`, `fields.quote.full`, `fields.ulist.full`

For stronger TypeScript autocomplete, build fields explicitly:

```ts
const vnFields = [
  selectFields<VnField>('id', 'title', 'rating', 'released'),
  selectSubFields<VisualNovel, 'image'>('image', 'url', 'dims'),
  selectSubFields<VisualNovel, 'developers'>('developers', 'id', 'name')
].join(',')

const vn = await vndb.getVisualNovel('v4', vnFields)
```

## IDs

Single-entry methods validate ID prefixes before calling the API:

- visual novels: `v<number>`
- releases: `r<number>`
- producers: `p<number>`
- characters: `c<number>`
- staff: `s<number>`
- tags: `g<number>`
- traits: `i<number>`

Utility helpers:

- `parseVndbId(id)` returns `{ type, number }` or `null`
- `isValidVndbId(id, expectedType?)`

## Errors And Retry

The package wraps Axios errors:

- `VndbApiError`
- `VndbRateLimitError`
- `VndbAuthenticationError`
- `VndbValidationError`

Use type guards in app code:

```ts
try {
  return await vndb.getVisualNovel('v4', fields.vnDetailed)
} catch (error) {
  if (isRateLimitError(error)) {
    // Back off or surface a quiet retry message.
    throw error
  }

  if (isVndbError(error)) {
    throw new Error(error.friendlyMessage)
  }

  throw error
}
```

`withRetry(fn, config?)` retries server errors, rate limits, and common network errors by default. The default retry config uses `maxRetries: 3`, `baseDelay: 1000`, `maxDelay: 30000`, and exponential backoff.

## Format Utilities

Useful display helpers:

- `formatReleaseDate(date)`
- `formatRating(rating)`
- `formatPlayTime(minutes)`
- `getLengthCategory(minutes)`
- `formatLengthEnum(length)`
- `formatDevStatus(status)`
- `formatCharacterRole(role)`
- `formatProducerType(type)`
- `buildPaginationInfo(response, currentPage?)`
- `mergeQueries(baseQuery, overrides)`
- `createRandomQueries(count, filters?)`
- `chunk(array, size)`
- `debounce(fn, delay)`
- `throttle(fn, delay)`
- `RateLimiter`

Heroic already has some local formatting/throttling helpers. Prefer existing Heroic helpers for generic UI/download behavior, and use VNDB-specific formatters only for VNDB metadata.

## Backend Integration Pattern

Recommended shape for Heroic:

```ts
// src/backend/vndb/client.ts
import { app } from 'electron'
import { VndbClient } from 'vndb-kana-api'

export const vndbClient = new VndbClient({
  userAgent: `HeroicGamesLauncher/${app.getVersion()}`
})
```

```ts
// src/backend/vndb/search.ts
import { fields, filters } from 'vndb-kana-api'
import { vndbClient } from './client'

export async function searchVisualNovelMetadata(title: string) {
  return vndbClient.searchVisualNovels(title, fields.vnDetailed, 10)
}
```

If renderer code needs this data, add a typed IPC bridge entry and expose only the specific backend function the UI needs.

## Gotchas

- `getRandomQuote()` is not truly random in the built package; it requests one quote sorted by `id`.
- `getStaffMember()` adds `ismain = 1`, so it is aimed at main staff identities rather than every alias.
- `byDateRange()` throws `VndbValidationError` if both bounds are missing.
- `getVisualNovelsByIds()` batches IDs by 100.
- The package's built default `userAgent` says `vndb-kana-api/1.0.0` even though the installed package version is `0.3.0`; pass Heroic's own user agent explicitly.
- Field strings are not runtime-validated by the wrapper. Type helpers improve autocomplete, but invalid custom strings can still reach the API.
