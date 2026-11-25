import { memo, useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import ActionIcons from 'frontend/components/UI/ActionIcons'
import { GameInfo } from 'common/types'
import type { VndbGameMatch } from 'common/types/vndb'
import LibraryContext from '../../LibraryContext'
import './index.css'
import Header from 'frontend/components/UI/Header'
import { Button } from 'frontend/components/UI'
import useAppSetting from 'frontend/hooks/useAppSetting'
import VndbSyncButton from './VndbSyncButton'
import BulkGameOptionsDialog from './BulkGameOptionsDialog'
import BulkGameMigrationDialog from './BulkGameMigrationDialog'
import BulkUninstallDialog, {
  type BulkUninstallAction
} from './BulkUninstallDialog'
import {
  CheckCheck,
  FolderOpen,
  CircleMinus,
  SlidersHorizontal,
  Tags,
  Trash2,
  X
} from 'lucide-react'

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
  const allVisibleGamesSelected =
    list.length > 0 && list.every((game) => isGameSelected(game))
  const installedGames = selectedGames.filter((game) => game.is_installed)
  const canUninstallInHeroic = installedGames.some(
    (game) => !game.install.is_dlc
  )

  return (
    <div className="libraryHeader" data-tour="library-header">
      <div className="libraryToolbar">
        <Header />
        <ActionIcons data-tour="library-actions" />
      </div>
      {isSelectingGames && (
        <div className="libraryHeaderActions">
          <div className="libraryBulkSelection">
            <strong>
              {t('library.bulk-selected', '{{count}} selected', {
                count: selectedGames.length
              })}
            </strong>
            <Button
              size="sm"
              variant="secondary"
              icon={
                allVisibleGamesSelected ? (
                  <X size={16} />
                ) : (
                  <CheckCheck size={16} />
                )
              }
              onClick={() =>
                allVisibleGamesSelected
                  ? clearGameSelection()
                  : selectAllGames(list)
              }
            >
              {allVisibleGamesSelected
                ? t('library.unselect-all', 'Unselect All')
                : t('library.select-all', 'Select All')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<Tags size={16} />}
              onClick={openSelectedGamesCategories}
            >
              {t('submenu.categories', 'Categories')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<SlidersHorizontal size={16} />}
              onClick={() => setShowBulkOptions(true)}
            >
              {t('library.bulk-options.button', 'Options')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<FolderOpen size={16} />}
              onClick={() => setShowBulkMigration(true)}
            >
              {t('library.migration.button', 'Migrate')}
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={<CircleMinus size={16} />}
              onClick={() => setBulkUninstallAction('heroicOnly')}
              disabled={!canUninstallInHeroic}
            >
              {t('gamepage:box.uninstall.heroicOnly', 'Uninstall in Heroic')}
            </Button>
            <Button
              size="sm"
              variant="dangerSubtle"
              icon={<Trash2 size={16} />}
              onClick={() => setBulkUninstallAction('entirely')}
              disabled={installedGames.length === 0}
            >
              {t('gamepage:box.uninstall.entirely', 'Uninstall entirely')}
            </Button>
            {enableVndbIntegration && (
              <VndbSyncButton
                size="sm"
                list={selectedGames}
                onMatchesChange={onVndbMatchesChange}
              />
            )}
            <Button
              size="sm"
              variant="ghost"
              icon={<X size={16} />}
              onClick={clearGameSelection}
              title={t('button.cancel', 'Cancel')}
            >
              {t('button.cancel', 'Cancel')}
            </Button>
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
        </div>
      )}
    </div>
  )
})
