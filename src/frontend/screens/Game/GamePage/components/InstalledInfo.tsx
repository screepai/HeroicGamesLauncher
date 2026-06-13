import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import GameContext from '../../GameContext'
import type { GameInfo } from 'common/types'
import type { VndbRelease } from 'common/types/vndb'
import {
  getSelectedVndbRelease,
  getVndbPlatformsLabel
} from 'frontend/helpers/vndb'
import { ToggleSwitch } from 'frontend/components/UI'
import useSetting from 'frontend/hooks/useSetting'

interface Props {
  gameInfo: GameInfo
  onIsVisualNovelChange: (value: boolean) => void
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

const InstalledInfo = ({ gameInfo, onIsVisualNovelChange }: Props) => {
  const { t, i18n } = useTranslation('gamepage')
  const { t: t2 } = useTranslation()
  const { gameSettings, runner, is, vndbMatch } = useContext(GameContext)
  const [jpLocale, setJpLocale] = useSetting('jpLocale', false)

  if (!gameInfo.is_installed) {
    return null
  }

  if (!gameSettings) {
    return null
  }

  const isSideloaded = runner === 'sideload'
  const isThirdParty = !!gameInfo.thirdPartyManagedApp
  const visualNovelSetting = !isThirdParty ? (
    <ToggleSwitch
      htmlId="is-visual-novel"
      value={gameInfo.isVisualNovel}
      handleChange={() => {
        const isVisualNovel = !gameInfo.isVisualNovel
        window.api.setGameMetadataOverride({
          appName: gameInfo.app_name,
          title: gameInfo.overrides?.title,
          art_cover: gameInfo.overrides?.art_cover,
          art_square: gameInfo.overrides?.art_square,
          isVisualNovel
        })
        onIsVisualNovelChange(isVisualNovel)
      }}
      title={t('sideload.info.is-visual-novel', 'Is Visual Novel')}
      description={t(
        'sideload.info.is-visual-novel-description',
        'Identify this game as a visual novel.'
      )}
    />
  ) : null
  const selectedVndbRelease = vndbMatch
    ? getSelectedVndbRelease(vndbMatch)
    : undefined

  function getBooleanLabel(value: boolean | undefined) {
    if (value === undefined) {
      return ''
    }

    return value ? t('box.yes', 'Yes') : t('box.no', 'No')
  }

  function getReleaseFlagsLabel(release: VndbRelease): string {
    return [
      release.official !== undefined
        ? `${t('vndb.official', 'Official')}: ${getBooleanLabel(
            release.official
          )}`
        : '',
      release.patch !== undefined
        ? `${t('vndb.patch', 'Patch')}: ${getBooleanLabel(release.patch)}`
        : '',
      release.freeware !== undefined
        ? `${t('vndb.freeware', 'Freeware')}: ${getBooleanLabel(
            release.freeware
          )}`
        : ''
    ]
      .filter(Boolean)
      .join(', ')
  }

  const vndbReleaseLanguages = selectedVndbRelease
    ? getLanguageList(selectedVndbRelease.languages, i18n.language)
    : ''
  const vndbReleasePlatforms = selectedVndbRelease
    ? getVndbPlatformsLabel(selectedVndbRelease.platforms)
    : ''
  const vndbReleaseFlags = selectedVndbRelease
    ? getReleaseFlagsLabel(selectedVndbRelease)
    : ''
  const vndbReleaseInfo = selectedVndbRelease ? (
    <>
      <div>
        <b>{t('vndb.downloaded-version', 'Downloaded version')}:</b>{' '}
        {selectedVndbRelease.title}
      </div>
      <div>
        <b>{t('vndb.release-id', 'Release ID')}:</b> {selectedVndbRelease.id}
      </div>
      {selectedVndbRelease.released && (
        <div>
          <b>{t('vndb.release-date', 'Release date')}:</b>{' '}
          {selectedVndbRelease.released}
        </div>
      )}
      {vndbReleaseLanguages && (
        <div>
          <b>{t('vndb.release-languages', 'Release languages')}:</b>{' '}
          {vndbReleaseLanguages}
        </div>
      )}
      {vndbReleasePlatforms && (
        <div>
          <b>{t('vndb.platforms', 'Platforms')}:</b> {vndbReleasePlatforms}
        </div>
      )}
      {vndbReleaseFlags && (
        <div>
          <b>{t('vndb.release-flags', 'Release flags')}:</b> {vndbReleaseFlags}
        </div>
      )}
    </>
  ) : null

  const {
    install: { platform: installPlatform },
    canRunOffline,
    folder_name
  } = gameInfo

  if (installPlatform === 'Browser') {
    return (
      <>
        <div style={{ textTransform: 'capitalize' }}>
          <b>{t('info.installedPlatform', 'Installed Platform')}:</b>{' '}
          {installPlatform}
        </div>
        {visualNovelSetting}
        {vndbReleaseInfo}
      </>
    )
  }

  let install_path: string | undefined
  let install_size: string | undefined
  let version: string | undefined

  if (!isSideloaded) {
    install_path = gameInfo.install.install_path
    install_size = gameInfo.install.install_size
    version = gameInfo.install.version
  }

  const appLocation = install_path || folder_name

  const { wineVersion, winePrefix, wineCrossoverBottle } = gameSettings

  let wineName = ''
  let wineType = ''

  if (!is.win) {
    let wine = wineVersion.name.replace('Wine - ', '').replace('Proton - ', '')
    if (wine.includes('Default')) {
      wine = wine.split('-')[0]
    }
    wineName = wine
    wineType = wineVersion.type
  }

  const info = (
    <>
      {!isSideloaded && !isThirdParty && (
        <div>
          <b>{t('info.size')}:</b> {install_size}
        </div>
      )}
      <div style={{ textTransform: 'capitalize' }}>
        <b>{t('info.installedPlatform', 'Installed Platform')}:</b>{' '}
        {installPlatform === 'osx' ? 'MacOS' : installPlatform}
      </div>
      {!isSideloaded && !isThirdParty && (
        <div>
          <b>{t('info.version')}:</b> {version}
        </div>
      )}
      <div>
        <b>{t('info.canRunOffline', 'Online Required')}:</b>{' '}
        {t(canRunOffline ? 'box.no' : 'box.yes')}
      </div>
      {isThirdParty && (
        <div>
          <b>{t('info.third-party-app', 'Third-Party Manager')}</b>{' '}
          {gameInfo.isEAManaged ? 'EA app' : gameInfo.thirdPartyManagedApp}
        </div>
      )}
      {!isThirdParty && (
        <>
          {visualNovelSetting}
          <div
            className="clickable"
            onClick={() =>
              appLocation !== undefined
                ? window.api.openFolder(appLocation)
                : {}
            }
          >
            <b>{t('info.path')}:</b>{' '}
            <div className="truncatedPath">{appLocation}</div>
          </div>
          {is.win && (
            <ToggleSwitch
              htmlId="jp-locale"
              value={jpLocale}
              handleChange={() => setJpLocale(!jpLocale)}
              title={t('setting.jp-locale', 'JP locale')}
              description={t(
                'setting.jp-locale-description',
                'Launch this game through the configured Locale Emulator executable.'
              )}
            />
          )}
        </>
      )}
      {!is.win && !is.native && (
        <>
          <div>
            <b>Wine:</b> {wineName}
          </div>
          {wineType === 'crossover' ? (
            <div>
              <b>{t2('setting.winecrossoverbottle', 'Bottle')}:</b>{' '}
              <div>{wineCrossoverBottle}</div>
            </div>
          ) : (
            <div
              className="clickable"
              onClick={() => window.api.openFolder(winePrefix)}
            >
              <b>{t2('setting.wineprefix', 'WinePrefix')}:</b>{' '}
              <div className="truncatedPath">{winePrefix}</div>
            </div>
          )}
        </>
      )}
      {vndbReleaseInfo}
    </>
  )

  return info
}

export default InstalledInfo
