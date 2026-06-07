import {
  faCheck,
  faSearch,
  faSpinner,
  faSyncAlt
} from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import type { GameInfo } from 'common/types'
import type {
  VndbGameMatch,
  VndbGameMatchSuggestion,
  VndbRelease,
  VndbSearchResult
} from 'common/types/vndb'
import {
  CachedImage,
  TextInputField,
  WarningMessage
} from 'frontend/components/UI'
import { Tooltip } from '@mui/material'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from 'frontend/components/UI/Dialog'
import fallbackImage from 'frontend/assets/heroic_card.jpg'
import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'

type Props = {
  list: GameInfo[]
  variant?: 'header' | 'icon'
}

type MatchState = Record<string, VndbSearchResult | null>

const manualSearchLimit = 50

type PickerResultItem = {
  result: VndbSearchResult
  isPinnedMain: boolean
  isNewestRelease: boolean
}

type PickerResultSection = {
  id: string
  language?: string
  isMainSection: boolean
  items: PickerResultItem[]
}

function getGameKey(game: Pick<GameInfo, 'runner' | 'app_name'>): string {
  return `${game.runner}:${game.app_name}`
}

function getMatchKey(match: Pick<VndbGameMatch, 'runner' | 'appName'>): string {
  return `${match.runner}:${match.appName}`
}

function storedMatchToResult(match: VndbGameMatch): VndbSearchResult {
  return {
    id: match.vndbId,
    title: match.vndbTitle,
    source: match.source ?? 'visualNovel',
    imageUrl: match.imageUrl,
    released: match.released,
    developers: [],
    languages: match.languages ?? [],
    platforms: [],
    relations: match.relations ?? [],
    mainRelation: match.mainRelation,
    latestRelease: match.latestRelease,
    releases: match.releases,
    releaseVns: match.releaseVns
  }
}

function normalizeVndbTitle(title: string): string {
  return title
    .trim()
    .replace(/\s+/g, ' ')
    .toLocaleLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function getSelectedMatchFromStoredMatch(
  storedMatch: VndbGameMatch | undefined,
  suggestedResult: VndbSearchResult | null
): VndbSearchResult | null {
  if (!storedMatch) {
    return suggestedResult
  }

  const storedResult = storedMatchToResult(storedMatch)
  if (suggestedResult?.id !== storedResult.id) {
    const storedReleaseMatchesFreshVisualNovel =
      (storedResult.source === 'release' || storedResult.id.startsWith('r')) &&
      suggestedResult?.source === 'visualNovel' &&
      normalizeVndbTitle(storedResult.title) ===
        normalizeVndbTitle(suggestedResult.title)

    if (storedReleaseMatchesFreshVisualNovel) {
      return suggestedResult
    }

    return storedResult
  }

  return {
    ...suggestedResult,
    source: storedResult.source,
    title: storedResult.title,
    imageUrl: storedResult.imageUrl ?? suggestedResult.imageUrl
  }
}

function getDisplayTitle(game: GameInfo): string {
  return game.overrides?.title || game.title
}

function isMatchableGame(game: GameInfo): boolean {
  return Boolean(getDisplayTitle(game).trim()) && !game.install.is_dlc
}

function getReleaseDateSortValue(released: string | null | undefined): number {
  if (!released || !/^\d{4}-\d{2}-\d{2}$/.test(released)) {
    return Number.NEGATIVE_INFINITY
  }

  return Date.parse(released)
}

function getSortedReleases(result: VndbSearchResult) {
  return [...(result.releases ?? [])].sort((left, right) => {
    const dateDifference =
      getReleaseDateSortValue(right.released) -
      getReleaseDateSortValue(left.released)

    if (dateDifference !== 0) {
      return dateDifference
    }

    return left.title.localeCompare(right.title)
  })
}

function releaseToSearchResult(
  parentResult: VndbSearchResult,
  release: VndbRelease
): VndbSearchResult {
  return {
    id: release.id,
    title: release.title,
    source: 'release',
    imageUrl: release.imageUrl ?? parentResult.imageUrl,
    released: release.released,
    developers: [],
    languages: release.languages ?? [],
    platforms: release.platforms,
    relations: release.vns.flatMap((vn) => vn.relations),
    mainRelation: parentResult.mainRelation,
    latestRelease: release,
    releases: [release],
    releaseVns: release.vns
  }
}

function getUniqueSortedLanguages(languages: string[]): string[] {
  return [...new Set(languages.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  )
}

function getPickerResultSections(
  results: VndbSearchResult[]
): PickerResultSection[] {
  const mainResults = results.filter(
    (result) => result.source === 'visualNovel'
  )
  const releases = new Map<string, VndbSearchResult>()

  for (const result of results) {
    if (result.source === 'release') {
      releases.set(result.id, result)
    }

    for (const release of getSortedReleases(result)) {
      releases.set(release.id, releaseToSearchResult(result, release))
    }
  }

  const sortedReleases = [...releases.values()].sort((left, right) => {
    const dateDifference =
      getReleaseDateSortValue(right.released) -
      getReleaseDateSortValue(left.released)

    if (dateDifference !== 0) {
      return dateDifference
    }

    return left.title.localeCompare(right.title)
  })

  const sections: PickerResultSection[] = []
  const mainItems = mainResults.map((result) => ({
    result,
    isPinnedMain: true,
    isNewestRelease: false
  }))

  if (mainItems.length) {
    sections.push({
      id: 'main',
      isMainSection: true,
      items: mainItems
    })
  }

  sortedReleases.forEach((result, index) => {
    const languages = getUniqueSortedLanguages(result.languages)
    const releaseItem = {
      result,
      isPinnedMain: false,
      isNewestRelease: index === 0
    }

    for (const language of languages.length ? languages : ['unknown']) {
      let section = sections.find((current) => current.id === language)
      if (!section) {
        section = {
          id: language,
          language,
          isMainSection: false,
          items: []
        }
        sections.push(section)
      }
      section.items.push(releaseItem)
    }
  })

  return sections.sort((left, right) => {
    if (left.isMainSection !== right.isMainSection) {
      return left.isMainSection ? -1 : 1
    }

    if (left.id === 'unknown' || right.id === 'unknown') {
      return left.id === 'unknown' ? 1 : -1
    }

    return left.id.localeCompare(right.id)
  })
}

function getLanguageLabel(language: string, locale: string): string {
  if (language === 'unknown') {
    return 'Unknown language'
  }

  try {
    const normalizedLocale = locale.replace('_', '-')

    return (
      new Intl.DisplayNames([normalizedLocale, 'en'], {
        type: 'language'
      }).of(language) ?? language
    )
  } catch {
    return language
  }
}

function getLanguagesLabel(languages: string[], locale: string): string {
  return getUniqueSortedLanguages(languages)
    .map((language) => getLanguageLabel(language, locale))
    .join(', ')
}

function VndbMainRelation({
  relation
}: {
  relation?: VndbSearchResult['mainRelation']
}) {
  if (!relation) {
    return null
  }

  const label = `${relation.title} (${relation.relationLabel})`

  return (
    <Tooltip title={label} arrow placement="bottom-start">
      <span className="vndbSyncRelation vndbSyncRelation--main">
        Main: {label}
      </span>
    </Tooltip>
  )
}

function VndbReleaseVns({ result }: { result: VndbSearchResult }) {
  if (result.source !== 'release' || !result.releaseVns?.length) {
    return null
  }

  const [firstReleaseVn, ...otherReleaseVns] = result.releaseVns
  const label = [
    firstReleaseVn.title,
    otherReleaseVns.length ? `+${otherReleaseVns.length} more` : ''
  ]
    .filter(Boolean)
    .join(', ')
  const tooltipLabel = result.releaseVns
    .map((releaseVn) => releaseVn.title)
    .join('\n')

  return (
    <Tooltip title={tooltipLabel} arrow placement="bottom-start">
      <span className="vndbSyncRelation">Includes: {label}</span>
    </Tooltip>
  )
}

function VndbLanguages({
  languages,
  locale
}: {
  languages: string[]
  locale: string
}) {
  const { t } = useTranslation()
  const label = getLanguagesLabel(languages, locale)

  if (!label) {
    return null
  }

  return (
    <Tooltip title={label} arrow placement="bottom-start">
      <span className="vndbSyncRelation">
        {t('vndb.sync.languages', 'Languages: {{languages}}', {
          languages: label
        })}
      </span>
    </Tooltip>
  )
}

function VndbResultCard({
  result,
  onClick,
  emptyLabel,
  locale
}: {
  result: VndbSearchResult | null
  onClick: () => void
  emptyLabel: string
  locale: string
}) {
  if (!result) {
    return (
      <button className="vndbSyncCard vndbSyncCard--empty" onClick={onClick}>
        <FontAwesomeIcon icon={faSearch} />
        <span>{emptyLabel}</span>
      </button>
    )
  }

  return (
    <button className="vndbSyncCard vndbSyncCard--result" onClick={onClick}>
      <CachedImage
        className="vndbSyncCardImage"
        src={result.imageUrl || fallbackImage}
        fallback={fallbackImage}
      />
      <span className="vndbSyncCardBody">
        <Tooltip title={result.title} arrow placement="bottom-start">
          <span className="vndbSyncCardTitle">{result.title}</span>
        </Tooltip>
        <span className="vndbSyncCardMeta">
          {result.id}
          {result.released ? ` - ${result.released}` : ''}
          {result.source === 'release' ? ' - Release' : ''}
        </span>
        <VndbMainRelation relation={result.mainRelation} />
        <VndbReleaseVns result={result} />
        <VndbLanguages languages={result.languages} locale={locale} />
      </span>
    </button>
  )
}

export default function VndbSyncButton({ list, variant = 'header' }: Props) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [suggestions, setSuggestions] = useState<VndbGameMatchSuggestion[]>([])
  const [selectedMatches, setSelectedMatches] = useState<MatchState>({})
  const [pickerGameKey, setPickerGameKey] = useState<string | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerResults, setPickerResults] = useState<VndbSearchResult[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const matchableGames = useMemo(() => list.filter(isMatchableGame), [list])

  async function loadMatches() {
    setOpen(true)
    setLoadingMatches(true)
    setError(null)
    setPickerGameKey(null)
    setPickerResults([])

    try {
      const targets = matchableGames.map((game) => ({
        appName: game.app_name,
        runner: game.runner,
        title: getDisplayTitle(game)
      }))
      const [storedMatches, nextSuggestions] = await Promise.all([
        window.api.vndb.getAllGameMatches(),
        window.api.vndb.matchGames(targets)
      ])
      const nextSelectedMatches: MatchState = {}

      for (const suggestion of nextSuggestions) {
        const storedMatch =
          storedMatches[
            getMatchKey({
              appName: suggestion.game.appName,
              runner: suggestion.game.runner
            })
          ]
        nextSelectedMatches[
          getMatchKey({
            appName: suggestion.game.appName,
            runner: suggestion.game.runner
          })
        ] = getSelectedMatchFromStoredMatch(storedMatch, suggestion.result)
      }

      setSuggestions(nextSuggestions)
      setSelectedMatches(nextSelectedMatches)
    } catch (err) {
      console.error(err)
      setError(
        t(
          'vndb.sync.error.match',
          'Unable to search VNDB for the current library.'
        )
      )
    } finally {
      setLoadingMatches(false)
    }
  }

  async function searchPicker(queryOverride?: string) {
    const query = (queryOverride ?? pickerQuery).trim()
    if (!query) {
      return
    }

    setPickerLoading(true)
    setError(null)

    try {
      const results = await window.api.vndb.searchVisualNovels({
        query,
        limit: manualSearchLimit
      })
      setPickerResults(results)
      if (!results.length) {
        setError(t('vndb.sync.error.no-results', 'No VNDB results found.'))
      }
    } catch (err) {
      console.error(err)
      setError(t('vndb.sync.error.search', 'VNDB search failed.'))
    } finally {
      setPickerLoading(false)
    }
  }

  function openPicker(suggestion: VndbGameMatchSuggestion) {
    const key = getMatchKey({
      appName: suggestion.game.appName,
      runner: suggestion.game.runner
    })
    const query = selectedMatches[key]?.title || suggestion.game.title
    setPickerGameKey(key)
    setPickerQuery(query)
    setPickerResults([])
    setError(null)
    void searchPicker(query)
  }

  function selectPickerResult(result: VndbSearchResult | null) {
    if (!pickerGameKey) {
      return
    }

    setSelectedMatches((current) => ({
      ...current,
      [pickerGameKey]: result
    }))
    setPickerGameKey(null)
    setPickerResults([])
  }

  async function syncMatches() {
    setSyncing(true)
    setError(null)

    try {
      await window.api.vndb.syncGameMatches(
        suggestions.map((suggestion) => {
          const key = getMatchKey({
            appName: suggestion.game.appName,
            runner: suggestion.game.runner
          })
          const selectedMatch = selectedMatches[key]

          return {
            appName: suggestion.game.appName,
            runner: suggestion.game.runner,
            title: suggestion.game.title,
            vndbId: selectedMatch?.id ?? null,
            vndbTitle: selectedMatch?.title,
            source: selectedMatch?.source,
            imageUrl: selectedMatch?.imageUrl,
            released: selectedMatch?.released,
            languages: selectedMatch?.languages,
            mainRelation: selectedMatch?.mainRelation,
            relations: selectedMatch?.relations,
            latestRelease: selectedMatch?.latestRelease,
            releases: selectedMatch?.releases,
            releaseVns: selectedMatch?.releaseVns
          }
        })
      )
      setOpen(false)
    } catch (err) {
      console.error(err)
      setError(t('vndb.sync.error.save', 'Unable to sync VNDB matches.'))
    } finally {
      setSyncing(false)
    }
  }

  const pickerSuggestion = suggestions.find(
    (suggestion) =>
      getMatchKey({
        appName: suggestion.game.appName,
        runner: suggestion.game.runner
      }) === pickerGameKey
  )
  const pickerResultSections = getPickerResultSections(pickerResults)

  return (
    <>
      <button
        className={
          variant === 'icon' ? 'svg-button vndbSyncIcon' : 'vndbSyncButton'
        }
        title={t('vndb.sync.title', 'Sync VNDB Titles')}
        onClick={() => void loadMatches()}
        disabled={!matchableGames.length}
      >
        <FontAwesomeIcon icon={variant === 'icon' ? faSyncAlt : faSearch} />
        {variant === 'header' && t('vndb.sync.button', 'VNDB')}
      </button>

      {open && (
        <Dialog
          onClose={() => setOpen(false)}
          showCloseButton
          className="VndbSyncDialog"
        >
          <DialogHeader>
            {t('vndb.sync.title', 'Sync VNDB Titles')}
          </DialogHeader>
          <DialogContent className="vndbSyncContent">
            {error && <WarningMessage>{error}</WarningMessage>}

            {loadingMatches ? (
              <div className="vndbSyncLoading">
                <FontAwesomeIcon icon={faSpinner} spin size="2x" />
                <span>{t('vndb.sync.loading', 'Searching VNDB...')}</span>
              </div>
            ) : (
              <>
                {pickerSuggestion && (
                  <div className="vndbSyncPicker">
                    <div className="vndbSyncPickerHeader">
                      <Tooltip
                        title={pickerSuggestion.game.title}
                        arrow
                        placement="bottom-start"
                      >
                        <h3>{pickerSuggestion.game.title}</h3>
                      </Tooltip>
                      <button
                        className="button is-ghost"
                        onClick={() => setPickerGameKey(null)}
                      >
                        {t('button.cancel', 'Cancel')}
                      </button>
                    </div>
                    <TextInputField
                      htmlId="vndb-sync-search"
                      label={t('vndb.sync.search-label', 'Search VNDB')}
                      value={pickerQuery}
                      onChange={setPickerQuery}
                      onKeyDown={(event) => {
                        if (event.key === 'Enter') {
                          void searchPicker()
                        }
                      }}
                      afterInput={
                        <button
                          className="button is-secondary"
                          onClick={() => void searchPicker()}
                          disabled={pickerLoading}
                        >
                          {pickerLoading ? (
                            <FontAwesomeIcon icon={faSpinner} spin />
                          ) : (
                            <FontAwesomeIcon icon={faSearch} />
                          )}
                          {t('button.search', 'Search')}
                        </button>
                      }
                    />
                    <div className="vndbSyncPickerSections">
                      {pickerResults.length === 0 && (
                        <button
                          className="vndbSyncPickerResult vndbSyncPickerResult--none"
                          onClick={() => selectPickerResult(null)}
                        >
                          {t('vndb.sync.no-match', 'No VNDB match')}
                        </button>
                      )}
                      {pickerResultSections.map((section) => (
                        <section
                          className="vndbSyncPickerSection"
                          key={section.id}
                        >
                          <h4>
                            {section.isMainSection
                              ? t('vndb.sync.section-main', 'Main titles')
                              : t(
                                  'vndb.sync.section-language',
                                  '{{language}} releases',
                                  {
                                    language: getLanguageLabel(
                                      section.language ?? 'unknown',
                                      i18n.language
                                    )
                                  }
                                )}
                          </h4>
                          <div className="vndbSyncPickerResults">
                            {section.items.map(
                              ({ result, isPinnedMain, isNewestRelease }) => (
                                <button
                                  className={[
                                    'vndbSyncPickerResult',
                                    isPinnedMain
                                      ? 'vndbSyncPickerResult--main'
                                      : '',
                                    isNewestRelease
                                      ? 'vndbSyncPickerResult--newest'
                                      : ''
                                  ]
                                    .filter(Boolean)
                                    .join(' ')}
                                  key={`${section.id}:${result.source}:${result.id}`}
                                  onClick={() => selectPickerResult(result)}
                                >
                                  <CachedImage
                                    src={result.imageUrl || fallbackImage}
                                    fallback={fallbackImage}
                                  />
                                  <span className="vndbSyncPickerResultBody">
                                    <Tooltip
                                      title={result.title}
                                      arrow
                                      placement="bottom-start"
                                    >
                                      <strong>{result.title}</strong>
                                    </Tooltip>
                                    <small>
                                      {result.id}
                                      {result.released
                                        ? ` - ${result.released}`
                                        : ''}
                                      {result.source === 'release'
                                        ? ' - Release'
                                        : ''}
                                    </small>
                                    <span className="vndbSyncResultBadges">
                                      {isPinnedMain && (
                                        <span className="vndbSyncResultBadge vndbSyncResultBadge--main">
                                          Main
                                        </span>
                                      )}
                                      {isNewestRelease && (
                                        <span className="vndbSyncResultBadge vndbSyncResultBadge--newest">
                                          Newest
                                        </span>
                                      )}
                                    </span>
                                    <VndbMainRelation
                                      relation={result.mainRelation}
                                    />
                                    <VndbReleaseVns result={result} />
                                    <VndbLanguages
                                      languages={result.languages}
                                      locale={i18n.language}
                                    />
                                  </span>
                                </button>
                              )
                            )}
                          </div>
                        </section>
                      ))}
                    </div>
                  </div>
                )}

                <div className="vndbSyncRows">
                  {suggestions.map((suggestion) => {
                    const key = getMatchKey({
                      appName: suggestion.game.appName,
                      runner: suggestion.game.runner
                    })
                    const localGame = matchableGames.find(
                      (game) => getGameKey(game) === key
                    )
                    const selectedMatch = selectedMatches[key] ?? null

                    return (
                      <div className="vndbSyncRow" key={key}>
                        <div className="vndbSyncCard vndbSyncCard--local">
                          <CachedImage
                            className="vndbSyncCardImage"
                            src={
                              localGame?.art_square ||
                              localGame?.art_cover ||
                              fallbackImage
                            }
                            fallback={fallbackImage}
                          />
                          <span className="vndbSyncCardBody">
                            <Tooltip
                              title={suggestion.game.title}
                              arrow
                              placement="bottom-start"
                            >
                              <span className="vndbSyncCardTitle">
                                {suggestion.game.title}
                              </span>
                            </Tooltip>
                            <span className="vndbSyncCardMeta">
                              {suggestion.game.runner}
                            </span>
                          </span>
                        </div>
                        <span className="vndbSyncArrow">-&gt;</span>
                        <VndbResultCard
                          result={selectedMatch}
                          onClick={() => openPicker(suggestion)}
                          emptyLabel={t(
                            'vndb.sync.search-manual',
                            'Search VNDB'
                          )}
                          locale={i18n.language}
                        />
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </DialogContent>
          <DialogFooter>
            <button
              className="button is-secondary"
              onClick={() => setOpen(false)}
              disabled={syncing}
            >
              {t('button.cancel', 'Cancel')}
            </button>
            <button
              className="button is-success"
              onClick={() => void syncMatches()}
              disabled={loadingMatches || syncing || !suggestions.length}
            >
              {syncing ? (
                <FontAwesomeIcon icon={faSpinner} spin />
              ) : (
                <FontAwesomeIcon icon={faCheck} />
              )}
              {t('button.confirm', 'Confirm')}
            </button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  )
}
