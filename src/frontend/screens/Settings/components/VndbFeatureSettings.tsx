import { ToggleSwitch } from 'frontend/components/UI'
import useSetting from 'frontend/hooks/useSetting'
import { useTranslation } from 'react-i18next'

export default function VndbFeatureSettings() {
  const { t } = useTranslation()
  const [enableVndbIntegration, setEnableVndbIntegration] = useSetting(
    'enableVndbIntegration',
    true
  )
  const [syncVndbUserData, setSyncVndbUserData] = useSetting(
    'syncVndbUserData',
    false
  )
  const [discordRPC] = useSetting('discordRPC', false)
  const [showVndbActionsOnGameCards, setShowVndbActionsOnGameCards] =
    useSetting('showVndbActionsOnGameCards', true)
  const [useVndbDiscordRichPresence, setUseVndbDiscordRichPresence] =
    useSetting('useVndbDiscordRichPresence', true)

  return (
    <>
      <ToggleSwitch
        htmlId="enableVndbIntegration"
        value={enableVndbIntegration}
        handleChange={() => setEnableVndbIntegration(!enableVndbIntegration)}
        title={t('setting.enableVndbIntegration', 'Enable VNDB integration')}
        description={t(
          'setting.enableVndbIntegration-description',
          'Enable VNDB matching, metadata, cover search, and synchronization features.'
        )}
      />
      <ToggleSwitch
        htmlId="syncVndbUserData"
        value={syncVndbUserData}
        disabled={!enableVndbIntegration}
        handleChange={() => setSyncVndbUserData(!syncVndbUserData)}
        title={t(
          'setting.syncVndbUserData',
          'Sync play dates and releases to VNDB'
        )}
        description={t(
          'setting.syncVndbUserData-description',
          'Allow Heroic to write detected start and finish dates and selected releases to your VNDB account.'
        )}
      />
      <ToggleSwitch
        htmlId="showVndbActionsOnGameCards"
        value={showVndbActionsOnGameCards}
        disabled={!enableVndbIntegration}
        handleChange={() =>
          setShowVndbActionsOnGameCards(!showVndbActionsOnGameCards)
        }
        title={t(
          'setting.showVndbActionsOnGameCards',
          'Show VNDB actions on game cards'
        )}
      />
      <ToggleSwitch
        htmlId="useVndbDiscordRichPresence"
        value={useVndbDiscordRichPresence}
        disabled={!enableVndbIntegration || !discordRPC}
        handleChange={() =>
          setUseVndbDiscordRichPresence(!useVndbDiscordRichPresence)
        }
        title={t(
          'setting.useVndbDiscordRichPresence',
          'Use VNDB details in Discord Rich Presence'
        )}
      />
    </>
  )
}
