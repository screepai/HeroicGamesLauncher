import { useTranslation } from 'react-i18next'
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
      <h4>{t('compatibility.setup-title', 'Guided setup')}</h4>
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
          <button
            className="vnCompatibilitySource"
            onClick={() => window.api.openExternalUrl(specialCodecsUrl)}
          >
            {t('compatibility.open-codecs-guide', 'Open codec guide')}
          </button>
          {codecAction !== 'hidden' && (
            <button
              className="button is-primary vnCompatibilityInstallCodecs"
              onClick={() => onInstallCodecs(setup.specialCodecs)}
              disabled={codecAction !== 'ready'}
              title={codecActionTitle}
            >
              {t(
                'compatibility.install-codecs-in-prefix',
                'Set up codecs with vn_winestuff'
              )}
            </button>
          )}
        </div>
      )}
      {setup.winetricks.length > 0 && (
        <div>
          <b>{t('compatibility.winetricks', 'Winetricks components')}:</b>{' '}
          {setup.winetricks.join(', ')}
        </div>
      )}
      <button
        className="vnCompatibilitySource"
        onClick={() => window.api.openExternalUrl(winePrefixesUrl)}
      >
        {t('compatibility.open-prefix-guide', 'Open prefix setup guide')}
      </button>
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

  return (
    <article className="vnCompatibilityEntry">
      <h3>{entry.title}</h3>
      <dl>
        <div>
          <dt>{t('compatibility.linux', 'Linux')}</dt>
          <dd>{entry.linux || '❓'}</dd>
        </div>
        <div>
          <dt>{t('compatibility.steam-deck', 'Steam Deck')}</dt>
          <dd>{entry.steamDeck || '❓'}</dd>
        </div>
        {entry.engine && (
          <div>
            <dt>{t('compatibility.engine', 'Engine')}</dt>
            <dd>{entry.engine}</dd>
          </div>
        )}
        <div>
          <dt>{t('compatibility.wine-prefix', 'Wine prefix')}</dt>
          <dd>{entry.winePrefix || '—'}</dd>
        </div>
        <div>
          <dt>{t('compatibility.wine-version', 'Wine/Proton version')}</dt>
          <dd>{entry.wineVersion || '—'}</dd>
        </div>
      </dl>
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
    </article>
  )
}
