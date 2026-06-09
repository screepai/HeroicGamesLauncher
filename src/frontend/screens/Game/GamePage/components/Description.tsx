import { useContext } from 'react'
import GameContext from '../../GameContext'
import { useTranslation } from 'react-i18next'
import { getCleanVndbDescription } from 'frontend/helpers/vndb'

const Description = () => {
  const { t } = useTranslation('gamepage')
  const { gameExtraInfo, runner, vndbMatch } = useContext(GameContext)

  const vndbDescription = getCleanVndbDescription(vndbMatch?.description)

  const description =
    runner !== 'sideload'
      ? gameExtraInfo?.about?.shortDescription ||
        gameExtraInfo?.about?.description ||
        vndbDescription ||
        t('generic.noDescription', 'No description available')
      : vndbDescription

  if (!description) {
    return null
  }

  return <div className="summary">{description}</div>
}

export default Description
