import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameInfo } from 'common/types'
import type {
  VnCompatibilityEntry,
  VnCompatibilityResult
} from 'common/types/vnCompatibility'
import type { VndbGameMatch } from 'common/types/vndb'
import { getSelectedVndbReleases } from 'frontend/helpers/vndb'
import VnCompatibilityActions from './VnCompatibilityActions'

interface Props {
  gameInfo: GameInfo
  vndbMatch: VndbGameMatch | null
}

type CompatibilityState =
  | { status: 'loading' }
  | { status: 'ready'; result: VnCompatibilityResult | null }
  | { status: 'error' }

const vnWikiCompatibilityUrl =
  'https://www.vnwiki.xyz/visual-novel-compatibility-list.html'

function getTitles(gameInfo: GameInfo, match: VndbGameMatch | null): string[] {
  const selectedReleases = match ? getSelectedVndbReleases(match) : []

  return [
    gameInfo.title,
    gameInfo.overrides?.title,
    match?.vndbTitle,
    ...(match?.aliases ?? []),
    ...selectedReleases.flatMap((release) => [
      release.title,
      ...(release.languageTitles?.flatMap((title) => [
        title.title ?? '',
        title.latin ?? ''
      ]) ?? [])
    ])
  ].filter((title): title is string => Boolean(title?.trim()))
}

function getEngine(match: VndbGameMatch | null): string | undefined {
  if (!match) return undefined

  return getSelectedVndbReleases(match)
    .map((release) => release.engine)
    .find((engine): engine is string => Boolean(engine))
}

function getCompiledEngineNotes(entries: VnCompatibilityEntry[]) {
  const notes = new Map<string, Set<string>>()

  for (const entry of entries) {
    for (const note of entry.notes) {
      const sourceGames = notes.get(note) ?? new Set<string>()
      sourceGames.add(entry.title)
      notes.set(note, sourceGames)
    }
  }

  return [...notes].map(([note, sourceGames]) => ({
    note,
    sourceGames: [...sourceGames].sort((left, right) =>
      left.localeCompare(right)
    )
  }))
}

const VnCompatibilityInfo = ({ gameInfo, vndbMatch }: Props) => {
  const { t } = useTranslation('gamepage')
  const titles = useMemo(
    () => getTitles(gameInfo, vndbMatch),
    [gameInfo, vndbMatch]
  )
  const engine = useMemo(() => getEngine(vndbMatch), [vndbMatch])
  const [state, setState] = useState<CompatibilityState>({
    status: 'loading'
  })
  useEffect(() => {
    let isMounted = true
    setState({ status: 'loading' })

    window.api.vnCompatibility
      .get({ titles, engine })
      .then((result) => {
        if (isMounted) setState({ status: 'ready', result })
      })
      .catch((error) => {
        console.error(error)
        if (isMounted) setState({ status: 'error' })
      })

    return () => {
      isMounted = false
    }
  }, [engine, titles])

  if (state.status === 'loading') {
    return <p>{t('compatibility.loading', 'Checking VNWiki compatibility…')}</p>
  }

  if (state.status === 'error') {
    return (
      <p>
        {t(
          'compatibility.unavailable',
          'Compatibility information is currently unavailable.'
        )}
      </p>
    )
  }

  if (!state.result) {
    return (
      <div className="vnCompatibilityInfo">
        <p>
          {t(
            'compatibility.not-listed',
            'This game is not listed in the VNWiki compatibility database.'
          )}
        </p>
        <button
          className="vnCompatibilitySource"
          onClick={() => window.api.openExternalUrl(vnWikiCompatibilityUrl)}
        >
          {t('compatibility.open-source', 'Open the VNWiki compatibility list')}
        </button>
      </div>
    )
  }

  const result = state.result
  const isEngineMatch = result.match === 'engine'
  const compiledEngineNotes = isEngineMatch
    ? getCompiledEngineNotes(result.entries)
    : []

  return (
    <div className="vnCompatibilityInfo">
      <div className="vnCompatibilityHeader">
        <div>
          <h2>
            {isEngineMatch
              ? t(
                  'compatibility.engine-title',
                  'Known {{engine}} configurations',
                  { engine: result.engine }
                )
              : t('compatibility.title', 'VNWiki compatibility')}
          </h2>
          <p>
            {isEngineMatch
              ? t(
                  'compatibility.engine-description',
                  'This game has no exact VNWiki entry. These settings are documented for other games using the same engine, so review them before applying. Only use these settings if you are experiencing issues with the default configuration.'
                )
              : t(
                  'compatibility.exact-description',
                  'Settings documented for this game by VNWiki.'
                )}
          </p>
        </div>
        <button
          className="vnCompatibilitySource"
          onClick={() => window.api.openExternalUrl(vnWikiCompatibilityUrl)}
        >
          {t('compatibility.source', 'Source: VNWiki')}
        </button>
      </div>
      <section className="vnCompatibilityBasics">
        <h3>{t('compatibility.basics-title', 'Before you begin')}</h3>
        <ul>
          <li>
            {t(
              'compatibility.basics-locale',
              'Enable JP locale for this game. If text is missing or broken, add Japanese fonts to the Wine prefix.'
            )}
          </li>
          <li>
            {t(
              'compatibility.basics-prefix',
              'Use a separate prefix for each game. Recreate it if you change Wine versions after installing components.'
            )}
          </li>
        </ul>
      </section>
      {compiledEngineNotes.length > 0 && (
        <section className="vnCompatibilityEngineNotes">
          <h3>{t('compatibility.engine-notes', 'Documented notes')}</h3>
          <ul>
            {compiledEngineNotes.map(({ note, sourceGames }) => (
              <li key={note}>
                <span>{note}</span>
                <small>
                  {t(
                    'compatibility.note-source-games',
                    'Reported for: {{games}}',
                    { games: sourceGames.join(', ') }
                  )}
                </small>
              </li>
            ))}
          </ul>
        </section>
      )}
      <VnCompatibilityActions gameInfo={gameInfo} result={result} />
    </div>
  )
}

export default VnCompatibilityInfo
