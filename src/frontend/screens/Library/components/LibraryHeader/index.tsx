import { memo, useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ActionIcons from 'frontend/components/UI/ActionIcons'
import { GameInfo } from 'common/types'
import type { VndbGameMatch } from 'common/types/vndb'
import LibraryContext from '../../LibraryContext'
import './index.css'
import AddGameButton from '../AddGameButton'
import VndbSyncButton from './VndbSyncButton'

type Props = {
  list: GameInfo[]
  onVndbMatchesChange?: (matches: Record<string, VndbGameMatch>) => void
}

export default memo(function LibraryHeader({
  list,
  onVndbMatchesChange
}: Props) {
  const { t } = useTranslation()
  const { showFavourites } = useContext(LibraryContext)

  const numberOfGames = useMemo(() => {
    if (!list) {
      return 0
    }
    // is_dlc is only applicable when the game is from legendary, but checking anyway doesn't cause errors and enable accurate counting in the 'ALL' game tab
    const dlcCount = list.filter(
      (lib) => lib.runner !== 'sideload' && lib.install.is_dlc
    ).length

    const total = list.length - dlcCount
    return total > 0 ? `${total}` : 0
  }, [list])

  return (
    <h5
      className="libraryHeader libraryHeader--main"
      data-tour="library-header"
    >
      <div className="libraryHeaderWrapper">
        <span className="libraryTitle">
          {showFavourites
            ? t('favourites', 'Favourites')
            : t('title.allGames', 'All Games')}
          <span className="numberOfgames">{numberOfGames}</span>
          <AddGameButton data-tour="library-add-game" />
          <VndbSyncButton list={list} onMatchesChange={onVndbMatchesChange} />
        </span>
        <ActionIcons />
      </div>
    </h5>
  )
})
