import type {
  VndbGameMatch,
  VndbRelation,
  VndbRelease,
  VndbReleaseVisualNovel,
  VndbUserOptions,
  VndbUserOptionsUpdate
} from 'common/types/vndb'
import type { GameInfo, VndbLabelCategorySyncMode } from 'common/types'
import { Tooltip } from '@mui/material'
import fallbackImage from 'frontend/assets/heroic_card.jpg'
import { Disc3, Layers, Link2, ListChecks } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import {
  CachedImage,
  ToggleSwitch,
  Alert,
  Badge,
  Button,
  DetailList,
  Icon,
  Panel,
  SettingRow
} from 'frontend/components/UI'
import type { DetailItem } from 'frontend/components/UI/DetailList'
import {
  Modal,
  ModalContent,
  ModalFooter,
  ModalHeader
} from 'frontend/components/UI/Modal'
import { createNewWindow } from 'frontend/helpers'
import useAppSetting, {
  APP_SETTING_CHANGED_EVENT
} from 'frontend/hooks/useAppSetting'
import {
  getNextVndbLabelIds,
  getPrimaryVndbLabel,
  getVndbCategorySyncPlan
} from 'common/vndbCategorySync'
import { getVndbMatchKey, getVndbUserDataSyncTarget } from 'common/vndb'
import { searchResultToMatchUpdate } from 'common/vndbMatchUpdate'
import useVndbUserOptions from 'frontend/hooks/useVndbUserOptions'
import type { VndbUserOptionsState } from 'frontend/hooks/useVndbUserOptions'
import ContextProvider from 'frontend/state/ContextProvider'
import {
  getSelectedVndbRelease,
  getSelectedVndbReleases,
  getVndbPlatformsLabel,
  sortVndbReleasesByDate,
  vndbMatchToSearchResult
} from 'frontend/helpers/vndb'
import {
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'

interface Props {
  gameInfo: GameInfo
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

type PendingCategorySync = {
  fromCategory?: string
  toCategory?: string
  nextLabel?: string
}

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

function getSortedReleases(match: VndbGameMatch): VndbRelease[] {
  const releases = new Map<string, VndbRelease>()

  for (const release of match.releases ?? []) {
    releases.set(release.id, release)
  }

  for (const release of getSelectedVndbReleases(match)) {
    releases.set(release.id, release)
  }

  return sortVndbReleasesByDate([...releases.values()])
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

function getSelectedVndbLabel(options: VndbUserOptions) {
  return getPrimaryVndbLabel(
    getEditableVndbLabels(options),
    options.selectedLabelIds
  )
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

function getUniqueReleaseVns(
  releases: VndbRelease[]
): VndbReleaseVisualNovel[] {
  const visualNovels = new Map<string, VndbReleaseVisualNovel>()

  for (const release of releases) {
    for (const visualNovel of release.vns) {
      visualNovels.set(visualNovel.id, visualNovel)
    }
  }

  return [...visualNovels.values()]
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

function VndbSection({
  children,
  className,
  glyph,
  title
}: {
  children: ReactNode
  className?: string
  glyph: LucideIcon
  title: string
}) {
  return (
    <Panel
      tone="glass"
      className={['vndbInfoSection', className].filter(Boolean).join(' ')}
    >
      <h3 className="extraTab__title">
        <Icon glyph={glyph} size="sm" />
        {title}
      </h3>
      {children}
    </Panel>
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
        <Button
          variant="link"
          className="vndbInfoLink"
          onClick={() => createNewWindow(getVndbUrl(mainVersion.id))}
        >
          {mainVersion.title}
        </Button>
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
  const mainRelation = match.mainRelation

  const items: DetailItem[] = [
    {
      label: t('vndb.entry-type', 'VNDB entry type'),
      value: mainVersion.detail ?? t('vndb.visual-novel', 'Visual novel')
    }
  ]
  if (visualNovelLanguages) {
    items.push({
      label: t('vndb.vn-languages', 'VN languages'),
      value: visualNovelLanguages
    })
  }
  if (mainRelation && mainRelation.id !== mainVersion.id) {
    items.push({
      label: t('vndb.related-title', 'Related title'),
      value: (
        <Button
          variant="link"
          onClick={() => createNewWindow(getVndbUrl(mainRelation.id))}
        >
          {getRelationTitle(mainRelation)}
        </Button>
      )
    })
  }
  items.push({
    label: t('vndb.synced-at', 'Synced'),
    value: new Date(match.syncedAt).toLocaleString()
  })

  return <DetailList items={items} columns={2} />
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
      disabled={savingRelease}
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
            <Badge variant="accent">
              {t('vndb.selected-release', 'Selected')}
            </Badge>
          )}
          {isNewestRelease && (
            <Badge variant="success">
              {t('vndb.newest-release', 'Newest')}
            </Badge>
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
  selectedReleaseIds
}: {
  mainVersion: MainVersionInfo
  onSelect: (release: VndbRelease) => void
  releaseOptionSections: ReleaseOptionSection[]
  releaseOptions: VndbRelease[]
  savingRelease: boolean
  selectedReleaseIds: Set<string>
}) {
  const { t, i18n } = useTranslation('gamepage')

  if (releaseOptions.length <= 1) {
    return null
  }

  return (
    <VndbSection
      glyph={Disc3}
      title={t('vndb.release-selector', 'Downloaded release selector')}
    >
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
                  isSelected={selectedReleaseIds.has(release.id)}
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
    </VndbSection>
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
    <VndbSection
      glyph={Layers}
      title={t('vndb.included-vns', 'Included visual novels')}
    >
      <ul>
        {includedVns.map((vn) => (
          <li key={vn.id}>
            <Button
              variant="link"
              className="vndbInfoInlineLink"
              onClick={() => createNewWindow(getVndbUrl(vn.id))}
            >
              {vn.title}
            </Button>
            {vn.rtype && <span>{vn.rtype}</span>}
          </li>
        ))}
      </ul>
    </VndbSection>
  )
}

function VndbRelations({ relations }: { relations: VndbRelation[] }) {
  const { t } = useTranslation('gamepage')

  if (!relations.length) {
    return null
  }

  return (
    <VndbSection glyph={Link2} title={t('vndb.relations', 'Relations')}>
      <ul>
        {relations.map((relation) => (
          <li key={`${relation.id}:${relation.relation}`}>
            <Button
              variant="link"
              className="vndbInfoInlineLink"
              onClick={() => createNewWindow(getVndbUrl(relation.id))}
            >
              {relation.title}
            </Button>
            <span>{relation.relationLabel}</span>
          </li>
        ))}
      </ul>
    </VndbSection>
  )
}

function VndbUserOptionsSection({
  mainVersion,
  onChange,
  onResyncDates,
  state,
  syncEnabled
}: {
  mainVersion: MainVersionInfo
  onChange: (update: VndbUserOptionsUpdate) => Promise<void>
  onResyncDates: () => Promise<void>
  state: VndbUserOptionsState
  syncEnabled: boolean
}) {
  const { t } = useTranslation('gamepage')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [startDate, setStartDate] = useState('')
  const [finishDate, setFinishDate] = useState('')
  const savedStartDate =
    state.status === 'ready' ? (state.options.started ?? '') : ''
  const savedFinishDate =
    state.status === 'ready' ? (state.options.finished ?? '') : ''
  const editableLabels =
    state.status === 'ready' ? getEditableVndbLabels(state.options) : []
  const hasSelectedLabel =
    state.status === 'ready' &&
    editableLabels.some((label) =>
      state.options.selectedLabelIds.includes(label.id)
    )

  useEffect(() => {
    setStartDate(savedStartDate)
    setFinishDate(savedFinishDate)
  }, [savedFinishDate, savedStartDate])

  if (!mainVersion.id.startsWith('v')) {
    return null
  }

  if (state.status === 'ready' && !state.options.hasToken) {
    return null
  }

  async function save(update: VndbUserOptionsUpdate): Promise<boolean> {
    setSaving(true)
    setSaveError(null)

    try {
      await onChange(update)
      return true
    } catch (error) {
      console.error(error)
      setSaveError(
        error instanceof Error
          ? error.message
          : t(
              'vndb.user-options-save-error',
              'Unable to save VNDB user options.'
            )
      )
      return false
    } finally {
      setSaving(false)
    }
  }

  async function saveDate(
    field: 'started' | 'finished',
    value: string
  ): Promise<void> {
    const setDate = field === 'started' ? setStartDate : setFinishDate
    const savedDate = field === 'started' ? savedStartDate : savedFinishDate

    setDate(value)
    if (value === savedDate) {
      return
    }

    const saved = await save(
      field === 'started'
        ? { started: value || null }
        : { finished: value || null }
    )
    if (!saved) {
      setDate(savedDate)
    }
  }

  async function resyncDates() {
    setSaving(true)
    setSaveError(null)

    try {
      await onResyncDates()
    } catch (error) {
      console.error(error)
      setSaveError(
        error instanceof Error
          ? error.message
          : t('vndb.user-dates-sync-error', 'Unable to resync VNDB dates.')
      )
    } finally {
      setSaving(false)
    }
  }

  return (
    <VndbSection
      className="vndbInfoUserOptions"
      glyph={ListChecks}
      title={t('vndb.my-list', 'My VNDB list')}
    >
      {state.status === 'loading' && (
        <span className="vndbInfoMuted">
          {t('vndb.user-options-loading', 'Loading VNDB list options...')}
        </span>
      )}

      {state.status === 'error' && (
        <Alert variant="warning">{state.message}</Alert>
      )}

      {state.status === 'ready' &&
        state.options.hasToken &&
        !state.options.canRead && (
          <Alert variant="warning">
            {t(
              'vndb.user-options-listread-missing',
              'Your VNDB API token needs the listread permission to load labels and votes.'
            )}
          </Alert>
        )}

      {state.status === 'ready' && state.options.canRead && (
        <>
          {saveError && <Alert variant="warning">{saveError}</Alert>}

          <div className="vndbInfoUserOptionsControls">
            <div className="vndbInfoUserDates">
              <SettingRow
                layout="stacked"
                label={t('vndb.start-date', 'Start date')}
                htmlFor="vndb-start-date"
              >
                <input
                  id="vndb-start-date"
                  disabled={saving || !state.options.canWrite}
                  max="2099-12-31"
                  min="1970-01-01"
                  onChange={(event) =>
                    void saveDate('started', event.currentTarget.value)
                  }
                  type="date"
                  value={startDate}
                />
              </SettingRow>
              <SettingRow
                layout="stacked"
                label={t('vndb.finish-date', 'Finish date')}
                htmlFor="vndb-finish-date"
              >
                <input
                  id="vndb-finish-date"
                  disabled={saving || !state.options.canWrite}
                  max="2099-12-31"
                  min="1970-01-01"
                  onChange={(event) =>
                    void saveDate('finished', event.currentTarget.value)
                  }
                  type="date"
                  value={finishDate}
                />
              </SettingRow>
              <Button
                variant="secondary"
                size="sm"
                className="vndbInfoResyncDates"
                disabled={saving || !state.options.canWrite || !syncEnabled}
                onClick={() => void resyncDates()}
              >
                {t('vndb.resync-dates', 'Resync dates')}
              </Button>
            </div>

            <SettingRow
              layout="stacked"
              label={t('vndb.vote', 'Vote')}
              htmlFor="vndb-vote"
              className="vndbInfoVoteControl"
            >
              <select
                id="vndb-vote"
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
            </SettingRow>

            <SettingRow
              layout="stacked"
              label={t('vndb.labels', 'Labels')}
              className="vndbInfoLabelOptions"
            >
              <div className="vndbInfoLabelChoices">
                {!hasSelectedLabel && (
                  <span className="vndbInfoMuted">
                    {t('vndb.no-label', 'No label')}
                  </span>
                )}
                {editableLabels.map((label) => {
                  const selected = state.options.selectedLabelIds.includes(
                    label.id
                  )

                  return (
                    <label
                      className={`vndbInfoLabelChoice${
                        selected ? ' is-selected' : ''
                      }`}
                      key={label.id}
                    >
                      <input
                        checked={selected}
                        disabled={saving || !state.options.canWrite}
                        onChange={(event) =>
                          void save({
                            labels: getNextVndbLabelIds({
                              selectedLabelIds: state.options.selectedLabelIds,
                              labelId: label.id,
                              selected: event.currentTarget.checked
                            })
                          })
                        }
                        type="checkbox"
                      />
                      <span>{label.label}</span>
                    </label>
                  )
                })}
              </div>
            </SettingRow>
          </div>

          {!state.options.canWrite && (
            <Alert variant="warning">
              {t(
                'vndb.user-options-listwrite-missing',
                'Your VNDB API token needs the listwrite permission to edit labels, votes, and releases.'
              )}
            </Alert>
          )}
        </>
      )}
    </VndbSection>
  )
}

export default function VndbInfo({ gameInfo, match, onMatchChange }: Props) {
  const { t, i18n } = useTranslation('gamepage')
  const { customCategories } = useContext(ContextProvider)
  const syncVndbUserData = useAppSetting('syncVndbUserData', true)
  const configuredCategorySyncMode = useAppSetting(
    'vndbLabelCategorySyncMode',
    'ask'
  )
  const [pendingCategorySync, setPendingCategorySync] =
    useState<PendingCategorySync | null>(null)
  const [rememberCategorySync, setRememberCategorySync] = useState(false)
  const [savingRelease, setSavingRelease] = useState(false)
  const [releaseSaveError, setReleaseSaveError] = useState<string | null>(null)
  const userOptionsVnId = match ? getMainVersionInfo(match).id : ''
  const {
    state: userOptionsState,
    setOptions: setUserOptions,
    reload: reloadUserOptions
  } = useVndbUserOptions(userOptionsVnId)
  const userDataSyncTarget = useMemo(
    () => getVndbUserDataSyncTarget(gameInfo, false),
    [gameInfo]
  )
  const applyCategorySync = useCallback(
    ({ fromCategory, toCategory }: PendingCategorySync) => {
      customCategories.moveGame(
        fromCategory,
        toCategory,
        `${gameInfo.app_name}_${gameInfo.runner}`
      )
    },
    [customCategories, gameInfo.app_name, gameInfo.runner]
  )

  const handleLabelCategorySync = useCallback(
    (previousLabel: string | undefined, nextLabel: string | undefined) => {
      if (configuredCategorySyncMode === 'disabled') {
        return
      }

      const plan = getVndbCategorySyncPlan({
        categories: customCategories.listCategories(),
        categoryGames: customCategories.list,
        gameId: `${gameInfo.app_name}_${gameInfo.runner}`,
        previousLabel,
        nextLabel
      })
      if (!plan) {
        return
      }

      const pendingSync = { ...plan, nextLabel }
      if (configuredCategorySyncMode === 'automatic') {
        applyCategorySync(pendingSync)
        return
      }

      setRememberCategorySync(false)
      setPendingCategorySync(pendingSync)
    },
    [
      applyCategorySync,
      configuredCategorySyncMode,
      customCategories,
      gameInfo.app_name,
      gameInfo.runner
    ]
  )
  const syncVndbUserDates = useCallback(
    async ({ silent = false }: { silent?: boolean } = {}) => {
      if (!userOptionsVnId.startsWith('v')) {
        return
      }

      const result = await window.api.vndb.syncUserData([userDataSyncTarget])

      if (!result.hasToken || !result.canWrite || result.errors.length > 0) {
        if (!silent) {
          throw new Error(
            result.errors[0]?.message ??
              t('vndb.user-dates-sync-error', 'Unable to resync VNDB dates.')
          )
        }
        return
      }

      await reloadUserOptions()
    },
    [reloadUserOptions, t, userDataSyncTarget, userOptionsVnId]
  )

  if (!match) {
    return null
  }

  const visualNovelLanguages =
    match.source === 'release'
      ? ''
      : getLanguageList(match.languages ?? [], i18n.language)
  const selectedRelease = getSelectedVndbRelease(match)
  const selectedReleases = getSelectedVndbReleases(match)
  const selectedReleaseIds = new Set(
    selectedReleases.map((release) => release.id)
  )
  const releaseOptions = getSortedReleases(match)
  const releaseOptionSections = getReleaseOptionSections(releaseOptions)
  const includedVns = selectedReleases.length
    ? getUniqueReleaseVns(selectedReleases)
    : (match.releaseVns ?? [])
  const relations = match.relations ?? []
  const mainVersion = getMainVersionInfo(match)

  async function handleSelectedReleaseChange(release: VndbRelease) {
    if (!match) {
      return
    }

    const isSelected = selectedReleaseIds.has(release.id)
    const nextSelectedReleases = isSelected
      ? selectedReleases.filter(
          (selectedRelease) => selectedRelease.id !== release.id
        )
      : [...selectedReleases, release]
    const primaryRelease = nextSelectedReleases[0]
    setSavingRelease(true)
    setReleaseSaveError(null)

    try {
      if (
        syncVndbUserData &&
        userOptionsState.status === 'ready' &&
        userOptionsState.options.canWrite
      ) {
        await window.api.vndb.updateUserRelease({
          releaseId: release.id,
          selected: !isSelected
        })
      }

      const nextMatch = {
        ...match,
        latestRelease: primaryRelease,
        selectedReleases: nextSelectedReleases,
        releaseVns: primaryRelease?.vns
      }
      const updatedMatches = await window.api.vndb.syncGameMatches([
        searchResultToMatchUpdate(match, vndbMatchToSearchResult(match), {
          // The bridge fills defaults for fields a stored match may lack;
          // keep them as stored so hydration can still detect missing data.
          source: match.source,
          developers: match.developers,
          languages: match.languages,
          relations: match.relations,
          latestRelease: primaryRelease,
          selectedReleases: nextSelectedReleases,
          releaseVns: primaryRelease?.vns
        })
      ])

      onMatchChange(updatedMatches[getVndbMatchKey(match)] ?? nextMatch)
    } catch (error) {
      console.error(error)
      setReleaseSaveError(
        t('vndb.release-save-error', 'Unable to save selected VNDB releases.')
      )
    } finally {
      setSavingRelease(false)
    }
  }

  async function handleUserOptionsChange(update: VndbUserOptionsUpdate) {
    if (!mainVersion.id.startsWith('v')) {
      return
    }

    const previousLabel =
      userOptionsState.status === 'ready'
        ? getSelectedVndbLabel(userOptionsState.options)?.label
        : undefined
    const options = await window.api.vndb.updateUserOptions({
      vnId: mainVersion.id,
      update
    })
    setUserOptions(options)

    if (update.labels !== undefined) {
      handleLabelCategorySync(
        previousLabel,
        getSelectedVndbLabel(options)?.label
      )
    }
  }

  function confirmCategorySync() {
    if (!pendingCategorySync) {
      return
    }

    applyCategorySync(pendingCategorySync)
    if (rememberCategorySync) {
      const nextMode: VndbLabelCategorySyncMode = 'automatic'
      void window.api.setSetting({
        appName: 'default',
        key: 'vndbLabelCategorySyncMode',
        value: nextMode
      })
      window.dispatchEvent(
        new CustomEvent(APP_SETTING_CHANGED_EVENT, {
          detail: { key: 'vndbLabelCategorySyncMode', value: nextMode }
        })
      )
    }
    setPendingCategorySync(null)
  }

  return (
    <div className="vndbInfo">
      {releaseSaveError && <Alert variant="warning">{releaseSaveError}</Alert>}

      <Panel tone="glass" className="vndbInfoOverview">
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
      </Panel>

      <VndbUserOptionsSection
        mainVersion={mainVersion}
        onChange={handleUserOptionsChange}
        onResyncDates={() => syncVndbUserDates()}
        state={userOptionsState}
        syncEnabled={syncVndbUserData}
      />

      <VndbReleaseChooser
        mainVersion={mainVersion}
        onSelect={(release) => void handleSelectedReleaseChange(release)}
        releaseOptionSections={releaseOptionSections}
        releaseOptions={releaseOptions}
        savingRelease={savingRelease}
        selectedReleaseIds={selectedReleaseIds}
      />

      <VndbIncludedVisualNovels includedVns={includedVns} />
      <VndbRelations relations={relations} />

      {pendingCategorySync && (
        <Modal
          showCloseButton
          onClose={() => setPendingCategorySync(null)}
          className="vndbCategorySyncDialog"
          size="sm"
        >
          <ModalHeader>
            {t('vndb.category-sync.title', 'Update library category?')}
          </ModalHeader>
          <ModalContent>
            <p>
              {pendingCategorySync.fromCategory &&
              pendingCategorySync.toCategory
                ? t(
                    'vndb.category-sync.move',
                    'Move "{{title}}" from "{{fromCategory}}" to "{{toCategory}}" to match the VNDB label "{{label}}"?',
                    {
                      title: gameInfo.title,
                      fromCategory: pendingCategorySync.fromCategory,
                      toCategory: pendingCategorySync.toCategory,
                      label: pendingCategorySync.nextLabel
                    }
                  )
                : pendingCategorySync.toCategory
                  ? t(
                      'vndb.category-sync.add',
                      'Add "{{title}}" to "{{toCategory}}" to match the VNDB label "{{label}}"?',
                      {
                        title: gameInfo.title,
                        toCategory: pendingCategorySync.toCategory,
                        label: pendingCategorySync.nextLabel
                      }
                    )
                  : t(
                      'vndb.category-sync.remove',
                      'Remove "{{title}}" from "{{fromCategory}}" because it no longer has that VNDB label?',
                      {
                        title: gameInfo.title,
                        fromCategory: pendingCategorySync.fromCategory
                      }
                    )}
            </p>
            <ToggleSwitch
              htmlId="remember-vndb-category-sync"
              value={rememberCategorySync}
              handleChange={() =>
                setRememberCategorySync(!rememberCategorySync)
              }
              title={t(
                'vndb.category-sync.remember',
                "Remember this choice and don't ask again"
              )}
            />
          </ModalContent>
          <ModalFooter>
            <Button variant="primary" onClick={confirmCategorySync}>
              {t('box.yes', 'Yes')}
            </Button>
            <Button
              variant="secondary"
              onClick={() => setPendingCategorySync(null)}
            >
              {t('box.no', 'No')}
            </Button>
          </ModalFooter>
        </Modal>
      )}
    </div>
  )
}
