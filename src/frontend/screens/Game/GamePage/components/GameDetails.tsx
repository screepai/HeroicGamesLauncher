import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { CalendarDays, Code2, MonitorPlay, Tags } from 'lucide-react'
import { GameInfo } from 'common/types'
import { DetailList, Panel, StoreBadge } from 'frontend/components/UI'
import type { DetailItem } from 'frontend/components/UI/DetailList'
import { getIntlLocale } from 'frontend/helpers'
import { getTopVndbTags } from 'frontend/helpers/vndb'
import { getReleaseDate } from 'frontend/helpers/releaseDate'
import GameContext from '../../GameContext'

interface Props {
  gameInfo: GameInfo
}

const STORE_NAMES: Record<string, string> = {
  legendary: 'Epic Games',
  gog: 'GOG',
  nile: 'Amazon Games',
  zoom: 'ZOOM',
  itchio: 'itch.io',
  sideload: 'Sideloaded'
}

const GameDetails = ({ gameInfo }: Props) => {
  const { t, i18n } = useTranslation('gamepage')
  const { gameExtraInfo, runner, wikiInfo, is, vndbMatch } =
    useContext(GameContext)

  const gameGenres =
    gameExtraInfo?.genres || wikiInfo?.pcgamingwiki?.genres || []
  const genres = gameGenres.some(Boolean)
    ? gameGenres
    : getTopVndbTags(vndbMatch?.tags, { category: 'cont', limit: 5 }).map(
        (tag) => tag.name
      )
  const vndbDevelopers = [
    ...new Set((vndbMatch?.developers ?? []).filter(Boolean))
  ]
    .sort((left, right) => left.localeCompare(right))
    .join(', ')
  const developer = gameInfo.developer || vndbDevelopers
  const locale = getIntlLocale(i18n.language)
  const releaseDate =
    getReleaseDate(
      wikiInfo?.pcgamingwiki?.releaseDate,
      gameExtraInfo?.releaseDate,
      is,
      locale
    ) ?? getReleaseDate(undefined, vndbMatch?.released ?? undefined, is, locale)
  const installPlatform = gameInfo.install.platform

  const items: DetailItem[] = []

  if (developer) {
    items.push({
      glyph: Code2,
      label: t('info.developer', 'Developer'),
      value: developer
    })
  }

  if (releaseDate) {
    items.push({
      glyph: CalendarDays,
      label: t('label.releaseDate', 'Release date'),
      value: releaseDate
    })
  }

  if (genres.length && genres[0] !== '') {
    items.push({
      glyph: Tags,
      label: t('info.genres', 'Genres'),
      value: genres.join(', ')
    })
  }

  if (gameInfo.is_installed && installPlatform) {
    items.push({
      glyph: MonitorPlay,
      label: t('info.installedPlatform', 'Installed platform'),
      value: installPlatform === 'osx' ? 'macOS' : installPlatform
    })
  }

  return (
    <Panel tone="glass" className="gameDetails">
      <div className="gameDetails__header">
        <h3 className="gameDetails__title">
          {t('game.details', 'Game details')}
        </h3>
        <StoreBadge runner={runner} title={STORE_NAMES[runner] ?? runner} />
      </div>
      <DetailList items={items} />
    </Panel>
  )
}

export default GameDetails
