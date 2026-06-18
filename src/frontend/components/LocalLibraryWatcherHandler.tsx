import { useContext, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

import type { LocalLibraryWatchEntry } from 'common/types'
import useAppSetting from 'frontend/hooks/useAppSetting'
import ContextProvider from 'frontend/state/ContextProvider'
import {
  openInstallGameModal,
  useInstallGameModal
} from 'frontend/state/InstallGameModal'

import ArchiveExtractionDialog from './ArchiveExtractionDialog'

export default function LocalLibraryWatcherHandler() {
  const { t } = useTranslation()
  const { dialogModalOptions, showDialogModal } = useContext(ContextProvider)
  const enableLocalLibraryWatcher = useAppSetting(
    'enableLocalLibraryWatcher',
    true
  )
  const installModalOpen = useInstallGameModal((state) => state.isOpen)
  const [pendingFolders, setPendingFolders] = useState<
    LocalLibraryWatchEntry[]
  >([])
  const [currentFolder, setCurrentFolder] =
    useState<LocalLibraryWatchEntry | null>(null)

  useEffect(() => {
    if (!enableLocalLibraryWatcher) {
      return
    }

    let active = true

    const appendPendingFolders = (folders: LocalLibraryWatchEntry[]): void => {
      if (!active || folders.length === 0) {
        return
      }

      setPendingFolders((current) => {
        const currentFolderPaths = new Set(
          current.map((pendingFolder) => pendingFolder.folderPath)
        )
        const newFolders = folders.filter(
          (folder) => !currentFolderPaths.has(folder.folderPath)
        )

        if (newFolders.length === 0) {
          return current
        }

        return [...current, ...newFolders]
      })
    }

    const drainPendingFolders = (): void => {
      void window.api.drainLocalLibraryWatcherQueue().then(appendPendingFolders)
    }

    const handleFolderAdded = (): void => drainPendingFolders()

    const removeListener: () => void =
      window.api.handleLocalLibraryFolderAdded(handleFolderAdded)
    drainPendingFolders()

    return () => {
      active = false
      removeListener()
    }
  }, [enableLocalLibraryWatcher])

  useEffect(() => {
    if (enableLocalLibraryWatcher) {
      return
    }

    setPendingFolders([])
    if (currentFolder && !currentFolder.isArchive) {
      showDialogModal({ showDialog: false })
    }
    setCurrentFolder(null)
  }, [currentFolder, enableLocalLibraryWatcher, showDialogModal])

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
              sideloadTitle: currentFolder.title,
              sideloadDefaultPath: currentFolder.folderPath
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
          setPendingFolders((folders) =>
            folders.filter(
              (pendingFolder) => pendingFolder.folderPath !== folder.folderPath
            )
          )
          openInstallGameModal({
            appName: '',
            runner: 'sideload',
            gameInfo: null,
            sideloadTitle: folder.title,
            sideloadDefaultPath: folder.folderPath
          })
          setCurrentFolder(null)
        }}
      />
    )
  }

  return null
}
