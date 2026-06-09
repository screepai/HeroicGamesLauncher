import { useContext } from 'react'
import GameContext from '../../GameContext'
import { GameInfo } from 'common/types'

interface Props {
  gameInfo: GameInfo
}

const Developer = ({ gameInfo }: Props) => {
  const { runner, vndbMatch } = useContext(GameContext)
  const vndbDevelopers = [
    ...new Set((vndbMatch?.developers ?? []).filter(Boolean))
  ].sort((left, right) => left.localeCompare(right))
  const developer =
    runner === 'sideload'
      ? vndbDevelopers.join(', ')
      : gameInfo.developer || vndbDevelopers.join(', ')

  if (!developer) {
    return null
  }

  return <div className="developer">{developer}</div>
}

export default Developer
