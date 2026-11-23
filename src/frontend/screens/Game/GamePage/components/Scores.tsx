import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { Gamepad2 } from 'lucide-react'
import { GameInfo } from 'common/types'
import { createNewWindow } from 'frontend/helpers'
import { Icon, Panel, Score } from 'frontend/components/UI'
import GameContext from '../../GameContext'
import { getVndbScoreValue } from 'frontend/helpers/vndb'

interface Props {
  gameInfo: GameInfo
}

const Scores = ({ gameInfo }: Props) => {
  const { t } = useTranslation('gamepage')
  const { wikiInfo, vndbMatch } = useContext(GameContext)

  const pcgamingwiki = wikiInfo?.pcgamingwiki
  const applegamingwiki = wikiInfo?.applegamingwiki

  const { metacritic, opencritic, igdb } = pcgamingwiki ?? {}

  const hasScores =
    metacritic?.score ||
    opencritic?.score ||
    igdb?.score ||
    applegamingwiki?.crossoverRating

  const title = gameInfo.overrides?.title || gameInfo.title

  const rating = getVndbScoreValue(vndbMatch?.rating)
  const average = getVndbScoreValue(
    vndbMatch?.average !== vndbMatch?.rating ? vndbMatch?.average : undefined
  )

  if (!hasScores && !rating && !average) {
    return null
  }

  const openVndb = () => {
    if (vndbMatch) createNewWindow(`https://vndb.org/${vndbMatch.vndbId}`)
  }

  return (
    <Panel tone="glass" padding="sm" className="gameScores">
      <span className="gameScores__title">
        <Icon glyph={Gamepad2} size="sm" />
        {t('info.game-scores', 'Game Scores')}
      </span>
      <div className="gameScores__list">
        {rating && (
          <Score
            label={t('game.vndb', 'VNDB')}
            value={rating}
            onClick={openVndb}
          />
        )}
        {average && (
          <Score
            label={t('vndb.average', 'Average')}
            value={average}
            onClick={openVndb}
          />
        )}
        {opencritic?.score && (
          <Score
            label="Open Critic"
            value={opencritic.score}
            title={t('info.clickToOpen', 'Click to open')}
            onClick={() =>
              createNewWindow(
                opencritic.urlid
                  ? `https://opencritic.com/game/${opencritic.urlid}`
                  : `https://opencritic.com/search?criteria=${title}`
              )
            }
          />
        )}
        {metacritic?.score && (
          <Score
            label="MetaCritic"
            value={metacritic.score}
            title={t('info.clickToOpen', 'Click to open')}
            onClick={() =>
              createNewWindow(
                metacritic.urlid
                  ? `https://www.metacritic.com/game/pc/${metacritic.urlid}`
                  : `https://www.metacritic.com/search/all/${title}/results`
              )
            }
          />
        )}
        {igdb?.score && (
          <Score
            label="IGDB"
            value={igdb.score}
            title={t('info.clickToOpen', 'Click to open')}
            onClick={() =>
              createNewWindow(
                metacritic?.urlid
                  ? `https://www.igdb.com/games/${metacritic.urlid}`
                  : `https://www.igdb.com/search?type=1&q=${title}`
              )
            }
          />
        )}
        {applegamingwiki?.crossoverRating && (
          <Score
            label="AppleGamingWiki"
            value={applegamingwiki.crossoverRating}
            title={t('info.clickToOpen', 'Click to open')}
            onClick={() =>
              createNewWindow(
                applegamingwiki.crossoverLink
                  ? `https://www.codeweavers.com/compatibility/crossover/${applegamingwiki.crossoverLink}`
                  : `https://www.codeweavers.com/compatibility?name=${title}&search=app#results`
              )
            }
          />
        )}
      </div>
    </Panel>
  )
}

export default Scores
