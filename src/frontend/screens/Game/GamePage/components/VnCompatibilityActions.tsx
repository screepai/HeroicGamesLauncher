import './VnCompatibilityActions.css'

import { useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameInfo, Status } from 'common/types'
import type { VnCompatibilityResult } from 'common/types/vnCompatibility'
import { isWindowsPlatform } from 'common/utils'
import { WarningMessage } from 'frontend/components/UI'
import useAppSetting from 'frontend/hooks/useAppSetting'
import { isDefaultWinePrefix } from 'frontend/helpers/winePrefix'
import useGlobalState from 'frontend/state/GlobalStateV2'
import GameContext from '../../GameContext'
import SpecialCodecSetupDialog from './SpecialCodecSetupDialog'
import VnCompatibilityEntry, {
  type CodecActionState
} from './VnCompatibilityEntry'

type CodecSetup = {
  codecs: string[]
  prefixTemplate: string
}

type Props = {
  gameInfo: GameInfo
  result: VnCompatibilityResult
}

const codecBlockingStatuses = new Set<Status>([
  'installing',
  'importing',
  'updating',
  'launching',
  'playing',
  'uninstalling',
  'repairing',
  'moving',
  'queued',
  'syncing-saves',
  'redist',
  'extracting',
  'winetricks'
])
function getCodecActionState({
  hasPrefix,
  isWindowsGame,
  usesSharedPrefix,
  busy
}: {
  hasPrefix: boolean
  isWindowsGame: boolean
  usesSharedPrefix: boolean
  busy: boolean
}): CodecActionState {
  if (!hasPrefix || !isWindowsGame) return 'hidden'
  if (usesSharedPrefix) return 'shared-prefix'
  if (busy) return 'busy'
  return 'ready'
}

export default function VnCompatibilityActions({ gameInfo, result }: Props) {
  const { t } = useTranslation('gamepage')
  const { gameSettings, status } = useContext(GameContext)
  const sharedWinePrefix = useAppSetting('sharedWinePrefix', '')
  const defaultWinePrefix = useAppSetting('winePrefix', '')
  const { openGameSettingsModal } = useGlobalState.keys('openGameSettingsModal')
  const [codecSetup, setCodecSetup] = useState<CodecSetup | null>(null)
  const currentPrefix = gameInfo.is_installed
    ? gameSettings?.winePrefix.trim()
    : ''
  const usesSharedPrefix = Boolean(
    currentPrefix &&
    isDefaultWinePrefix(currentPrefix, [sharedWinePrefix, defaultWinePrefix])
  )
  const operationBusy = Boolean(status && codecBlockingStatuses.has(status))
  const codecAction = getCodecActionState({
    hasPrefix: Boolean(currentPrefix),
    isWindowsGame: isWindowsPlatform(gameInfo.install.platform),
    usesSharedPrefix,
    busy: operationBusy || Boolean(codecSetup)
  })

  function openWineSettings() {
    localStorage.setItem(`${gameInfo.app_name}-setting_tab`, 'wine')
    openGameSettingsModal(gameInfo)
  }

  function openCodecSetup(prefixTemplate: string, codecs: string[]) {
    setCodecSetup((current) => current ?? { prefixTemplate, codecs })
  }

  return (
    <>
      {currentPrefix && (
        <section className="vnCompatibilityCurrentPrefix">
          <h3>
            {t(
              'compatibility.heroic-prefix-title',
              'Current Heroic Wine prefix'
            )}
          </h3>
          <p>
            {t(
              'compatibility.heroic-prefix-description',
              'VNWiki names a recipe above; Heroic applies it to this configured per-game prefix.'
            )}
          </p>
          <code title={currentPrefix}>{currentPrefix}</code>
          {usesSharedPrefix && (
            <WarningMessage>
              {t(
                'compatibility.shared-prefix-warning',
                'This is Heroic’s shared prefix. Choose a dedicated prefix for this game before installing codecs so other games are not modified.'
              )}
            </WarningMessage>
          )}
          <div className="vnCompatibilityPrefixActions">
            {usesSharedPrefix && (
              <button
                className="button is-primary"
                onClick={openWineSettings}
                disabled={operationBusy}
              >
                {t(
                  'compatibility.create-separate-prefix-settings',
                  'Create separate prefix in settings'
                )}
              </button>
            )}
            <button
              className="button is-secondary"
              onClick={() => window.api.showItemInFolder(currentPrefix)}
            >
              {t('compatibility.open-prefix-folder', 'Open prefix folder')}
            </button>
            {!usesSharedPrefix && (
              <button
                className="button is-secondary"
                onClick={openWineSettings}
              >
                {t('compatibility.change-prefix', 'Change in game settings')}
              </button>
            )}
          </div>
        </section>
      )}
      <div className="vnCompatibilityEntries">
        {result.entries.map((entry) => (
          <VnCompatibilityEntry
            key={`${entry.title}:${entry.winePrefix}:${entry.wineVersion}`}
            entry={entry}
            prefixSetup={result.prefixSetups[entry.winePrefix]}
            codecAction={codecAction}
            onInstallCodecs={openCodecSetup}
          />
        ))}
      </div>
      {codecSetup && currentPrefix && (
        <SpecialCodecSetupDialog
          codecs={codecSetup.codecs}
          currentPrefix={currentPrefix}
          gameInfo={gameInfo}
          prefixTemplate={codecSetup.prefixTemplate}
          onClose={() => setCodecSetup(null)}
        />
      )}
    </>
  )
}
