import { memo, useContext, useMemo } from 'react'
import { useTranslation } from 'react-i18next'
import ActionIcons from 'frontend/components/UI/ActionIcons'
import { GameInfo } from 'common/types'
import type { VndbGameMatch } from 'common/types/vndb'
import LibraryContext from '../../LibraryContext'
import './index.css'
import AddGameButton from '../AddGameButton'
import VndbSyncButton from './VndbSyncButton'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { faTags, faTimes } from '@fortawesome/free-solid-svg-icons'

type Props = {
  list: GameInfo[]
  onVndbMatchesChange?: (matches: Record<string, VndbGameMatch>) => void
}

export default memo(function LibraryHeader({
  list,
  onVndbMatchesChange
}: Props) {
  const { t } = useTranslation()
  const {
    showFavourites,
    selectedGames,
    isSelectingGames,
    clearGameSelection,
    openSelectedGamesCategories
  } = useContext(LibraryContext)

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
        {isSelectingGames ? (
          <div className="libraryBulkSelection">
            <strong>
              {t('library.bulk-selected', '{{count}} selected', {
                count: selectedGames.length
              })}
            </strong>
            <button
              className="libraryBulkAction"
              onClick={openSelectedGamesCategories}
            >
              <FontAwesomeIcon icon={faTags} />
              {t('submenu.categories', 'Categories')}
            </button>
            <VndbSyncButton
              list={selectedGames}
              onMatchesChange={onVndbMatchesChange}
            />
            <button
              className="libraryBulkAction"
              onClick={clearGameSelection}
              title={t('button.cancel', 'Cancel')}
            >
              <FontAwesomeIcon icon={faTimes} />
              {t('button.cancel', 'Cancel')}
            </button>
          </div>
        ) : (
          <>
            <span className="libraryTitle">
              {showFavourites
                ? t('favourites', 'Favourites')
                : t('title.allGames', 'All Games')}
              <span className="numberOfgames">{numberOfGames}</span>
              <AddGameButton data-tour="library-add-game" />
              <VndbSyncButton
                list={list}
                onMatchesChange={onVndbMatchesChange}
              />
            </span>
            <ActionIcons />
          </>
        )}
      </div>
    </h5>
  )
})
