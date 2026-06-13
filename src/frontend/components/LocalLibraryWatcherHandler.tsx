import { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LocalLibraryWatchEntry } from 'common/types'
import ContextProvider from 'frontend/state/ContextProvider'
import {
  openInstallGameModal,
  useInstallGameModal
} from 'frontend/state/InstallGameModal'

import ArchiveExtractionDialog from './ArchiveExtractionDialog'

export default function LocalLibraryWatcherHandler() {
  const { t } = useTranslation()
  const { dialogModalOptions, showDialogModal } = useContext(ContextProvider)
  const installModalOpen = useInstallGameModal((state) => state.isOpen)
  const [pendingFolders, setPendingFolders] = useState<
    LocalLibraryWatchEntry[]
  >([])
  const [currentFolder, setCurrentFolder] =
    useState<LocalLibraryWatchEntry | null>(null)

  useEffect(() => {
    const handleFolderAdded = (
      _event: Electron.IpcRendererEvent,
      folder: LocalLibraryWatchEntry
    ): void => {
      setPendingFolders((current) => {
        if (
          current.some(
            (pendingFolder) => pendingFolder.folderPath === folder.folderPath
          )
        ) {
          return current
        }

        return [...current, folder]
      })
    }

    const removeListener: () => void =
      window.api.handleLocalLibraryFolderAdded(handleFolderAdded)

    return () => {
      removeListener()
    }
  }, [])

  useEffect(() => {
    if (
      currentFolder ||
      installModalOpen ||
      dialogModalOptions.showDialog ||
      pendingFolders.length === 0
    ) {
      return
    }

    const [nextFolder, ...remainingFolders] = pendingFolders
    setPendingFolders(remainingFolders)
    setCurrentFolder(nextFolder)
  }, [
    currentFolder,
    dialogModalOptions.showDialog,
    installModalOpen,
    pendingFolders
  ])

  useEffect(() => {
    if (!currentFolder || currentFolder.isArchive) {
      return
    }

    const closePrompt = () => {
      showDialogModal({ showDialog: false })
      setCurrentFolder(null)
    }

    showDialogModal({
      title: t('box.local-library-folder-added.title', 'New game folder found'),
      message: t(
        'box.local-library-folder-added.message',
        'The folder "{{title}}" was added to your watched local library.\n\n{{folderPath}}\n\nDo you want to add it as a game?',
        currentFolder
      ),
      buttons: [
        {
          text: t('add_game', 'Add Game'),
          onClick: () =>
            openInstallGameModal({
              appName: '',
              runner: 'sideload',
              gameInfo: null,
              sideloadTitle: currentFolder.title
            })
        },
        {
          text: t('box.no', 'No')
        }
      ],
      onClose: closePrompt
    })
  }, [currentFolder, showDialogModal, t])

  if (currentFolder?.isArchive) {
    return (
      <ArchiveExtractionDialog
        archive={currentFolder}
        onClose={() => setCurrentFolder(null)}
        onExtracted={(folder) => {
          openInstallGameModal({
            appName: '',
            runner: 'sideload',
            gameInfo: null,
            sideloadTitle: folder.title
          })
          setCurrentFolder(null)
        }}
      />
    )
  }

  return null
}
