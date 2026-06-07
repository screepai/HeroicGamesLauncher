import type {
  VndbGameMatch,
  VndbRelation,
  VndbRelease,
  VndbReleaseVisualNovel
} from 'common/types/vndb'
import { Tooltip } from '@mui/material'
import fallbackImage from 'frontend/assets/heroic_card.jpg'
import { CachedImage, WarningMessage } from 'frontend/components/UI'
import { createNewWindow } from 'frontend/helpers'
import {
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
  released?: string | null
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

type Translate = (
  key: string,
  defaultValue: string,
  options?: Record<string, unknown>
) => string

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
      imageUrl: match.imageUrl,
      released: match.released
    }
  }

  if (match.mainRelation) {
    return {
      id: match.mainRelation.id,
      title: match.mainRelation.title,
      imageUrl: match.mainRelation.imageUrl,
      released: match.mainRelation.released,
      detail: match.mainRelation.relationLabel
    }
  }

  const releaseVn = match.releaseVns?.[0]
  if (releaseVn) {
    return {
      id: releaseVn.id,
      title: releaseVn.title,
      imageUrl: releaseVn.imageUrl,
      released: releaseVn.released,
      detail: releaseVn.rtype
    }
  }

  return {
    id: match.vndbId,
    title: match.vndbTitle,
    imageUrl: match.imageUrl,
    released: match.released
  }
}

function getSelectedRelease(match: VndbGameMatch): VndbRelease | undefined {
  if (match.latestRelease) {
    return match.latestRelease
  }

  if (match.source !== 'release') {
    return undefined
  }

  return {
    id: match.vndbId,
    title: match.vndbTitle,
    imageUrl: match.imageUrl,
    released: match.released,
    languages: match.languages ?? [],
    platforms: [],
    vns: match.releaseVns ?? []
  }
}

function getBooleanLabel(value: boolean | undefined, t: Translate) {
  if (value === undefined) {
    return ''
  }

  return value ? t('box.yes', 'Yes') : t('box.no', 'No')
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
  const developers = getUniqueSortedValues(match.developers ?? []).join(', ')

  return (
    <div className="vndbInfoGrid">
      <div>
        <b>{t('vndb.entry-type', 'VNDB entry type')}</b>
        <span>
          {mainVersion.detail ?? t('vndb.visual-novel', 'Visual novel')}
        </span>
      </div>
      {mainVersion.released && (
        <div>
          <b>{t('vndb.released', 'Released')}</b>
          <span>{mainVersion.released}</span>
        </div>
      )}
      {developers && (
        <div>
          <b>{t('vndb.developers', 'Developers')}</b>
          <span>{developers}</span>
        </div>
      )}
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
  const releaseLanguages = getLanguageList(
    selectedRelease.languages,
    i18n.language
  )
  const platforms = getVndbPlatformsLabel(selectedRelease.platforms)
  const selectedReleaseFlags = getReleaseFlagsLabel(selectedRelease, t)

  return (
    <section className="vndbInfoSection">
      <h3>{t('vndb.downloaded-release', 'Downloaded release')}</h3>
      {releaseOptions.length > 1 && (
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
      )}
      <div className="vndbInfoGrid">
        <div>
          <b>{t('vndb.downloaded-version', 'Downloaded version')}</b>
          <span>{selectedRelease.title}</span>
        </div>
        <div>
          <b>{t('vndb.release-id', 'Release ID')}</b>
          <span>{selectedRelease.id}</span>
        </div>
        {selectedRelease.released && (
          <div>
            <b>{t('vndb.release-date', 'Release date')}</b>
            <span>{selectedRelease.released}</span>
          </div>
        )}
        {releaseLanguages && (
          <div>
            <b>{t('vndb.release-languages', 'Release languages')}</b>
            <span>{releaseLanguages}</span>
          </div>
        )}
        {platforms && (
          <div>
            <b>{t('vndb.platforms', 'Platforms')}</b>
            <span>{platforms}</span>
          </div>
        )}
        {selectedReleaseFlags && (
          <div>
            <b>{t('vndb.release-flags', 'Release flags')}</b>
            <span>{selectedReleaseFlags}</span>
          </div>
        )}
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

export default function VndbInfo({ match, onMatchChange }: Props) {
  const { t, i18n } = useTranslation('gamepage')
  const [savingRelease, setSavingRelease] = useState(false)
  const [releaseSaveError, setReleaseSaveError] = useState<string | null>(null)

  useEffect(() => {
    const shouldHydrateReleases =
      (match?.releases?.length ?? 0) <= 1 ||
      releasesNeedLanguageTitles(match?.releases)

    if (!match || !shouldHydrateReleases) {
      return
    }

    const selectedRelease = getSelectedRelease(match)
    const mainVersion = getMainVersionInfo(match)
    if (!selectedRelease || !mainVersion.id.startsWith('v')) {
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
          !mainResult.releases?.length
        ) {
          return
        }

        const releases = getVndbReleasesWithSelectedRelease(
          mainResult.releases,
          selectedRelease
        )
        if (
          releases.length <= (match.releases?.length ?? 0) &&
          !releasesNeedLanguageTitles(match.releases)
        ) {
          return
        }

        const updatedMatches = await window.api.vndb.syncGameMatches([
          {
            appName: match.appName,
            runner: match.runner,
            title: match.title,
            vndbId: mainResult.id,
            vndbTitle: mainResult.title,
            source: 'visualNovel',
            imageUrl: mainResult.imageUrl,
            released: mainResult.released,
            developers: mainResult.developers,
            languages: mainResult.languages,
            mainRelation: mainResult.mainRelation,
            relations: mainResult.relations,
            latestRelease: selectedRelease,
            releases,
            releaseVns: selectedRelease.vns
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

  if (!match) {
    return null
  }

  const visualNovelLanguages =
    match.source === 'release'
      ? ''
      : getLanguageList(match.languages ?? [], i18n.language)
  const selectedRelease = getSelectedRelease(match)
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
          source: match.source,
          imageUrl: match.imageUrl,
          released: match.released,
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
