import { useTranslation } from 'react-i18next'
import {
  Bell,
  BookOpen,
  Download,
  FolderCog,
  Gamepad2,
  Globe,
  Monitor,
  ShieldCheck
} from 'lucide-react'
import LanguageSelector from 'frontend/components/UI/LanguageSelector'
import { ThemeSelector } from 'frontend/components/UI/ThemeSelector'
import { SettingsCard } from 'frontend/components/UI'
import {
  AutoUpdateGames,
  AutoVndbSyncNewGames,
  CheckUpdatesOnStartup,
  DefaultInstallPath,
  DiscordRPC,
  HideChangelogOnStartup,
  LibraryTopSection,
  LocalLibrarySyncPath,
  LocaleEmulatorPath,
  MaxRecentGames,
  MaxWorkers,
  MinimizeOnGameLaunch,
  Shortcuts,
  StartInConsoleMode,
  TraySettings,
  UseDarkTrayIcon,
  UseFramelessWindow,
  VndbFeatureSettings,
  VndbLabelCategorySync,
  WinePrefixesBasePath,
  PlaytimeSync,
  AnalyticsOptIn,
  BackupSaves
} from '../../components'

export default function GeneralSettings() {
  const { t } = useTranslation()

  return (
    <div className="settingsSections generalSettings">
      <SettingsCard
        glyph={Monitor}
        title={t('settings.section.appearance', 'Appearance')}
      >
        <ThemeSelector />
        <UseFramelessWindow />
        <LibraryTopSection />
        <MaxRecentGames />
      </SettingsCard>

      <SettingsCard
        glyph={Globe}
        title={t('settings.section.language', 'Language & region')}
      >
        <LanguageSelector />
      </SettingsCard>

      <SettingsCard
        glyph={FolderCog}
        title={t('settings.section.locations', 'Locations')}
      >
        <DefaultInstallPath />
        <LocaleEmulatorPath />
        <LocalLibrarySyncPath />
        <WinePrefixesBasePath />
      </SettingsCard>

      <SettingsCard
        glyph={Download}
        title={t('settings.section.downloads', 'Downloads')}
      >
        <AutoUpdateGames />
        <CheckUpdatesOnStartup />
        <MaxWorkers />
      </SettingsCard>

      <SettingsCard
        glyph={Gamepad2}
        title={t('settings.section.gameplay', 'Gameplay')}
      >
        <MinimizeOnGameLaunch />
        <PlaytimeSync />
        <BackupSaves />
        <Shortcuts />
      </SettingsCard>

      <SettingsCard glyph={Bell} title={t('settings.section.system', 'System')}>
        <TraySettings />
        <UseDarkTrayIcon />
        <StartInConsoleMode />
        <HideChangelogOnStartup />
      </SettingsCard>

      <SettingsCard
        glyph={BookOpen}
        title={t('settings.section.visual-novels', 'Visual novels')}
      >
        <VndbFeatureSettings />
        <VndbLabelCategorySync />
        <AutoVndbSyncNewGames />
      </SettingsCard>

      <SettingsCard
        glyph={ShieldCheck}
        title={t('settings.section.privacy', 'Privacy')}
      >
        <DiscordRPC />
        <AnalyticsOptIn />
      </SettingsCard>
    </div>
  )
}
