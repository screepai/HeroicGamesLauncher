import { useTranslation } from 'react-i18next'
import { Button, DetailList, SettingsCard } from 'frontend/components/UI'
import type { DetailItem } from 'frontend/components/UI/DetailList'
import type {
  VnCompatibilityEntry as CompatibilityEntry,
  VnCompatibilityPrefixSetup
} from 'common/types/vnCompatibility'

export type CodecActionState = 'hidden' | 'shared-prefix' | 'busy' | 'ready'

const winePrefixesUrl = 'https://www.vnwiki.xyz/linux/wineprefixes.html'
const specialCodecsUrl = 'https://www.vnwiki.xyz/linux/special-codecs.html'

function PrefixSetup({
  prefix,
  setup,
  codecAction,
  onInstallCodecs
}: {
  prefix: string
  setup: VnCompatibilityPrefixSetup | undefined
  codecAction: CodecActionState
  onInstallCodecs: (codecs: string[]) => void
}) {
  const { t } = useTranslation('gamepage')

  if (!setup) return null

  let codecActionTitle: string | undefined
  if (codecAction === 'shared-prefix') {
    codecActionTitle = t(
      'compatibility.install-codecs-shared-prefix',
      'Create a separate prefix for this game first.'
    )
  } else if (codecAction === 'busy') {
    codecActionTitle = t(
      'compatibility.install-codecs-busy',
      'Close the game and wait for current operations to finish first.'
    )
  }

  return (
    <section className="vnCompatibilitySetup">
      <h4 className="vnCompatibilitySetupTitle">
        {t('compatibility.setup-title', 'Guided setup')}
      </h4>
      <p>
        {t(
          'compatibility.setup-prefix',
          'Create a fresh {{architecture}} Wine prefix for the {{prefix}} template.',
          { architecture: setup.architecture, prefix }
        )}
      </p>
      {setup.specialCodecs.length > 0 && (
        <div>
          <b>{t('compatibility.special-codecs', 'Special Codecs')}:</b>{' '}
          {setup.specialCodecs.join(', ')}
          <Button
            variant="link"
            size="sm"
            onClick={() => window.api.openExternalUrl(specialCodecsUrl)}
          >
            {t('compatibility.open-codecs-guide', 'Open codec guide')}
          </Button>
          {codecAction !== 'hidden' && (
            <Button
              variant="primary"
              size="sm"
              className="vnCompatibilityInstallCodecs"
              onClick={() => onInstallCodecs(setup.specialCodecs)}
              disabled={codecAction !== 'ready'}
              title={codecActionTitle}
            >
              {t(
                'compatibility.install-codecs-in-prefix',
                'Set up codecs with vn_winestuff'
              )}
            </Button>
          )}
        </div>
      )}
      {setup.winetricks.length > 0 && (
        <div>
          <b>{t('compatibility.winetricks', 'Winetricks components')}:</b>{' '}
          {setup.winetricks.join(', ')}
        </div>
      )}
      <Button
        variant="link"
        size="sm"
        onClick={() => window.api.openExternalUrl(winePrefixesUrl)}
      >
        {t('compatibility.open-prefix-guide', 'Open prefix setup guide')}
      </Button>
    </section>
  )
}

export default function VnCompatibilityEntry({
  entry,
  prefixSetup,
  codecAction,
  onInstallCodecs
}: {
  entry: CompatibilityEntry
  prefixSetup: VnCompatibilityPrefixSetup | undefined
  codecAction: CodecActionState
  onInstallCodecs: (prefix: string, codecs: string[]) => void
}) {
  const { t } = useTranslation('gamepage')

  const items: DetailItem[] = [
    { label: t('compatibility.linux', 'Linux'), value: entry.linux || '❓' },
    {
      label: t('compatibility.steam-deck', 'Steam Deck'),
      value: entry.steamDeck || '❓'
    }
  ]
  if (entry.engine) {
    items.push({
      label: t('compatibility.engine', 'Engine'),
      value: entry.engine
    })
  }
  items.push(
    {
      label: t('compatibility.wine-prefix', 'Wine prefix'),
      value: entry.winePrefix || '—'
    },
    {
      label: t('compatibility.wine-version', 'Wine/Proton version'),
      value: entry.wineVersion || '—'
    }
  )

  return (
    <SettingsCard className="vnCompatibilityEntry" title={entry.title}>
      <DetailList items={items} columns={2} />
      <PrefixSetup
        prefix={entry.winePrefix}
        setup={prefixSetup}
        codecAction={prefixSetup?.specialCodecs.length ? codecAction : 'hidden'}
        onInstallCodecs={(codecs) => onInstallCodecs(entry.winePrefix, codecs)}
      />
      {entry.notes.length > 0 && (
        <ul className="vnCompatibilityNotes">
          {entry.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      )}
    </SettingsCard>
  )
}
