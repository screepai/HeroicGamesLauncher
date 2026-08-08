import { memo, useContext, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionIcons from 'frontend/components/UI/ActionIcons'
import {
  getArchiveTitle,
  LOCAL_LIBRARY_ARCHIVE_EXTENSIONS
} from 'common/local_library_archive'
import { GameInfo, LocalLibraryWatchEntry } from 'common/types'
import type { VndbGameMatch } from 'common/types/vndb'
import ArchiveExtractionDialog from 'frontend/components/ArchiveExtractionDialog'
import { openInstallGameModal } from 'frontend/state/InstallGameModal'
import LibraryContext from '../../LibraryContext'
import './index.css'
import AddGameButton from '../AddGameButton'
import VndbSyncButton from './VndbSyncButton'
import BulkGameOptionsDialog from './BulkGameOptionsDialog'
import BulkGameMigrationDialog from './BulkGameMigrationDialog'
import BulkUninstallDialog, {
  type BulkUninstallAction
} from './BulkUninstallDialog'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import useAppSetting from 'frontend/hooks/useAppSetting'
import {
  faCheckDouble,
  faFolderOpen,
  faMinusCircle,
  faSlidersH,
  faTags,
  faTrash,
  faTimes
} from '@fortawesome/free-solid-svg-icons'

type Props = {
  list: GameInfo[]
  onVndbMatchesChange?: (matches: Record<string, VndbGameMatch>) => void
}

export default memo(function LibraryHeader({
  list,
  onVndbMatchesChange
}: Props) {
  const { t } = useTranslation()
  const enableVndbIntegration = useAppSetting('enableVndbIntegration', true)
  const {
    showFavourites,
    selectedGames,
    isSelectingGames,
    isGameSelected,
    selectAllGames,
    clearGameSelection,
    openSelectedGamesCategories
  } = useContext(LibraryContext)
  const [showBulkOptions, setShowBulkOptions] = useState(false)
  const [showBulkMigration, setShowBulkMigration] = useState(false)
  const [bulkUninstallAction, setBulkUninstallAction] =
    useState<BulkUninstallAction | null>(null)
  const [archiveToExtract, setArchiveToExtract] =
    useState<LocalLibraryWatchEntry | null>(null)
  const allVisibleGamesSelected =
    list.length > 0 && list.every((game) => isGameSelected(game))
  const installedGames = selectedGames.filter((game) => game.is_installed)
  const canUninstallInHeroic = installedGames.some(
    (game) => !game.install.is_dlc
  )

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

  const selectArchive = async () => {
    const { localLibrarySyncPath } = await window.api.requestAppSettings()
    const archivePath = await window.api.openDialog({
      buttonLabel: t('box.extract', 'Extract'),
      defaultPath: localLibrarySyncPath || undefined,
      properties: ['openFile'],
      title: t('box.extract-archive', 'Extract Archive'),
      filters: [
        {
          name: t('box.archive-files', 'Archive files'),
          extensions: [
            ...LOCAL_LIBRARY_ARCHIVE_EXTENSIONS.map((extension) =>
              extension.slice(1)
            ),
            '001'
          ]
        }
      ]
    })

    if (!archivePath) {
      return
    }

    const archiveName = archivePath.split(/[\\/]/).pop() ?? archivePath
    setArchiveToExtract({
      folderPath: archivePath,
      isArchive: true,
      title: getArchiveTitle(archiveName)
    })
  }

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
              onClick={() =>
                allVisibleGamesSelected
                  ? clearGameSelection()
                  : selectAllGames(list)
              }
            >
              <FontAwesomeIcon
                icon={allVisibleGamesSelected ? faTimes : faCheckDouble}
              />
              {allVisibleGamesSelected
                ? t('library.unselect-all', 'Unselect All')
                : t('library.select-all', 'Select All')}
            </button>
            <button
              className="libraryBulkAction"
              onClick={openSelectedGamesCategories}
            >
              <FontAwesomeIcon icon={faTags} />
              {t('submenu.categories', 'Categories')}
            </button>
            <button
              className="libraryBulkAction"
              onClick={() => setShowBulkOptions(true)}
            >
              <FontAwesomeIcon icon={faSlidersH} />
              {t('library.bulk-options.button', 'Options')}
            </button>
            <button
              className="libraryBulkAction"
              onClick={() => setShowBulkMigration(true)}
            >
              <FontAwesomeIcon icon={faFolderOpen} />
              {t('library.migration.button', 'Migrate')}
            </button>
            <button
              className="libraryBulkAction"
              onClick={() => setBulkUninstallAction('heroicOnly')}
              disabled={!canUninstallInHeroic}
            >
              <FontAwesomeIcon icon={faMinusCircle} />
              {t('gamepage:box.uninstall.heroicOnly', 'Uninstall in Heroic')}
            </button>
            <button
              className="libraryBulkAction libraryBulkAction--danger"
              onClick={() => setBulkUninstallAction('entirely')}
              disabled={installedGames.length === 0}
            >
              <FontAwesomeIcon icon={faTrash} />
              {t('gamepage:box.uninstall.entirely', 'Uninstall entirely')}
            </button>
            {enableVndbIntegration && (
              <VndbSyncButton
                list={selectedGames}
                onMatchesChange={onVndbMatchesChange}
              />
            )}
            <button
              className="libraryBulkAction"
              onClick={clearGameSelection}
              title={t('button.cancel', 'Cancel')}
            >
              <FontAwesomeIcon icon={faTimes} />
              {t('button.cancel', 'Cancel')}
            </button>
            {showBulkOptions && (
              <BulkGameOptionsDialog
                games={selectedGames}
                onClose={() => setShowBulkOptions(false)}
              />
            )}
            {showBulkMigration && (
              <BulkGameMigrationDialog
                games={selectedGames}
                onClose={() => setShowBulkMigration(false)}
              />
            )}
            {bulkUninstallAction && (
              <BulkUninstallDialog
                action={bulkUninstallAction}
                games={selectedGames}
                onClose={() => setBulkUninstallAction(null)}
                onComplete={() => {
                  setBulkUninstallAction(null)
                  clearGameSelection()
                }}
              />
            )}
          </div>
        ) : (
          <>
            <span className="libraryTitle">
              {showFavourites
                ? t('favourites', 'Favourites')
                : t('title.allGames', 'All Games')}
              <span className="numberOfgames">{numberOfGames}</span>
              <span className="libraryManualActions">
                <AddGameButton data-tour="library-add-game" />
                <button
                  className="extractArchiveButton"
                  onClick={() => void selectArchive()}
                >
                  {t('box.extract-archive', 'Extract Archive')}
                </button>
                {enableVndbIntegration && (
                  <VndbSyncButton
                    list={list}
                    onMatchesChange={onVndbMatchesChange}
                  />
                )}
              </span>
            </span>
            <ActionIcons />
          </>
        )}
      </div>
      {archiveToExtract && (
        <ArchiveExtractionDialog
          archive={archiveToExtract}
          source="manual"
          onClose={() => setArchiveToExtract(null)}
          onExtracted={(folder) => {
            setArchiveToExtract(null)
            openInstallGameModal({
              appName: '',
              runner: 'sideload',
              gameInfo: null,
              sideloadTitle: folder.title,
              sideloadDefaultPath: folder.folderPath
            })
          }}
        />
      )}
    </h5>
  )
})
