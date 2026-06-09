import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import GameContext from '../../GameContext'
import GameScore from 'frontend/components/UI/WikiGameInfo/components/GameScore'
import { GameInfo } from 'common/types'
import classNames from 'classnames'
import { createNewWindow } from 'frontend/helpers'
import { getVndbScoreValue } from 'frontend/helpers/vndb'

interface Props {
  gameInfo: GameInfo
}

const Scores = ({ gameInfo }: Props) => {
  const { t } = useTranslation('gamepage')
  const { wikiInfo, vndbMatch } = useContext(GameContext)

  const pcgamingwiki = wikiInfo?.pcgamingwiki

  const hasScores =
    pcgamingwiki?.metacritic.score ||
    pcgamingwiki?.igdb.score ||
    pcgamingwiki?.opencritic.score

  if (hasScores && pcgamingwiki) {
    return <GameScore info={pcgamingwiki} title={gameInfo.title} />
  }

  const rating = getVndbScoreValue(vndbMatch?.rating)
  const average = getVndbScoreValue(
    vndbMatch?.average !== vndbMatch?.rating ? vndbMatch?.average : undefined
  )

  if (!rating && !average) {
    return null
  }

  const getColorClass = (value: string) => {
    const number = Number(value)

    if (number > 66) {
      return 'green'
    }

    if (number < 33) {
      return 'red'
    }

    return 'yellow'
  }

  return (
    <div className="gamescore">
      {rating && (
        <button
          className={classNames('circle', getColorClass(rating))}
          onClick={() => {
            if (vndbMatch) {
              createNewWindow(`https://vndb.org/${vndbMatch.vndbId}`)
            }
          }}
        >
          <div className="circle__title">{t('game.vndb', 'VNDB')}</div>
          <div className="circle__value">{rating}</div>
        </button>
      )}
      {average && (
        <button
          className={classNames('circle', getColorClass(average))}
          onClick={() => {
            if (vndbMatch) {
              createNewWindow(`https://vndb.org/${vndbMatch.vndbId}`)
            }
          }}
        >
          <div className="circle__title">{t('vndb.average', 'Average')}</div>
          <div className="circle__value">{average}</div>
        </button>
      )}
    </div>
  )
}

export default Scores
