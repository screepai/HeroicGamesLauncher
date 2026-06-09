import { useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import GameContext from '../../GameContext'
import { Speed, ExpandMore } from '@mui/icons-material'
import { Accordion, AccordionSummary, AccordionDetails } from '@mui/material'
import HowLongToBeat from 'frontend/components/UI/WikiGameInfo/components/HowLongToBeat'
import { formatVndbLength } from 'frontend/helpers/vndb'

const HLTB = () => {
  const { t } = useTranslation('gamepage')
  const { wikiInfo, vndbMatch } = useContext(GameContext)

  const [isExpanded, setIsExpanded] = useState(false)

  function handleExpansionChange() {
    setIsExpanded((prevExpanded) => !prevExpanded)
  }

  const howlongtobeat = wikiInfo?.howlongtobeat

  if (!howlongtobeat) {
    const vndbLength = vndbMatch ? formatVndbLength(vndbMatch, t) : ''

    if (!vndbLength) {
      return null
    }

    return (
      <div>
        <Speed />
        <b>{t('vndb.length', 'Length')}</b>
        <span>{vndbLength}</span>
      </div>
    )
  }

  return (
    <div className="hltbWrapper">
      <Accordion expanded={isExpanded} onChange={handleExpansionChange}>
        <AccordionSummary
          expandIcon={<ExpandMore />}
          aria-controls="hltb-content"
          id="hltb-header"
          title={t('info.clickToOpen', 'Click to open')}
        >
          <Speed />
          <b>{t('howLongToBeat', 'How Long To Beat')}</b>
        </AccordionSummary>
        <AccordionDetails>
          <HowLongToBeat info={howlongtobeat} />
        </AccordionDetails>
      </Accordion>
    </div>
  )
}

export default HLTB
