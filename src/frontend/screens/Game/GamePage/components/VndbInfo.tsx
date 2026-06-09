import type {
  VndbGameMatch,
  VndbRelation,
  VndbRelease,
  VndbReleaseVisualNovel,
  VndbUserOptions,
  VndbUserOptionsUpdate
} from 'common/types/vndb'
import { Tooltip } from '@mui/material'
import fallbackImage from 'frontend/assets/heroic_card.jpg'
import { CachedImage, WarningMessage } from 'frontend/components/UI'
import { createNewWindow } from 'frontend/helpers'
import {
  getSelectedVndbRelease,
  getVndbPlatformsLabel,
  getVndbReleasesWithSelectedRelease,
  sortVndbReleasesByDate
} from 'frontend/helpers/vndb'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  match: VndbGameMatch | null
  onMatchChange: (match: VndbGameMatch) => void
}

type MainVersionInfo = {
  id: string
  title: string
  imageUrl?: string
  detail?: string
}

type ReleaseOptionItem = {
  release: VndbRelease
  isNewestRelease: boolean
}

type ReleaseOptionSection = {
  id: string
  language: string
  items: ReleaseOptionItem[]
}

type VndbUserOptionsState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; options: VndbUserOptions }
  | { status: 'error'; message: string }

type Translate = (
  key: string,
  defaultValue: string,
  options?: Record<string, unknown>
) => string

const editableLabelDenylist = new Set([0, 7])
const voteOptions = Array.from({ length: 91 }, (_value, index) => 10 + index)

function getVndbUrl(id: string): string {
  return `https://vndb.org/${id}`
}

function getUniqueSortedValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  )
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

function getLanguageList(languages: string[], locale: string): string {
  return getUniqueSortedValues(languages)
    .map((language) => getLanguageLabel(language, locale))
    .join(', ')
}

function getRelationTitle(relation: VndbRelation): string {
  return `${relation.title} (${relation.relationLabel})`
}

function getMatchKey(match: Pick<VndbGameMatch, 'runner' | 'appName'>): string {
  return `${match.runner}:${match.appName}`
}

function getSortedReleases(match: VndbGameMatch): VndbRelease[] {
  const releases = new Map<string, VndbRelease>()

  for (const release of match.releases ?? []) {
    releases.set(release.id, release)
  }

  if (match.latestRelease) {
    releases.set(match.latestRelease.id, match.latestRelease)
  }

  return sortVndbReleasesByDate([...releases.values()])
}

function releasesNeedLanguageTitles(releases: VndbRelease[] | undefined) {
  return (
    releases?.some(
      (release) => release.languages.length && !release.languageTitles?.length
    ) ?? false
  )
}

function matchNeedsVisualNovelDetails(match: VndbGameMatch) {
  return (
    match.released === undefined ||
    match.developers === undefined ||
    match.rating === undefined ||
    match.lengthMinutes === undefined ||
    match.description === undefined ||
    match.tags === undefined
  )
}

function getReleaseOptionSections(
  releases: VndbRelease[]
): ReleaseOptionSection[] {
  const sections = new Map<string, ReleaseOptionSection>()

  releases.forEach((release) => {
    const languages = getUniqueSortedValues(release.languages)
    const releaseItem = {
      release,
      isNewestRelease: false
    }

    for (const language of languages.length ? languages : ['unknown']) {
      let section = sections.get(language)
      if (!section) {
        section = {
          id: language,
          language,
          items: []
        }
        sections.set(language, section)
      }
      section.items.push(releaseItem)
    }
  })

  return [...sections.values()]
    .map((section) => ({
      ...section,
      items: section.items.map((item, index) => ({
        ...item,
        isNewestRelease: index === 0
      }))
    }))
    .sort((left, right) => {
      if (left.id === 'unknown' || right.id === 'unknown') {
        return left.id === 'unknown' ? 1 : -1
      }

      return left.id.localeCompare(right.id)
    })
}

function getMainVersionInfo(match: VndbGameMatch): MainVersionInfo {
  if (match.source !== 'release') {
    return {
      id: match.vndbId,
      title: match.vndbTitle,
      imageUrl: match.imageUrl
    }
  }

  if (match.mainRelation) {
    return {
      id: match.mainRelation.id,
      title: match.mainRelation.title,
      imageUrl: match.mainRelation.imageUrl,
      detail: match.mainRelation.relationLabel
    }
  }

  const releaseVn = match.releaseVns?.[0]
  if (releaseVn) {
    return {
      id: releaseVn.id,
      title: releaseVn.title,
      imageUrl: releaseVn.imageUrl,
      detail: releaseVn.rtype
    }
  }

  return {
    id: match.vndbId,
    title: match.vndbTitle,
    imageUrl: match.imageUrl
  }
}

function getBooleanLabel(value: boolean | undefined, t: Translate) {
  if (value === undefined) {
    return ''
  }

  return value ? t('box.yes', 'Yes') : t('box.no', 'No')
}

function getVoteSelectValue(vote: number | null): string {
  if (vote === null) {
    return ''
  }

  return String(vote)
}

function getVoteFromSelectValue(value: string): number | null {
  if (!value.trim()) {
    return null
  }

  const parsed = Number(value)
  if (!Number.isFinite(parsed)) {
    return null
  }

  return Math.min(Math.max(Math.round(parsed), 10), 100)
}

function getEditableVndbLabels(options: VndbUserOptions) {
  return options.labels.filter((label) => !editableLabelDenylist.has(label.id))
}

function getSelectedVndbLabelId(options: VndbUserOptions): string {
  const editableLabelIds = new Set(
    getEditableVndbLabels(options).map(({ id }) => id)
  )
  const selectedLabelId = options.selectedLabelIds.find((labelId) =>
    editableLabelIds.has(labelId)
  )

  return selectedLabelId ? String(selectedLabelId) : ''
}

function getLabelsFromSelectValue(value: string): number[] {
  if (!value) {
    return []
  }

  return [Number(value)]
}

function getReleaseFlagsLabel(release: VndbRelease, t: Translate): string {
  return [
    release.official !== undefined
      ? `${t('vndb.official', 'Official')}: ${getBooleanLabel(
          release.official,
          t
        )}`
      : '',
    release.patch !== undefined
      ? `${t('vndb.patch', 'Patch')}: ${getBooleanLabel(release.patch, t)}`
      : '',
    release.freeware !== undefined
      ? `${t('vndb.freeware', 'Freeware')}: ${getBooleanLabel(
          release.freeware,
          t
        )}`
      : ''
  ]
    .filter(Boolean)
    .join(', ')
}

function getReleaseVnsLabel(release: VndbRelease): string {
  const [firstVn, ...otherVns] = release.vns

  if (!firstVn) {
    return ''
  }

  return [firstVn.title, otherVns.length ? `+${otherVns.length} more` : '']
    .filter(Boolean)
    .join(', ')
}

function getReleaseTitleForLanguage(
  release: VndbRelease,
  language: string
): string {
  if (language === 'unknown') {
    return release.title
  }

  const languageTitle = release.languageTitles?.find(
    (currentLanguage) => currentLanguage.lang === language
  )

  return languageTitle?.title || languageTitle?.latin || release.title
}

function VndbTooltipText({
  className,
  text
}: {
  className?: string
  text: string
}) {
  return (
    <Tooltip title={text} arrow placement="bottom-start">
      <span className={className}>{text}</span>
    </Tooltip>
  )
}

function VndbHeader({
  mainVersion,
  imageUrl
}: {
  mainVersion: MainVersionInfo
  imageUrl?: string
}) {
  return (
    <div className="vndbInfoHeader">
      <CachedImage
        className="vndbInfoImage"
        src={imageUrl || fallbackImage}
        fallback={fallbackImage}
      />
      <div className="vndbInfoTitle">
        <button
          className="vndbInfoLink"
          onClick={() => createNewWindow(getVndbUrl(mainVersion.id))}
        >
          {mainVersion.title}
        </button>
        <span>
          {mainVersion.id}
          {mainVersion.detail ? ` · ${mainVersion.detail}` : ''}
        </span>
      </div>
    </div>
  )
}

function VndbMainDetails({
  mainVersion,
  match,
  visualNovelLanguages
}: {
  mainVersion: MainVersionInfo
  match: VndbGameMatch
  visualNovelLanguages: string
}) {
  const { t } = useTranslation('gamepage')

  return (
    <div className="vndbInfoGrid">
      <div>
        <b>{t('vndb.entry-type', 'VNDB entry type')}</b>
        <span>
          {mainVersion.detail ?? t('vndb.visual-novel', 'Visual novel')}
        </span>
      </div>
      {visualNovelLanguages && (
        <div>
          <b>{t('vndb.vn-languages', 'VN languages')}</b>
          <span>{visualNovelLanguages}</span>
        </div>
      )}
      {match.mainRelation && match.mainRelation.id !== mainVersion.id && (
        <div>
          <b>{t('vndb.related-title', 'Related title')}</b>
          <button
            className="vndbInfoInlineLink"
            onClick={() => createNewWindow(getVndbUrl(match.mainRelation!.id))}
          >
            {getRelationTitle(match.mainRelation)}
          </button>
        </div>
      )}
      <div>
        <b>{t('vndb.synced-at', 'Synced')}</b>
        <span>{new Date(match.syncedAt).toLocaleString()}</span>
      </div>
    </div>
  )
}

function VndbReleaseCard({
  isNewestRelease,
  isSelected,
  language,
  mainVersion,
  onSelect,
  release,
  savingRelease
}: {
  isNewestRelease: boolean
  isSelected: boolean
  language: string
  mainVersion: MainVersionInfo
  onSelect: (release: VndbRelease) => void
  release: VndbRelease
  savingRelease: boolean
}) {
  const { t, i18n } = useTranslation('gamepage')
  const releaseLanguages = getLanguageList(release.languages, i18n.language)
  const releasePlatforms = getVndbPlatformsLabel(release.platforms)
  const releaseFlags = getReleaseFlagsLabel(release, t)
  const releaseVns = getReleaseVnsLabel(release)
  const releaseTitle = getReleaseTitleForLanguage(release, language)
  const releaseMeta = [release.id, release.released ? release.released : '']
    .filter(Boolean)
    .join(' - ')
  const rawReleaseTitle = `${t(
    'vndb.release-title',
    'Release title'
  )}: ${release.title}`

  return (
    <button
      className={[
        'vndbInfoReleaseOption',
        isSelected ? 'vndbInfoReleaseOption--selected' : '',
        isNewestRelease ? 'vndbInfoReleaseOption--newest' : ''
      ]
        .filter(Boolean)
        .join(' ')}
      disabled={savingRelease || isSelected}
      onClick={() => onSelect(release)}
      aria-pressed={isSelected}
    >
      <CachedImage
        className="vndbInfoReleaseOptionImage"
        src={release.imageUrl || mainVersion.imageUrl || fallbackImage}
        fallback={fallbackImage}
      />
      <span className="vndbInfoReleaseOptionBody">
        <VndbTooltipText
          className="vndbInfoReleaseOptionTitle"
          text={releaseTitle}
        />
        <VndbTooltipText
          className="vndbInfoReleaseOptionMeta"
          text={releaseMeta}
        />
        <span className="vndbInfoReleaseBadges">
          {isSelected && (
            <span className="vndbInfoReleaseBadge vndbInfoReleaseBadge--selected">
              {t('vndb.selected-release', 'Selected')}
            </span>
          )}
          {isNewestRelease && (
            <span className="vndbInfoReleaseBadge vndbInfoReleaseBadge--newest">
              {t('vndb.newest-release', 'Newest')}
            </span>
          )}
        </span>
        <VndbTooltipText text={rawReleaseTitle} />
        {releaseLanguages && (
          <VndbTooltipText
            text={`${t('vndb.release-languages', 'Release languages')}: ${releaseLanguages}`}
          />
        )}
        {releasePlatforms && (
          <VndbTooltipText
            text={`${t('vndb.platforms', 'Platforms')}: ${releasePlatforms}`}
          />
        )}
        {releaseFlags && <VndbTooltipText text={releaseFlags} />}
        {releaseVns && (
          <VndbTooltipText
            text={`${t('vndb.included-vns', 'Included visual novels')}: ${releaseVns}`}
          />
        )}
      </span>
    </button>
  )
}

function VndbReleaseChooser({
  mainVersion,
  onSelect,
  releaseOptionSections,
  releaseOptions,
  savingRelease,
  selectedRelease
}: {
  mainVersion: MainVersionInfo
  onSelect: (release: VndbRelease) => void
  releaseOptionSections: ReleaseOptionSection[]
  releaseOptions: VndbRelease[]
  savingRelease: boolean
  selectedRelease: VndbRelease
}) {
  const { t, i18n } = useTranslation('gamepage')

  if (releaseOptions.length <= 1) {
    return null
  }

  return (
    <section className="vndbInfoSection">
      <h3>{t('vndb.release-selector', 'Downloaded release selector')}</h3>
      <div
        className="vndbInfoReleaseSections"
        aria-label={t('vndb.release-selector', 'Downloaded release selector')}
      >
        {releaseOptionSections.map((section) => (
          <section className="vndbInfoReleaseSection" key={section.id}>
            <h4>
              {t('vndb.release-section-language', '{{language}} releases', {
                language: getLanguageLabel(section.language, i18n.language)
              })}
            </h4>
            <div className="vndbInfoReleaseList">
              {section.items.map(({ release, isNewestRelease }) => (
                <VndbReleaseCard
                  isNewestRelease={isNewestRelease}
                  isSelected={release.id === selectedRelease.id}
                  key={`${section.id}:${release.id}`}
                  language={section.language}
                  mainVersion={mainVersion}
                  onSelect={onSelect}
                  release={release}
                  savingRelease={savingRelease}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </section>
  )
}

function VndbIncludedVisualNovels({
  includedVns
}: {
  includedVns: VndbReleaseVisualNovel[]
}) {
  const { t } = useTranslation('gamepage')

  if (!includedVns.length) {
    return null
  }

  return (
    <section className="vndbInfoSection">
      <h3>{t('vndb.included-vns', 'Included visual novels')}</h3>
      <ul>
        {includedVns.map((vn) => (
          <li key={vn.id}>
            <button
              className="vndbInfoInlineLink"
              onClick={() => createNewWindow(getVndbUrl(vn.id))}
            >
              {vn.title}
            </button>
            {vn.rtype && <span>{vn.rtype}</span>}
          </li>
        ))}
      </ul>
    </section>
  )
}

function VndbRelations({ relations }: { relations: VndbRelation[] }) {
  const { t } = useTranslation('gamepage')

  if (!relations.length) {
    return null
  }

  return (
    <section className="vndbInfoSection">
      <h3>{t('vndb.relations', 'Relations')}</h3>
      <ul>
        {relations.map((relation) => (
          <li key={`${relation.id}:${relation.relation}`}>
            <button
              className="vndbInfoInlineLink"
              onClick={() => createNewWindow(getVndbUrl(relation.id))}
            >
              {relation.title}
            </button>
            <span>{relation.relationLabel}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

function VndbUserOptionsSection({
  mainVersion,
  onChange,
  state
}: {
  mainVersion: MainVersionInfo
  onChange: (update: VndbUserOptionsUpdate) => Promise<void>
  state: VndbUserOptionsState
}) {
  const { t } = useTranslation('gamepage')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)

  if (!mainVersion.id.startsWith('v')) {
    return null
  }

  if (state.status === 'ready' && !state.options.hasToken) {
    return null
  }

  async function save(update: VndbUserOptionsUpdate) {
    setSaving(true)
    setSaveError(null)

    try {
      await onChange(update)
    } catch (error) {
      console.error(error)
      setSaveError(
        t('vndb.user-options-save-error', 'Unable to save VNDB user options.')
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <section className="vndbInfoSection vndbInfoUserOptions">
      <h3>{t('vndb.my-list', 'My VNDB list')}</h3>

      {state.status === 'loading' && (
        <span className="vndbInfoMuted">
          {t('vndb.user-options-loading', 'Loading VNDB list options...')}
        </span>
      )}

      {state.status === 'error' && (
        <WarningMessage>{state.message}</WarningMessage>
      )}

      {state.status === 'ready' &&
        state.options.hasToken &&
        !state.options.canRead && (
          <WarningMessage>
            {t(
              'vndb.user-options-listread-missing',
              'Your VNDB API token needs the listread permission to load labels and votes.'
            )}
          </WarningMessage>
        )}

      {state.status === 'ready' && state.options.canRead && (
        <>
          {saveError && <WarningMessage>{saveError}</WarningMessage>}

          <div className="vndbInfoUserOptionsControls">
            <label className="vndbInfoVoteControl">
              <span>{t('vndb.vote', 'Vote')}</span>
              <select
                disabled={saving || !state.options.canWrite}
                key={state.options.vote ?? 'empty'}
                onChange={(event) => {
                  const vote = getVoteFromSelectValue(event.currentTarget.value)
                  if (vote !== state.options.vote) {
                    void save({ vote })
                  }
                }}
                value={getVoteSelectValue(state.options.vote)}
              >
                <option value="">{t('vndb.no-vote', 'No vote')}</option>
                {voteOptions.map((vote) => (
                  <option key={vote} value={vote}>
                    {(vote / 10).toFixed(1)}
                  </option>
                ))}
              </select>
            </label>

            <label className="vndbInfoLabelOptions">
              <span>{t('vndb.labels', 'Labels')}</span>
              <select
                disabled={saving || !state.options.canWrite}
                onChange={(event) =>
                  void save({
                    labels: getLabelsFromSelectValue(event.currentTarget.value)
                  })
                }
                value={getSelectedVndbLabelId(state.options)}
              >
                <option value="">{t('vndb.no-label', 'No label')}</option>
                {getEditableVndbLabels(state.options).map((label) => (
                  <option key={label.id} value={label.id}>
                    {label.label}
                  </option>
                ))}
              </select>
            </label>
          </div>

          {!state.options.canWrite && (
            <WarningMessage>
              {t(
                'vndb.user-options-listwrite-missing',
                'Your VNDB API token needs the listwrite permission to edit labels and votes.'
              )}
            </WarningMessage>
          )}
        </>
      )}
    </section>
  )
}

export default function VndbInfo({ match, onMatchChange }: Props) {
  const { t, i18n } = useTranslation('gamepage')
  const [savingRelease, setSavingRelease] = useState(false)
  const [releaseSaveError, setReleaseSaveError] = useState<string | null>(null)
  const [userOptionsState, setUserOptionsState] =
    useState<VndbUserOptionsState>({ status: 'idle' })
  const userOptionsVnId = match ? getMainVersionInfo(match).id : ''

  useEffect(() => {
    const shouldHydrateReleases =
      (match?.releases?.length ?? 0) <= 1 ||
      releasesNeedLanguageTitles(match?.releases)
    const shouldHydrateDetails = match
      ? matchNeedsVisualNovelDetails(match)
      : false

    if (!match || (!shouldHydrateReleases && !shouldHydrateDetails)) {
      return
    }

    const selectedRelease = getSelectedVndbRelease(match)
    const mainVersion = getMainVersionInfo(match)
    if (!mainVersion.id.startsWith('v')) {
      return
    }

    let isMounted = true

    window.api.vndb
      .searchVisualNovels({
        query: mainVersion.id,
        limit: 1
      })
      .then(async ([mainResult]) => {
        if (
          !isMounted ||
          mainResult?.source !== 'visualNovel' ||
          mainResult.id !== mainVersion.id ||
          (!mainResult.releases?.length && !shouldHydrateDetails)
        ) {
          return
        }

        const releases = selectedRelease
          ? getVndbReleasesWithSelectedRelease(
              mainResult.releases,
              selectedRelease
            )
          : mainResult.releases
        const hasReleaseUpdate =
          releasesNeedLanguageTitles(match.releases) ||
          (releases?.length ?? 0) > (match.releases?.length ?? 0)

        if (!shouldHydrateDetails && !hasReleaseUpdate) {
          return
        }

        const updatedMatches = await window.api.vndb.syncGameMatches([
          {
            appName: match.appName,
            runner: match.runner,
            title: match.title,
            vndbId: mainResult.id,
            vndbTitle: mainResult.title,
            aliases: mainResult.aliases,
            source: 'visualNovel',
            imageUrl: mainResult.imageUrl,
            released: mainResult.released,
            average: mainResult.average,
            rating: mainResult.rating,
            votecount: mainResult.votecount,
            length: mainResult.length,
            lengthMinutes: mainResult.lengthMinutes,
            lengthVotes: mainResult.lengthVotes,
            description: mainResult.description,
            tags: mainResult.tags,
            developers: mainResult.developers,
            languages: mainResult.languages,
            mainRelation: mainResult.mainRelation,
            relations: mainResult.relations,
            latestRelease:
              selectedRelease ??
              match.latestRelease ??
              mainResult.latestRelease,
            releases,
            releaseVns:
              selectedRelease?.vns ?? match.releaseVns ?? mainResult.releaseVns
          }
        ])

        if (isMounted) {
          onMatchChange(updatedMatches[getMatchKey(match)])
        }
      })
      .catch((error) => {
        console.error(error)
      })

    return () => {
      isMounted = false
    }
  }, [match, onMatchChange])

  useEffect(() => {
    if (!userOptionsVnId.startsWith('v')) {
      setUserOptionsState({ status: 'idle' })
      return
    }

    let isMounted = true
    setUserOptionsState({ status: 'loading' })

    window.api.vndb
      .getUserOptions({ vnId: userOptionsVnId })
      .then((options) => {
        if (isMounted) {
          setUserOptionsState({ status: 'ready', options })
        }
      })
      .catch((error) => {
        console.error(error)
        if (isMounted) {
          setUserOptionsState({
            status: 'error',
            message: t(
              'vndb.user-options-load-error',
              'Unable to load VNDB user options.'
            )
          })
        }
      })

    return () => {
      isMounted = false
    }
  }, [userOptionsVnId, t])

  if (!match) {
    return null
  }

  const visualNovelLanguages =
    match.source === 'release'
      ? ''
      : getLanguageList(match.languages ?? [], i18n.language)
  const selectedRelease = getSelectedVndbRelease(match)
  const releaseOptions = getSortedReleases(match)
  const releaseOptionSections = getReleaseOptionSections(releaseOptions)
  const includedVns = selectedRelease?.vns ?? match.releaseVns ?? []
  const relations = match.relations ?? []
  const mainVersion = getMainVersionInfo(match)

  async function handleSelectedReleaseChange(release: VndbRelease) {
    if (!match || release.id === selectedRelease?.id) {
      return
    }

    setSavingRelease(true)
    setReleaseSaveError(null)

    try {
      const nextMatch = {
        ...match,
        latestRelease: release,
        releaseVns: release.vns
      }
      const updatedMatches = await window.api.vndb.syncGameMatches([
        {
          appName: match.appName,
          runner: match.runner,
          title: match.title,
          vndbId: match.vndbId,
          vndbTitle: match.vndbTitle,
          aliases: match.aliases,
          source: match.source,
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
          developers: match.developers,
          languages: match.languages,
          mainRelation: match.mainRelation,
          relations: match.relations,
          latestRelease: release,
          releases: match.releases,
          releaseVns: release.vns
        }
      ])

      onMatchChange(updatedMatches[getMatchKey(match)] ?? nextMatch)
    } catch (error) {
      console.error(error)
      setReleaseSaveError(
        t('vndb.release-save-error', 'Unable to save selected VNDB release.')
      )
    } finally {
      setSavingRelease(false)
    }
  }

  async function handleUserOptionsChange(update: VndbUserOptionsUpdate) {
    if (!mainVersion.id.startsWith('v')) {
      return
    }

    const options = await window.api.vndb.updateUserOptions({
      vnId: mainVersion.id,
      update
    })
    setUserOptionsState({ status: 'ready', options })
  }

  return (
    <div className="vndbInfo">
      {releaseSaveError && <WarningMessage>{releaseSaveError}</WarningMessage>}

      <VndbHeader
        mainVersion={mainVersion}
        imageUrl={
          mainVersion.imageUrl ||
          match.imageUrl ||
          selectedRelease?.imageUrl ||
          fallbackImage
        }
      />

      <VndbMainDetails
        mainVersion={mainVersion}
        match={match}
        visualNovelLanguages={visualNovelLanguages}
      />

      <VndbUserOptionsSection
        mainVersion={mainVersion}
        onChange={handleUserOptionsChange}
        state={userOptionsState}
      />

      {selectedRelease && (
        <VndbReleaseChooser
          mainVersion={mainVersion}
          onSelect={(release) => void handleSelectedReleaseChange(release)}
          releaseOptionSections={releaseOptionSections}
          releaseOptions={releaseOptions}
          savingRelease={savingRelease}
          selectedRelease={selectedRelease}
        />
      )}

      <VndbIncludedVisualNovels includedVns={includedVns} />
      <VndbRelations relations={relations} />
    </div>
  )
}
