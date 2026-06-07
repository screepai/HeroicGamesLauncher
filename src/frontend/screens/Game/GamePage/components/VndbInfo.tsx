import type {
  VndbGameMatch,
  VndbRelation,
  VndbRelease
} from 'common/types/vndb'
import fallbackImage from 'frontend/assets/heroic_card.jpg'
import { CachedImage } from 'frontend/components/UI'
import { createNewWindow } from 'frontend/helpers'
import { useTranslation } from 'react-i18next'

interface Props {
  match: VndbGameMatch | null
}

type MainVersionInfo = {
  id: string
  title: string
  imageUrl?: string
  released?: string | null
  detail?: string
}

type Translate = (key: string, defaultValue: string) => string

function getVndbUrl(id: string): string {
  return `https://vndb.org/${id}`
}

function getUniqueSortedValues(values: string[]): string[] {
  return [...new Set(values.filter(Boolean))].sort((left, right) =>
    left.localeCompare(right)
  )
}

function getLanguageLabel(language: string, locale: string): string {
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

function getReleaseLanguages(match: VndbGameMatch): string[] {
  return getUniqueSortedValues(
    match.releases?.flatMap((release) => release.languages ?? []) ?? []
  )
}

function getPlatforms(match: VndbGameMatch): string[] {
  return getUniqueSortedValues(
    match.releases?.flatMap((release) => release.platforms ?? []) ??
      match.latestRelease?.platforms ??
      []
  )
}

function getRelationTitle(relation: VndbRelation): string {
  return `${relation.title} (${relation.relationLabel})`
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

export default function VndbInfo({ match }: Props) {
  const { t, i18n } = useTranslation('gamepage')

  if (!match) {
    return null
  }

  const visualNovelLanguages =
    match.source === 'release'
      ? ''
      : getLanguageList(match.languages ?? [], i18n.language)
  const selectedRelease = getSelectedRelease(match)
  const releaseLanguages = getLanguageList(
    selectedRelease?.languages ?? getReleaseLanguages(match),
    i18n.language
  )
  const platforms = getUniqueSortedValues(
    selectedRelease?.platforms ?? getPlatforms(match)
  ).join(', ')
  const includedVns = match.releaseVns ?? []
  const relations = match.relations ?? []
  const mainVersion = getMainVersionInfo(match)
  const mainVersionDetail =
    mainVersion.detail ?? t('vndb.visual-novel', 'Visual novel')
  const selectedReleaseFlags = [
    selectedRelease?.official !== undefined
      ? `${t('vndb.official', 'Official')}: ${getBooleanLabel(
          selectedRelease.official,
          t
        )}`
      : '',
    selectedRelease?.patch !== undefined
      ? `${t('vndb.patch', 'Patch')}: ${getBooleanLabel(selectedRelease.patch, t)}`
      : '',
    selectedRelease?.freeware !== undefined
      ? `${t('vndb.freeware', 'Freeware')}: ${getBooleanLabel(
          selectedRelease.freeware,
          t
        )}`
      : ''
  ]
    .filter(Boolean)
    .join(', ')

  return (
    <div className="vndbInfo">
      <div className="vndbInfoHeader">
        <CachedImage
          className="vndbInfoImage"
          src={
            mainVersion.imageUrl ||
            match.imageUrl ||
            selectedRelease?.imageUrl ||
            fallbackImage
          }
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
            {mainVersionDetail ? ` · ${mainVersionDetail}` : ''}
          </span>
        </div>
      </div>

      <div className="vndbInfoGrid">
        <div>
          <b>{t('vndb.main-version', 'Main version')}</b>
          <span>{mainVersionDetail}</span>
        </div>
        {mainVersion.released && (
          <div>
            <b>{t('vndb.released', 'Released')}</b>
            <span>{mainVersion.released}</span>
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
            <b>{t('vndb.main-story', 'Main story')}</b>
            <button
              className="vndbInfoInlineLink"
              onClick={() =>
                createNewWindow(getVndbUrl(match.mainRelation!.id))
              }
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

      {selectedRelease && (
        <section className="vndbInfoSection">
          <h3>{t('vndb.release-info', 'Release info')}</h3>
          <div className="vndbInfoGrid">
            <div>
              <b>{t('vndb.selected-release', 'Selected release')}</b>
              <button
                className="vndbInfoInlineLink"
                onClick={() => createNewWindow(getVndbUrl(selectedRelease.id))}
              >
                {selectedRelease.title}
              </button>
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
      )}

      {!!includedVns.length && (
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
      )}

      {!!relations.length && (
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
      )}
    </div>
  )
}
