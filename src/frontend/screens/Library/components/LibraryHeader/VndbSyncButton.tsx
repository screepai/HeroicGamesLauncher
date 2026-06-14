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
  VndbSearchResult,
  VndbUserDataSyncTarget
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
import {
  getVndbReleasesWithSelectedReleases,
  getVndbReleaseMainVisualNovelId,
  getUniqueSortedVndbPlatforms,
  getVndbPlatformsLabel,
  normalizeVndbSelectedMatch,
  sortVndbItemsByDate,
  sortVndbReleasesByDate
} from 'frontend/helpers/vndb'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useAppSetting from 'frontend/hooks/useAppSetting'

type Props = {
  list: GameInfo[]
  variant?: 'header' | 'icon'
  onMatchesChange?: (matches: Record<string, VndbGameMatch>) => void
  autoOpen?: boolean
  hideTrigger?: boolean
  onClose?: () => void
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
    aliases: match.aliases,
    source: match.source ?? 'visualNovel',
    imageUrl: match.imageUrl,
    released: match.released,
    average: match.average,
    rating: match.rating,
    votecount: match.votecount,
    length: match.length,
    lengthMinutes: match.lengthMinutes,
    lengthVotes: match.lengthVotes,
    description: match.description,
    tags: match.tags,
    developers: match.developers ?? [],
    languages: match.languages ?? [],
    platforms: getStoredMatchPlatforms(match),
    relations: match.relations ?? [],
    mainRelation: match.mainRelation,
    latestRelease: match.latestRelease,
    selectedReleases: match.selectedReleases,
    releases: match.releases,
    releaseVns: match.releaseVns
  }
}

function getSelectedMatchFromStoredMatch(
  storedMatch: VndbGameMatch | undefined
): VndbSearchResult | null {
  if (!storedMatch) {
    return null
  }

  return storedMatchToResult(storedMatch)
}

function getDisplayTitle(game: GameInfo): string {
  return game.overrides?.title || game.title
}

function isMatchableGame(game: GameInfo): boolean {
  return (
    Boolean(game.isVisualNovel) &&
    Boolean(getDisplayTitle(game).trim()) &&
    !game.install.is_dlc
  )
}

function getVndbUserDataSyncTarget(game: GameInfo): VndbUserDataSyncTarget {
  return {
    appName: game.app_name,
    runner: game.runner,
    installedAt: game.install.installed_at,
    installPath: game.install.install_path || game.folder_name
  }
}

function getSortedReleases(result: VndbSearchResult) {
  return sortVndbReleasesByDate(result.releases ?? [])
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
    average: parentResult.average,
    rating: parentResult.rating,
    votecount: parentResult.votecount,
    length: parentResult.length,
    lengthMinutes: parentResult.lengthMinutes,
    lengthVotes: parentResult.lengthVotes,
    description: parentResult.description,
    tags: parentResult.tags,
    developers: parentResult.developers,
    languages: release.languages ?? [],
    platforms: release.platforms,
    relations: release.vns.flatMap((vn) => vn.relations),
    mainRelation: parentResult.mainRelation,
    latestRelease: release,
    releases: parentResult.releases ?? [release],
    releaseVns: release.vns
  }
}

async function hydrateSelectedMatch(
  result: VndbSearchResult | null
): Promise<VndbSearchResult | null> {
  if (!result) {
    return result
  }

  if (result.source === 'visualNovel' && result.releases !== undefined) {
    return result
  }

  const mainVisualNovelId =
    result.source === 'release'
      ? getVndbReleaseMainVisualNovelId(result)
      : result.id
  if (!mainVisualNovelId) {
    return normalizeVndbSelectedMatch(result)
  }

  try {
    const [mainResult] = await window.api.vndb.searchVisualNovels({
      query: mainVisualNovelId,
      limit: 1
    })

    const hydratedMainResult =
      mainResult?.id === mainVisualNovelId ? mainResult : undefined

    return result.source === 'release'
      ? normalizeVndbSelectedMatch(result, hydratedMainResult)
      : (hydratedMainResult ?? result)
  } catch (error) {
    console.error(error)
    return normalizeVndbSelectedMatch(result)
  }
}

function getUniqueSortedLanguages(languages: string[]): string[] {
  return [...new Set(languages.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  )
}

function getStoredMatchPlatforms(match: VndbGameMatch): string[] {
  return getUniqueSortedVndbPlatforms([
    ...(match.latestRelease?.platforms ?? []),
    ...(match.releases?.flatMap((release) => release.platforms ?? []) ?? [])
  ])
}

function getResultSelectedReleases(
  result: VndbSearchResult | null | undefined
): VndbRelease[] {
  if (!result) {
    return []
  }

  if (result.selectedReleases !== undefined) {
    return result.selectedReleases
  }

  return result.latestRelease ? [result.latestRelease] : []
}

function getResultRelease(result: VndbSearchResult): VndbRelease | undefined {
  if (result.source !== 'release') {
    return undefined
  }

  return (
    result.latestRelease ?? {
      id: result.id,
      title: result.title,
      imageUrl: result.imageUrl,
      released: result.released,
      languages: result.languages,
      platforms: result.platforms,
      vns: result.releaseVns ?? []
    }
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

  const sortedReleases = sortVndbItemsByDate([...releases.values()])

  const releaseSections = new Map<string, PickerResultSection>()
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
      let section = releaseSections.get(language)
      if (!section) {
        section = {
          id: language,
          language,
          isMainSection: false,
          items: []
        }
        releaseSections.set(language, section)
      }
      section.items.push(releaseItem)
    }
  })

  return [...sections, ...releaseSections.values()].sort((left, right) => {
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
        Related: {label}
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

function VndbPlatforms({ platforms }: { platforms: string[] }) {
  const { t } = useTranslation()
  const label = getVndbPlatformsLabel(platforms)

  if (!label) {
    return null
  }

  return (
    <Tooltip title={label} arrow placement="bottom-start">
      <span className="vndbSyncRelation">
        {t('vndb.sync.platforms', 'Platforms: {{platforms}}', {
          platforms: label
        })}
      </span>
    </Tooltip>
  )
}

function VndbDownloadedReleases({ releases }: { releases: VndbRelease[] }) {
  const { t } = useTranslation()

  if (!releases.length) {
    return null
  }

  const releaseLabels = releases.map((release) => {
    const releaseLabel = [
      release.title,
      release.released ? `(${release.released})` : ''
    ]
      .filter(Boolean)
      .join(' ')
    const platforms = getVndbPlatformsLabel(release.platforms)
    return platforms ? `${releaseLabel} - ${platforms}` : releaseLabel
  })
  const [firstRelease, ...otherReleases] = releaseLabels
  const displayLabel = otherReleases.length
    ? `${firstRelease} +${otherReleases.length}`
    : firstRelease
  const tooltipLabel = releaseLabels.join('\n')

  return (
    <Tooltip title={tooltipLabel} arrow placement="bottom-start">
      <span className="vndbSyncRelation">
        {t('vndb.sync.downloaded-releases', 'Downloaded: {{releases}}', {
          releases: displayLabel
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
        <VndbDownloadedReleases releases={getResultSelectedReleases(result)} />
        <VndbLanguages languages={result.languages} locale={locale} />
        {result.source === 'release' && (
          <VndbPlatforms platforms={result.platforms} />
        )}
      </span>
    </button>
  )
}

export default function VndbSyncButton({
  list,
  variant = 'header',
  onMatchesChange,
  autoOpen = false,
  hideTrigger = false,
  onClose
}: Props) {
  const { t, i18n } = useTranslation()
  const syncVndbUserData = useAppSetting('syncVndbUserData', false)
  const [open, setOpen] = useState(false)
  const [loadingMatches, setLoadingMatches] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [refreshingMatches, setRefreshingMatches] = useState(false)
  const [suggestions, setSuggestions] = useState<VndbGameMatchSuggestion[]>([])
  const [selectedMatches, setSelectedMatches] = useState<MatchState>({})
  const [pickerGameKey, setPickerGameKey] = useState<string | null>(null)
  const [pickerQuery, setPickerQuery] = useState('')
  const [pickerResults, setPickerResults] = useState<VndbSearchResult[]>([])
  const [pickerLoading, setPickerLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const autoOpenStarted = useRef(false)

  const matchableGames = useMemo(() => list.filter(isMatchableGame), [list])
  const matchableGamesByKey = useMemo(
    () =>
      new Map(matchableGames.map((game) => [getGameKey(game), game] as const)),
    [matchableGames]
  )

  const loadMatches = useCallback(async () => {
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
      const storedMatches = await window.api.vndb.getAllGameMatches()
      const unmatchedTargets = targets.filter(
        (target) => !storedMatches[getMatchKey(target)]
      )
      const matchedSuggestions = unmatchedTargets.length
        ? await window.api.vndb.matchGames(unmatchedTargets)
        : []
      const matchedResults = new Map(
        matchedSuggestions.map((suggestion) => [
          getMatchKey(suggestion.game),
          suggestion.result
        ])
      )
      const nextSuggestions = targets.map((game) => ({
        game,
        result: matchedResults.get(getMatchKey(game)) ?? null
      }))
      const nextSelectedMatches: MatchState = {}

      for (const suggestion of nextSuggestions) {
        const key = getMatchKey(suggestion.game)
        const storedMatch = storedMatches[key]
        nextSelectedMatches[key] =
          getSelectedMatchFromStoredMatch(storedMatch) ?? suggestion.result
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
  }, [matchableGames, t])

  useEffect(() => {
    if (autoOpen && !autoOpenStarted.current && matchableGames.length) {
      autoOpenStarted.current = true
      void loadMatches()
    }
  }, [autoOpen, loadMatches, matchableGames.length])

  function closeDialog() {
    setOpen(false)
    onClose?.()
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

  async function selectPickerResult(result: VndbSearchResult | null) {
    if (!pickerGameKey) {
      return
    }

    setPickerLoading(true)
    try {
      if (result?.source === 'release') {
        const release = getResultRelease(result)
        const hydratedMatch = await hydrateSelectedMatch(result)
        if (!release || !hydratedMatch) {
          return
        }

        setSelectedMatches((current) => {
          const currentMatch = current[pickerGameKey]
          const isSameVisualNovel = currentMatch?.id === hydratedMatch.id
          const selectedReleases = isSameVisualNovel
            ? getResultSelectedReleases(currentMatch)
            : []
          const isSelected = selectedReleases.some(
            (selectedRelease) => selectedRelease.id === release.id
          )
          const nextSelectedReleases = isSelected
            ? selectedReleases.filter(
                (selectedRelease) => selectedRelease.id !== release.id
              )
            : [...selectedReleases, release]
          const availableReleases = [
            ...(isSameVisualNovel ? (currentMatch?.releases ?? []) : []),
            ...(hydratedMatch.releases ?? [])
          ]
          const matchWithSyncedData = isSameVisualNovel
            ? { ...hydratedMatch, ...currentMatch }
            : hydratedMatch

          return {
            ...current,
            [pickerGameKey]: {
              ...matchWithSyncedData,
              latestRelease: nextSelectedReleases[0],
              selectedReleases: nextSelectedReleases,
              releases: getVndbReleasesWithSelectedReleases(
                availableReleases,
                nextSelectedReleases
              ),
              releaseVns: nextSelectedReleases[0]?.vns
            }
          }
        })
        return
      }

      const selectedMatch = await hydrateSelectedMatch(result)
      setSelectedMatches((current) => {
        const currentMatch = current[pickerGameKey]

        return {
          ...current,
          [pickerGameKey]:
            selectedMatch && currentMatch?.id === selectedMatch.id
              ? currentMatch
              : selectedMatch
        }
      })
      setPickerGameKey(null)
      setPickerResults([])
    } finally {
      setPickerLoading(false)
    }
  }

  async function syncMatches() {
    setSyncing(true)
    setError(null)

    try {
      const updatedMatches = await window.api.vndb.syncGameMatches(
        suggestions.map((suggestion) => {
          const key = getMatchKey({
            appName: suggestion.game.appName,
            runner: suggestion.game.runner
          })
          const selectedMatch = selectedMatches[key]
          const normalizedMatch = normalizeVndbSelectedMatch(selectedMatch)

          return {
            appName: suggestion.game.appName,
            runner: suggestion.game.runner,
            title: suggestion.game.title,
            vndbId: normalizedMatch?.id ?? null,
            vndbTitle: normalizedMatch?.title,
            aliases: normalizedMatch?.aliases,
            source: normalizedMatch?.source,
            imageUrl: normalizedMatch?.imageUrl,
            released: normalizedMatch?.released,
            average: normalizedMatch?.average,
            rating: normalizedMatch?.rating,
            votecount: normalizedMatch?.votecount,
            length: normalizedMatch?.length,
            lengthMinutes: normalizedMatch?.lengthMinutes,
            lengthVotes: normalizedMatch?.lengthVotes,
            description: normalizedMatch?.description,
            tags: normalizedMatch?.tags,
            developers: normalizedMatch?.developers,
            languages: normalizedMatch?.languages,
            mainRelation: normalizedMatch?.mainRelation,
            relations: normalizedMatch?.relations,
            latestRelease: normalizedMatch?.latestRelease,
            selectedReleases: normalizedMatch?.selectedReleases,
            releases: normalizedMatch?.releases,
            releaseVns: normalizedMatch?.releaseVns
          }
        })
      )
      await window.api.vndb.syncUserData(
        matchableGames.map(getVndbUserDataSyncTarget)
      )
      onMatchesChange?.(updatedMatches)
      closeDialog()
    } catch (err) {
      console.error(err)
      setError(t('vndb.sync.error.save', 'Unable to sync VNDB matches.'))
    } finally {
      setSyncing(false)
    }
  }

  async function syncStoredUserData() {
    setRefreshingMatches(true)
    setError(null)

    try {
      await window.api.vndb.syncUserData(
        matchableGames.map(getVndbUserDataSyncTarget)
      )
    } catch (err) {
      console.error(err)
      setError(
        t('vndb.sync.error.sync-data', 'Unable to sync existing VNDB data.')
      )
    } finally {
      setRefreshingMatches(false)
    }
  }

  const pickerSuggestion = suggestions.find(
    (suggestion) =>
      getMatchKey({
        appName: suggestion.game.appName,
        runner: suggestion.game.runner
      }) === pickerGameKey
  )
  const pickerResultSections = useMemo(
    () => getPickerResultSections(pickerResults),
    [pickerResults]
  )
  const pickerSelectedReleaseIds = useMemo(
    () =>
      new Set(
        getResultSelectedReleases(
          pickerGameKey ? selectedMatches[pickerGameKey] : undefined
        ).map((release) => release.id)
      ),
    [pickerGameKey, selectedMatches]
  )

  return (
    <>
      {!hideTrigger && (
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
      )}

      {open && (
        <Dialog
          onClose={closeDialog}
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
                        {t('button.done', 'Done')}
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
                          onClick={() => void selectPickerResult(null)}
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
                              ({ result, isPinnedMain, isNewestRelease }) => {
                                const isSelected =
                                  result.source === 'release' &&
                                  pickerSelectedReleaseIds.has(result.id)

                                return (
                                  <button
                                    className={[
                                      'vndbSyncPickerResult',
                                      isPinnedMain
                                        ? 'vndbSyncPickerResult--main'
                                        : '',
                                      isNewestRelease
                                        ? 'vndbSyncPickerResult--newest'
                                        : '',
                                      isSelected
                                        ? 'vndbSyncPickerResult--selected'
                                        : ''
                                    ]
                                      .filter(Boolean)
                                      .join(' ')}
                                    key={`${section.id}:${result.source}:${result.id}`}
                                    onClick={() =>
                                      void selectPickerResult(result)
                                    }
                                    aria-pressed={
                                      result.source === 'release'
                                        ? isSelected
                                        : undefined
                                    }
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
                                        {isSelected && (
                                          <span className="vndbSyncResultBadge vndbSyncResultBadge--selected">
                                            <FontAwesomeIcon icon={faCheck} />
                                            {t(
                                              'vndb.sync.selected',
                                              'Selected'
                                            )}
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
                                      {result.source === 'release' && (
                                        <VndbPlatforms
                                          platforms={result.platforms}
                                        />
                                      )}
                                    </span>
                                  </button>
                                )
                              }
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
                    const localGame = matchableGamesByKey.get(key)
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
            {syncVndbUserData && (
              <button
                className="button is-secondary"
                onClick={() => void syncStoredUserData()}
                disabled={loadingMatches || syncing || refreshingMatches}
              >
                {refreshingMatches ? (
                  <FontAwesomeIcon icon={faSpinner} spin />
                ) : (
                  <FontAwesomeIcon icon={faSyncAlt} />
                )}
                {t('vndb.sync.sync-existing-data', 'Sync existing data')}
              </button>
            )}
            <button
              className="button is-secondary"
              onClick={closeDialog}
              disabled={syncing || refreshingMatches}
            >
              {t('button.cancel', 'Cancel')}
            </button>
            <button
              className="button is-success"
              onClick={() => void syncMatches()}
              disabled={
                loadingMatches ||
                syncing ||
                refreshingMatches ||
                !suggestions.length
              }
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
