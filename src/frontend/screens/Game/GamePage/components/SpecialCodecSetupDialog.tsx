import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameInfo } from 'common/types'
import { WarningMessage } from 'frontend/components/UI'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from 'frontend/components/UI/Dialog'

const specialCodecsSourceUrl = 'https://github.com/b-fission/vn_winestuff'

type Props = {
  codecs: string[]
  currentPrefix: string
  gameInfo: GameInfo
  prefixTemplate: string
  onClose: () => void
}

type InstallState = 'confirming' | 'installing' | 'done' | 'error'

export default function SpecialCodecSetupDialog({
  codecs,
  currentPrefix,
  gameInfo,
  prefixTemplate,
  onClose
}: Props) {
  const { t } = useTranslation('gamepage')
  const [installState, setInstallState] = useState<InstallState>('confirming')
  const [messages, setMessages] = useState<string[]>([])
  const installRequested = useRef(false)
  const isInstalling = installState === 'installing'

  useEffect(() => {
    return window.api.vnCompatibility.onCodecProgress((_event, progress) => {
      if (
        progress.appName !== gameInfo.app_name ||
        progress.runner !== gameInfo.runner
      ) {
        return
      }
      setMessages((current) => [...current, ...progress.messages].slice(-250))
    })
  }, [gameInfo.app_name, gameInfo.runner])

  async function installCodecs() {
    if (installRequested.current) return

    installRequested.current = true
    setInstallState('installing')
    setMessages([])
    try {
      const result = await window.api.vnCompatibility.installCodecs({
        appName: gameInfo.app_name,
        runner: gameInfo.runner,
        codecs
      })
      if (result.status === 'done') {
        setInstallState('done')
        setMessages((current) => [
          ...current,
          t(
            'compatibility.codecs-install-complete',
            'Special Codecs installation completed.'
          )
        ])
        return
      }
      setInstallState('error')
      setMessages((current) => [...current, `ERROR: ${result.error}`])
    } catch (error) {
      setInstallState('error')
      setMessages((current) => [...current, `ERROR: ${String(error)}`])
    }
  }

  return (
    <Dialog
      className="SpecialCodecSetupDialog"
      onClose={isInstalling ? () => null : onClose}
      showCloseButton={!isInstalling}
    >
      <DialogHeader>
        {t(
          'compatibility.install-codecs-title',
          'Set up codecs with vn_winestuff'
        )}
      </DialogHeader>
      <DialogContent className="specialCodecSetupContent">
        <p>
          {t(
            'compatibility.install-codecs-description',
            'Run vn_winestuff to install {{codecs}} into this game’s Wine prefix for the VNWiki {{template}} recipe.',
            { codecs: codecs.join(', '), template: prefixTemplate }
          )}
        </p>
        <dl>
          <div>
            <dt>{t('compatibility.heroic-prefix', 'Heroic Wine prefix')}</dt>
            <dd title={currentPrefix}>{currentPrefix}</dd>
          </div>
          <div>
            <dt>{t('compatibility.special-codecs', 'Special Codecs')}</dt>
            <dd>{codecs.join(', ')}</dd>
          </div>
        </dl>
        {installState === 'confirming' && (
          <WarningMessage>
            {t(
              'compatibility.install-codecs-warning',
              'This modifies the Wine prefix and downloads third-party Windows components. Heroic uses a commit-pinned, integrity-checked VNWiki helper, but you should still back up saves stored inside this prefix first.'
            )}
          </WarningMessage>
        )}
        {installState !== 'confirming' && (
          <pre className="specialCodecSetupLog" aria-live="polite">
            {messages.join('\n') ||
              t('compatibility.codecs-preparing', 'Preparing installation…')}
          </pre>
        )}
        <button
          className="vnCompatibilitySource"
          onClick={() => window.api.openExternalUrl(specialCodecsSourceUrl)}
          disabled={isInstalling}
        >
          {t('compatibility.open-codecs-source', 'Review helper source')}
        </button>
      </DialogContent>
      <DialogFooter>
        <button
          className="button is-secondary"
          onClick={onClose}
          disabled={isInstalling}
        >
          {installState === 'confirming'
            ? t('compatibility.cancel', 'Cancel')
            : t('button.close', 'Close')}
        </button>
        {installState === 'confirming' && (
          <button
            className="button is-danger"
            onClick={() => void installCodecs()}
          >
            {t('compatibility.install-codecs', 'Run vn_winestuff')}
          </button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
