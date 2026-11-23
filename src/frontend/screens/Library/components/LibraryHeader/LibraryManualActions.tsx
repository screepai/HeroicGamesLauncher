import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileArchive } from 'lucide-react'
import {
  getArchiveTitle,
  LOCAL_LIBRARY_ARCHIVE_EXTENSIONS
} from 'common/local_library_archive'
import { GameInfo, LocalLibraryWatchEntry } from 'common/types'
import type { VndbGameMatch } from 'common/types/vndb'
import ArchiveExtractionDialog from 'frontend/components/ArchiveExtractionDialog'
import { Button } from 'frontend/components/UI'
import useAppSetting from 'frontend/hooks/useAppSetting'
import { openInstallGameModal } from 'frontend/state/InstallGameModal'
import VndbSyncButton from './VndbSyncButton'

type Props = {
  list: GameInfo[]
  onVndbMatchesChange?: (matches: Record<string, VndbGameMatch>) => void
}

// Fork-only library actions, rendered in the library section header next to
// upstream's "Console mode" / "Add game" buttons.
export default function LibraryManualActions({
  list,
  onVndbMatchesChange
}: Props) {
  const { t } = useTranslation()
  const enableVndbIntegration = useAppSetting('enableVndbIntegration', true)
  const [archiveToExtract, setArchiveToExtract] =
    useState<LocalLibraryWatchEntry | null>(null)

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
    <>
      <Button
        variant="secondary"
        icon={<FileArchive size={16} aria-hidden />}
        onClick={() => void selectArchive()}
      >
        {t('box.extract-archive', 'Extract archive')}
      </Button>
      {enableVndbIntegration && (
        <VndbSyncButton list={list} onMatchesChange={onVndbMatchesChange} />
      )}
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
    </>
  )
}
