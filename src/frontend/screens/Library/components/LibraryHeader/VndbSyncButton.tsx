import {
  ArrowRight,
  Check,
  LoaderCircle,
  RefreshCw,
  Search
} from 'lucide-react'
import type { GameInfo } from 'common/types'
import type {
  VndbGameMatch,
  VndbGameMatchSuggestion,
  VndbRelease,
  VndbSearchResult,
  VndbUserDataSyncResult,
  VndbUserDataSyncTarget
} from 'common/types/vndb'
import {
  CachedImage,
  TextInputField,
  Alert,
  Badge,
  Button,
  ProgressBar
} from 'frontend/components/UI'
import { Tooltip } from '@mui/material'
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader
} from 'frontend/components/UI/Modal'
import fallbackImage from 'frontend/assets/heroic_card.jpg'
import {
  getGameVndbMatchKey,
  getVndbMatchKey,
  getVndbUserDataSyncTarget
} from 'common/vndb'
import { searchResultToMatchUpdate } from 'common/vndbMatchUpdate'
import {
  getVndbReleasesWithSelectedReleases,
  getVndbReleaseMainVisualNovelId,
  getVndbPlatformsLabel,
  hasVndbSelectionChanged,
  normalizeVndbSelectedMatch,
  sortVndbItemsByDate,
  sortVndbReleasesByDate,
  vndbMatchToSearchResult
} from 'frontend/helpers/vndb'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import useAppSetting from 'frontend/hooks/useAppSetting'

type Props = {
  list: GameInfo[]
  variant?: 'header' | 'icon'
  size?: 'sm' | 'md'
  onMatchesChange?: (matches: Record<string, VndbGameMatch>) => void
  autoOpen?: boolean
  hideTrigger?: boolean
  onClose?: () => void
}

type MatchState = Record<string, VndbSearchResult | null>

type JobProgress = {
  jobId: string
  kind: 'match' | 'sync'
  completed: number
  total: number
  cancelling: boolean
}

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

function getSelectedMatchFromStoredMatch(
  storedMatch: VndbGameMatch | undefined
): VndbSearchResult | null {
  if (!storedMatch) {
    return null
  }

  return vndbMatchToSearchResult(storedMatch)
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

// Picker selections are not stored yet, so the backend's stored-match
// hydration (`vndb.hydrateMatch`) cannot serve them; fetch the main visual
// novel of the chosen entry directly instead.
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

function VndbJobProgress({
  progress,
  onCancel
}: {
  progress: JobProgress
  onCancel: () => void
}) {
  const { t } = useTranslation()
  const { completed, total, kind, cancelling } = progress
  const label =
    kind === 'match'
      ? t(
          'vndb.sync.progress.matching',
          'Searching VNDB... {{completed}} / {{total}}',
          { completed, total }
        )
      : t(
          'vndb.sync.progress.syncing',
          'Syncing VNDB data... {{completed}} / {{total}}',
          { completed, total }
        )

  return (
    <div className="vndbSyncProgress">
      <div className="vndbSyncProgressHeader">
        <span>{label}</span>
        <Button
          variant="secondary"
          size="sm"
          onClick={onCancel}
          disabled={cancelling}
        >
          {cancelling
            ? t('vndb.sync.cancelling', 'Cancelling...')
            : t('button.cancel', 'Cancel')}
        </Button>
      </div>
      <ProgressBar
        value={total > 0 ? (completed / total) * 100 : undefined}
        label={label}
      />
    </div>
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
        <Search size={16} />
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
  size = 'md',
  onMatchesChange,
  autoOpen = false,
  hideTrigger = false,
  onClose
}: Props) {
  const { t, i18n } = useTranslation()
  const syncVndbUserData = useAppSetting('syncVndbUserData', true)
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
  const [notice, setNotice] = useState<string | null>(null)
  const [jobProgress, setJobProgress] = useState<JobProgress | null>(null)
  const autoOpenStarted = useRef(false)
  const activeJobId = useRef<string | null>(null)
  // Bumped on every load and on close, so a load that resumes after the
  // dialog was closed (or reopened) stops instead of starting a search.
  const loadToken = useRef(0)
  const storedMatches = useRef<Record<string, VndbGameMatch>>({})

  const matchableGames = useMemo(() => list.filter(isMatchableGame), [list])
  const matchableGamesByKey = useMemo(
    () =>
      new Map(
        matchableGames.map((game) => [getGameVndbMatchKey(game), game] as const)
      ),
    [matchableGames]
  )

  useEffect(() => {
    const updateProgress = (
      jobId: string | undefined,
      completed: number,
      total: number
    ) =>
      setJobProgress((current) =>
        current && current.jobId === jobId
          ? { ...current, completed, total }
          : current
      )
    const removeMatchListener = window.api.vndb.onMatchGamesProgress(
      (_event, progress) =>
        updateProgress(progress.jobId, progress.completed, progress.total)
    )
    const removeSyncListener = window.api.vndb.onSyncUserDataProgress(
      (_event, progress) =>
        updateProgress(progress.jobId, progress.completed, progress.total)
    )

    return () => {
      removeMatchListener()
      removeSyncListener()
    }
  }, [])

  const startJob = useCallback((kind: JobProgress['kind'], total: number) => {
    const jobId = `vndb-${kind}-${crypto.randomUUID()}`
    activeJobId.current = jobId
    setJobProgress({ jobId, kind, completed: 0, total, cancelling: false })
    return jobId
  }, [])

  const finishJob = useCallback((jobId: string) => {
    if (activeJobId.current === jobId) {
      activeJobId.current = null
    }
    setJobProgress((current) => (current?.jobId === jobId ? null : current))
  }, [])

  function cancelJob(job: JobProgress) {
    setJobProgress((current) =>
      current?.jobId === job.jobId ? { ...current, cancelling: true } : current
    )
    const cancel =
      job.kind === 'match'
        ? window.api.vndb.cancelMatchGames(job.jobId)
        : window.api.vndb.cancelSyncUserData(job.jobId)
    cancel.catch((err) => console.error(err))
  }

  async function runUserDataSync(
    targets: VndbUserDataSyncTarget[]
  ): Promise<VndbUserDataSyncResult> {
    const jobId = startJob('sync', targets.length)

    try {
      return await window.api.vndb.syncUserData(targets, { jobId })
    } finally {
      finishJob(jobId)
    }
  }

  const loadMatches = useCallback(async () => {
    setOpen(true)
    setLoadingMatches(true)
    setError(null)
    setNotice(null)
    setPickerGameKey(null)
    setPickerResults([])
    let jobId: string | undefined
    const token = ++loadToken.current

    try {
      const targets = matchableGames.map((game) => ({
        appName: game.app_name,
        runner: game.runner,
        title: getDisplayTitle(game)
      }))
      const currentStoredMatches = await window.api.vndb.getAllGameMatches()
      if (token !== loadToken.current) {
        return
      }
      storedMatches.current = currentStoredMatches
      const unmatchedTargets = targets.filter(
        (target) => !currentStoredMatches[getVndbMatchKey(target)]
      )
      let matchedSuggestions: VndbGameMatchSuggestion[] = []
      if (unmatchedTargets.length) {
        jobId = startJob('match', unmatchedTargets.length)
        matchedSuggestions = await window.api.vndb.matchGames(
          unmatchedTargets,
          { jobId }
        )
      }

      // The dialog was closed (or reopened) while searching.
      if (
        token !== loadToken.current ||
        (jobId && activeJobId.current !== jobId)
      ) {
        return
      }

      const matchedByKey = new Map(
        matchedSuggestions.map((suggestion) => [
          getVndbMatchKey(suggestion.game),
          suggestion
        ])
      )
      const nextSuggestions: VndbGameMatchSuggestion[] = targets.map((game) => {
        const matched = matchedByKey.get(getVndbMatchKey(game))
        return {
          game,
          result: matched?.result ?? null,
          error: matched?.error
        }
      })
      const nextSelectedMatches: MatchState = {}

      for (const suggestion of nextSuggestions) {
        const key = getVndbMatchKey(suggestion.game)
        nextSelectedMatches[key] =
          getSelectedMatchFromStoredMatch(currentStoredMatches[key]) ??
          suggestion.result
      }

      const notSearched = matchedSuggestions.filter(
        (suggestion) => suggestion.cancelled
      ).length
      if (notSearched > 0) {
        setNotice(
          t(
            'vndb.sync.matching-cancelled',
            'Matching cancelled. {{remaining}} game(s) were not searched; use "Search VNDB" to match them manually.',
            { remaining: notSearched }
          )
        )
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
      // Another search may have started after this dialog was closed.
      const superseded =
        token !== loadToken.current ||
        (activeJobId.current !== null && activeJobId.current !== jobId)
      if (jobId) {
        finishJob(jobId)
      }
      if (!superseded) {
        setLoadingMatches(false)
      }
    }
  }, [finishJob, matchableGames, startJob, t])

  useEffect(() => {
    if (autoOpen && !autoOpenStarted.current && matchableGames.length) {
      autoOpenStarted.current = true
      void loadMatches()
    }
  }, [autoOpen, loadMatches, matchableGames.length])

  function closeDialog() {
    if (jobProgress) {
      cancelJob(jobProgress)
    }
    loadToken.current++
    activeJobId.current = null
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
    const key = getVndbMatchKey({
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
    setNotice(null)

    try {
      const updates = []
      const changedTargets: VndbUserDataSyncTarget[] = []

      for (const suggestion of suggestions) {
        const key = getVndbMatchKey(suggestion.game)
        const normalizedMatch = normalizeVndbSelectedMatch(selectedMatches[key])
        updates.push(
          searchResultToMatchUpdate(suggestion.game, normalizedMatch)
        )

        const game = matchableGamesByKey.get(key)
        if (
          game &&
          hasVndbSelectionChanged(storedMatches.current[key], normalizedMatch)
        ) {
          changedTargets.push(getVndbUserDataSyncTarget(game))
        }
      }

      const updatedMatches = await window.api.vndb.syncGameMatches(updates)
      // Only games whose match actually changed need their VNDB list entry
      // updated; "Sync existing data" covers the full library.
      if (changedTargets.length) {
        await runUserDataSync(changedTargets)
      }
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
    setNotice(null)

    try {
      const result = await runUserDataSync(
        matchableGames.map((game) => getVndbUserDataSyncTarget(game))
      )
      if (result.cancelled) {
        setNotice(
          t(
            'vndb.sync.sync-cancelled',
            'VNDB data sync cancelled after {{synced}} game(s).',
            { synced: result.synced }
          )
        )
      } else if (result.errors.length > 0) {
        setError(
          t(
            'vndb.sync.error.sync-data-partial',
            '{{failed}} game(s) could not be synced with VNDB.',
            { failed: result.errors.length }
          )
        )
      }
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
      getVndbMatchKey({
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
      {!hideTrigger &&
        (variant === 'icon' ? (
          <button
            className="svg-button vndbSyncIcon"
            title={t('vndb.sync.title', 'Sync VNDB Titles')}
            onClick={() => void loadMatches()}
            disabled={!matchableGames.length}
          >
            <RefreshCw size={16} aria-hidden />
          </button>
        ) : (
          <Button
            variant="secondary"
            size={size}
            icon={<Search size={16} />}
            title={t('vndb.sync.title', 'Sync VNDB Titles')}
            onClick={() => void loadMatches()}
            disabled={!matchableGames.length}
          >
            {t('vndb.sync.button', 'VNDB')}
          </Button>
        ))}

      {open && (
        <Modal
          size="lg"
          onClose={closeDialog}
          showCloseButton
          className="VndbSyncDialog"
        >
          <ModalHeader>{t('vndb.sync.title', 'Sync VNDB Titles')}</ModalHeader>
          <ModalContent className="vndbSyncContent">
            {error && <Alert variant="warning">{error}</Alert>}
            {notice && <Alert variant="info">{notice}</Alert>}

            {jobProgress?.kind === 'sync' && (
              <VndbJobProgress
                progress={jobProgress}
                onCancel={() => cancelJob(jobProgress)}
              />
            )}

            {loadingMatches ? (
              <div className="vndbSyncLoading">
                <div className="vndbSyncLoadingStatus">
                  <LoaderCircle size={32} className="vndbSyncSpinner" />
                  <span>{t('vndb.sync.loading', 'Searching VNDB...')}</span>
                </div>
                {jobProgress?.kind === 'match' && (
                  <VndbJobProgress
                    progress={jobProgress}
                    onCancel={() => cancelJob(jobProgress)}
                  />
                )}
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
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setPickerGameKey(null)}
                      >
                        {t('button.done', 'Done')}
                      </Button>
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
                        <Button
                          variant="secondary"
                          icon={
                            pickerLoading ? (
                              <LoaderCircle
                                size={16}
                                className="vndbSyncSpinner"
                              />
                            ) : (
                              <Search size={16} />
                            )
                          }
                          onClick={() => void searchPicker()}
                          disabled={pickerLoading}
                        >
                          {t('button.search', 'Search')}
                        </Button>
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
                                          <Badge variant="success">Main</Badge>
                                        )}
                                        {isNewestRelease && (
                                          <Badge variant="accent">Newest</Badge>
                                        )}
                                        {isSelected && (
                                          <Badge
                                            variant="success"
                                            glyph={Check}
                                          >
                                            {t(
                                              'vndb.sync.selected',
                                              'Selected'
                                            )}
                                          </Badge>
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
                    const key = getVndbMatchKey({
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
                        <span className="vndbSyncArrow" aria-hidden>
                          <ArrowRight size={18} />
                        </span>
                        <VndbResultCard
                          result={selectedMatch}
                          onClick={() => openPicker(suggestion)}
                          emptyLabel={t(
                            'vndb.sync.search-manual',
                            'Search VNDB'
                          )}
                          locale={i18n.language}
                        />
                        {suggestion.error && !selectedMatch && (
                          <div className="vndbSyncRowError">
                            <Alert variant="warning">
                              {t(
                                'vndb.sync.error.match-game',
                                'Could not search VNDB for this game: {{message}}',
                                { message: suggestion.error }
                              )}
                            </Alert>
                          </div>
                        )}
                      </div>
                    )
                  })}
                </div>
              </>
            )}
          </ModalContent>
          <ModalFooter>
            {syncVndbUserData && (
              <Button
                variant="secondary"
                icon={
                  refreshingMatches ? (
                    <LoaderCircle size={16} className="vndbSyncSpinner" />
                  ) : (
                    <RefreshCw size={16} />
                  )
                }
                onClick={() => void syncStoredUserData()}
                disabled={loadingMatches || syncing || refreshingMatches}
              >
                {t('vndb.sync.sync-existing-data', 'Sync existing data')}
              </Button>
            )}
            <Button
              variant="secondary"
              onClick={closeDialog}
              disabled={syncing || refreshingMatches}
            >
              {t('button.cancel', 'Cancel')}
            </Button>
            <Button
              icon={
                syncing ? (
                  <LoaderCircle size={16} className="vndbSyncSpinner" />
                ) : (
                  <Check size={16} />
                )
              }
              onClick={() => void syncMatches()}
              disabled={
                loadingMatches ||
                syncing ||
                refreshingMatches ||
                !suggestions.length
              }
            >
              {t('button.confirm', 'Confirm')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </>
  )
}
