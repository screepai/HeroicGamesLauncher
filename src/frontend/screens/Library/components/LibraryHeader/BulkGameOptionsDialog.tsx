import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameInfo, GameSettings } from 'common/types'
import { ToggleSwitch, WarningMessage } from 'frontend/components/UI'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from 'frontend/components/UI/Dialog'

type BulkSettingValue = boolean | null

type Props = {
  games: GameInfo[]
  onClose: () => void
}

function getSharedValue(
  settings: GameSettings[],
  key: 'isVisualNovel' | 'jpLocale'
): BulkSettingValue {
  const values = new Set(settings.map((gameSettings) => gameSettings[key]))
  return values.size === 1 ? (settings[0]?.[key] ?? false) : null
}

export default function BulkGameOptionsDialog({ games, onClose }: Props) {
  const { t } = useTranslation('gamepage')
  const [isVisualNovel, setIsVisualNovel] = useState<BulkSettingValue>(null)
  const [jpLocale, setJpLocale] = useState<BulkSettingValue>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)

  useEffect(() => {
    async function loadSettings() {
      setLoading(true)
      setError(false)

      try {
        const uniqueAppNames = [...new Set(games.map((game) => game.app_name))]
        const settings = await Promise.all(
          uniqueAppNames.map((appName) =>
            window.api.requestGameSettings(appName)
          )
        )

        setIsVisualNovel(getSharedValue(settings, 'isVisualNovel'))
        setJpLocale(getSharedValue(settings, 'jpLocale'))
      } catch {
        setError(true)
      } finally {
        setLoading(false)
      }
    }

    void loadSettings()
  }, [games])

  function applySettings() {
    const uniqueAppNames = [...new Set(games.map((game) => game.app_name))]

    for (const appName of uniqueAppNames) {
      if (isVisualNovel !== null) {
        window.api.setSetting({
          appName,
          key: 'isVisualNovel',
          value: isVisualNovel
        })
      }

      if (jpLocale !== null) {
        window.api.setSetting({
          appName,
          key: 'jpLocale',
          value: jpLocale
        })
      }
    }

    onClose()
  }

  const mixedLabel = t(
    'library.bulk-options.mixed',
    'Mixed; leave unchanged or click to set'
  )

  return (
    <Dialog onClose={onClose} showCloseButton className="BulkGameOptionsDialog">
      <DialogHeader>
        {t('library.bulk-options.title', 'Game Options')}
      </DialogHeader>
      <DialogContent className="bulkGameOptionsContent">
        <p>
          {t(
            'library.bulk-options.description',
            'Apply options to {{count}} selected games.',
            { count: games.length }
          )}
        </p>
        {error && (
          <WarningMessage>
            {t(
              'library.bulk-options.load-error',
              'Unable to load the selected game settings.'
            )}
          </WarningMessage>
        )}
        {!loading && !error && (
          <>
            <ToggleSwitch
              htmlId="bulk-is-visual-novel"
              value={isVisualNovel}
              handleChange={() => setIsVisualNovel(isVisualNovel !== true)}
              title={`${t(
                'sideload.info.is-visual-novel',
                'Is Visual Novel'
              )}${isVisualNovel === null ? ` (${mixedLabel})` : ''}`}
              description={
                isVisualNovel === null
                  ? mixedLabel
                  : t(
                      'sideload.info.is-visual-novel-description',
                      'Identify these games as visual novels.'
                    )
              }
            />
            <ToggleSwitch
              htmlId="bulk-jp-locale"
              value={jpLocale}
              handleChange={() => setJpLocale(jpLocale !== true)}
              title={`${t('setting.jp-locale', 'JP locale')}${
                jpLocale === null ? ` (${mixedLabel})` : ''
              }`}
              description={
                jpLocale === null
                  ? mixedLabel
                  : t(
                      'setting.jp-locale-description',
                      'Launch these games through the configured Locale Emulator executable.'
                    )
              }
            />
            {(isVisualNovel === null || jpLocale === null) && (
              <small className="bulkGameOptionsMixed">{mixedLabel}</small>
            )}
          </>
        )}
      </DialogContent>
      <DialogFooter>
        <button className="button is-secondary" onClick={onClose}>
          {t('button.cancel', 'Cancel')}
        </button>
        <button
          className="button is-success"
          onClick={applySettings}
          disabled={loading || error}
        >
          {t('button.confirm', 'Confirm')}
        </button>
      </DialogFooter>
    </Dialog>
  )
}
