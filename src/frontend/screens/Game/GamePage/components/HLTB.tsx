import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { Gauge } from 'lucide-react'
import { Icon, Panel } from 'frontend/components/UI'
import HowLongToBeat from 'frontend/components/UI/WikiGameInfo/components/HowLongToBeat'
import { formatVndbLength } from 'frontend/helpers/vndb'
import GameContext from '../../GameContext'

const HLTB = () => {
  const { t } = useTranslation('gamepage')
  const { wikiInfo, vndbMatch } = useContext(GameContext)

  const howlongtobeat = wikiInfo?.howlongtobeat

  const vndbLength = vndbMatch ? formatVndbLength(vndbMatch, t) : ''

  if (!howlongtobeat && !vndbLength) {
    return null
  }

  return (
    <Panel tone="glass" className="hltbWrapper">
      <h3 className="extraTab__title">
        <Icon glyph={Gauge} size="sm" />
        {howlongtobeat
          ? t('howLongToBeat', 'How long to beat')
          : t('vndb.length', 'Length')}
      </h3>
      {howlongtobeat ? (
        <HowLongToBeat info={howlongtobeat} />
      ) : (
        <p>{vndbLength}</p>
      )}
    </Panel>
  )
}

export default HLTB
