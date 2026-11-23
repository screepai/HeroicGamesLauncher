import { Children, ReactNode, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import {
  FolderOpen,
  HardDrive,
  MonitorPlay,
  Package,
  Tag as TagGlyph,
  Wifi,
  Wine
} from 'lucide-react'
import { GameInfo } from 'common/types'
import { DetailList, Panel, ToggleSwitch } from 'frontend/components/UI'
import type { DetailItem } from 'frontend/components/UI/DetailList'
import GameContext from '../../GameContext'
import { useCloudSaveDetail } from './CloudSavesSync'
import SteamDlcList from './SteamDlcList'
import type { VndbRelease } from 'common/types/vndb'
import {
  getSelectedVndbReleases,
  getVndbPlatformsLabel
} from 'frontend/helpers/vndb'
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
  const cloudSave = useCloudSaveDetail(gameInfo)

  if (!gameInfo.is_installed || !gameSettings) {
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
  const selectedVndbReleases = vndbMatch
    ? getSelectedVndbReleases(vndbMatch)
    : []

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

  // Fork toggles sit outside a SettingsCard, so group them to get the same
  // row spacing and dividers as upstream settings rows.
  function renderToggles(...toggles: ReactNode[]) {
    const visible = toggles.filter(Boolean)
    if (!visible.length) return null
    return (
      <div className="installationInfoToggles">{Children.toArray(visible)}</div>
    )
  }

  const vndbReleaseInfo = selectedVndbReleases.length ? (
    <section className="installationInfoReleases">
      <h3 className="installationInfoSubtitle">
        {t('vndb.downloaded-releases-title', 'Downloaded releases')}
      </h3>
      {selectedVndbReleases.map((release) => {
        const languages = getLanguageList(release.languages, i18n.language)
        const platforms = getVndbPlatformsLabel(release.platforms)
        const flags = getReleaseFlagsLabel(release)

        const releaseItems: DetailItem[] = [
          {
            label: t('vndb.downloaded-version', 'Downloaded version'),
            value: release.title
          },
          { label: t('vndb.release-id', 'Release ID'), value: release.id }
        ]
        if (release.released) {
          releaseItems.push({
            label: t('vndb.release-date', 'Release date'),
            value: release.released
          })
        }
        if (languages) {
          releaseItems.push({
            label: t('vndb.release-languages', 'Release languages'),
            value: languages
          })
        }
        if (platforms) {
          releaseItems.push({
            label: t('vndb.platforms', 'Platforms'),
            value: platforms
          })
        }
        if (flags) {
          releaseItems.push({
            label: t('vndb.release-flags', 'Release flags'),
            value: flags
          })
        }

        return <DetailList key={release.id} items={releaseItems} columns={2} />
      })}
    </section>
  ) : null

  const {
    install: { platform: installPlatform },
    canRunOffline,
    folder_name
  } = gameInfo

  const items: DetailItem[] = []

  if (installPlatform === 'Browser') {
    items.push({
      glyph: MonitorPlay,
      label: t('info.installedPlatform', 'Installed platform'),
      value: installPlatform
    })

    return (
      <Panel tone="glass" className="installationInfo">
        <DetailList items={items} columns={2} />
        {renderToggles(visualNovelSetting)}
        {vndbReleaseInfo}
      </Panel>
    )
  }

  const install_path = isSideloaded ? undefined : gameInfo.install.install_path
  const install_size = isSideloaded ? undefined : gameInfo.install.install_size
  const version = isSideloaded ? undefined : gameInfo.install.version
  const appLocation = install_path || folder_name

  if (!isSideloaded && !isThirdParty && install_size) {
    items.push({
      glyph: HardDrive,
      label: t('info.size'),
      value: install_size
    })
  }

  items.push({
    glyph: MonitorPlay,
    label: t('info.installedPlatform', 'Installed platform'),
    value: installPlatform === 'osx' ? 'macOS' : installPlatform
  })

  if (!isSideloaded && !isThirdParty && version) {
    items.push({
      glyph: TagGlyph,
      label: t('info.version'),
      value: version
    })
  }

  items.push({
    glyph: Wifi,
    label: t('info.canRunOffline', 'Online Required'),
    value: t(canRunOffline ? 'box.no' : 'box.yes')
  })

  if (isThirdParty) {
    items.push({
      glyph: Package,
      label: t('info.third-party-app', 'Third-Party Manager'),
      value: gameInfo.isEAManaged ? 'EA app' : gameInfo.thirdPartyManagedApp
    })
  } else if (appLocation) {
    items.push({
      glyph: FolderOpen,
      label: t('info.path'),
      value: <span className="truncatedPath">{appLocation}</span>,
      title: t('info.clickToOpen', 'Click to open'),
      onClick: () => window.api.openFolder(appLocation)
    })
  }

  if (!is.win && !is.native) {
    const { wineVersion, winePrefix, wineCrossoverBottle } = gameSettings
    let wineName = wineVersion.name
      .replace('Wine - ', '')
      .replace('Proton - ', '')
    if (wineName.includes('Default')) {
      wineName = wineName.split('-')[0]
    }

    items.push({ glyph: Wine, label: 'Wine', value: wineName })

    if (wineVersion.type === 'crossover') {
      items.push({
        glyph: Wine,
        label: t2('setting.winecrossoverbottle', 'Bottle'),
        value: wineCrossoverBottle
      })
    } else {
      items.push({
        glyph: FolderOpen,
        label: t2('setting.wineprefix', 'WinePrefix'),
        value: <span className="truncatedPath">{winePrefix}</span>,
        title: t('info.clickToOpen', 'Click to open'),
        onClick: () => window.api.openFolder(winePrefix)
      })
    }
  }

  if (cloudSave.item) {
    items.push(cloudSave.item)
  }

  return (
    <Panel tone="glass" className="installationInfo">
      <DetailList items={items} columns={2} />
      {runner === 'steam' && <SteamDlcList appName={gameInfo.app_name} />}
      {cloudSave.menu}
      {renderToggles(
        visualNovelSetting,
        !isThirdParty && (is.win || is.linux) && (
          <ToggleSwitch
            htmlId="jp-locale"
            value={jpLocale}
            handleChange={() => setJpLocale(!jpLocale)}
            title={t('setting.jp-locale', 'JP locale')}
            description={t(
              is.win
                ? 'setting.jp-locale-description'
                : 'setting.jp-locale-linux-description',
              is.win
                ? 'Launch this game through the configured Locale Emulator executable.'
                : 'Set a Japanese locale and the Asia/Tokyo timezone when launching this game.'
            )}
          />
        )
      )}
      {vndbReleaseInfo}
    </Panel>
  )
}

export default InstalledInfo
