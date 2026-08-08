import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox, FormControlLabel } from '@mui/material'
import type { TFunction } from 'i18next'

import type {
  LocalLibraryArchiveExtractionProgress,
  LocalLibraryArchiveInfo,
  LocalLibraryWatchEntry
} from 'common/types'
import { getArchivePart } from 'common/local_library_archive'
import useAppSetting from 'frontend/hooks/useAppSetting'
import { Dialog } from 'frontend/components/UI/Dialog'
import {
  buildArchiveTree,
  getAllSelectablePaths,
  getSelectablePaths,
  type ArchiveTreeNode
} from './ArchiveExtractionDialog/ArchiveTree'
import {
  ArchiveExtractionContent,
  ArchiveExtractionFooter,
  ArchiveExtractionHeader,
  type ArchiveExtractionStage
} from './ArchiveExtractionDialog/ArchiveExtractionStages'
import {
  isArchivePartsError,
  isIncompleteArchiveError,
  isPasswordError,
  isValidFolderName
} from './ArchiveExtractionDialog/logic'

import './ArchiveExtractionDialog/index.css'

type Props = {
  archive: LocalLibraryWatchEntry
  onClose: () => void
  onExtracted: (folder: { folderPath: string; title: string }) => void
  source?: 'manual' | 'watcher'
}

type ExtractedFolder = {
  folderPath: string
  title: string
}

function getArchiveErrorMessage(
  error: unknown,
  t: TFunction,
  fallbackMessage: string
): string {
  if (isPasswordError(error)) {
    return t(
      'box.local-library-archive.password-error',
      'Enter the archive password and try again.'
    )
  }
  if (isIncompleteArchiveError(error)) {
    return t(
      'box.local-library-archive.incomplete',
      'The archive is incomplete. Add the remaining parts and try again.'
    )
  }
  return error instanceof Error ? error.message : fallbackMessage
}

export default function ArchiveExtractionDialog({
  archive,
  onClose,
  onExtracted,
  source = 'watcher'
}: Props) {
  const { t } = useTranslation()
  const askToDeleteArchiveAfterExtraction = useAppSetting(
    'askToDeleteArchiveAfterExtraction',
    true
  )
  const [activeArchive, setActiveArchive] = useState(archive)
  const [stage, setStage] = useState<ArchiveExtractionStage>('prompt')
  const [tree, setTree] = useState<ArchiveTreeNode[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [folderName, setFolderName] = useState(activeArchive.title)
  const [destinationDirectory, setDestinationDirectory] = useState(
    activeArchive.extractionDestinationDirectory ?? ''
  )
  const [password, setPassword] = useState('')
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [archiveInfo, setArchiveInfo] =
    useState<LocalLibraryArchiveInfo | null>(null)
  const [finalRootPath, setFinalRootPath] = useState<string | null>(null)
  const [extractedFolder, setExtractedFolder] =
    useState<ExtractedFolder | null>(null)
  const [extractionProgress, setExtractionProgress] =
    useState<LocalLibraryArchiveExtractionProgress>({ percent: 0 })
  const [nestedArchives, setNestedArchives] = useState<
    LocalLibraryWatchEntry[]
  >([])
  const [previousArchivePath, setPreviousArchivePath] = useState<string | null>(
    null
  )
  const [deletePreviousArchive, setDeletePreviousArchive] = useState(false)
  const [
    deleteNestedArchiveAfterExtraction,
    setDeleteNestedArchiveAfterExtraction
  ] = useState(false)
  const [error, setError] = useState('')

  const resetArchiveDialog = useCallback(
    (
      nextArchive: LocalLibraryWatchEntry,
      nextPreviousArchivePath: string | null = null
    ) => {
      setActiveArchive(nextArchive)
      setStage('prompt')
      setTree([])
      setSelectedPaths(new Set())
      setFolderName(nextArchive.title)
      setDestinationDirectory(nextArchive.extractionDestinationDirectory ?? '')
      setPassword('')
      setPasswordRequired(false)
      setArchiveInfo(null)
      setFinalRootPath(null)
      setExtractedFolder(null)
      setExtractionProgress({ percent: 0 })
      setNestedArchives([])
      setPreviousArchivePath(nextPreviousArchivePath)
      setDeletePreviousArchive(false)
      setDeleteNestedArchiveAfterExtraction(false)
      setError('')
    },
    []
  )

  useEffect(() => {
    resetArchiveDialog(archive)
  }, [archive, resetArchiveDialog])

  useEffect(
    () =>
      window.api.onLocalLibraryArchiveExtractionProgress(
        (_event, archivePath, progress) => {
          const currentArchivePath =
            archiveInfo?.archivePath ?? activeArchive.folderPath
          if (archivePath === currentArchivePath) {
            setExtractionProgress(progress)
          }
        }
      ),
    [activeArchive.folderPath, archiveInfo?.archivePath]
  )

  const archiveFileName =
    activeArchive.folderPath.split(/[\\/]/).pop() ?? activeArchive.folderPath
  const previousArchiveFileName = previousArchivePath?.split(/[\\/]/).pop()
  const isNestedArchive = previousArchivePath !== null
  const shouldOfferNestedArchiveCleanup =
    isNestedArchive && !activeArchive.cleanupAfterExtractionPath
  const displayArchiveName =
    archiveInfo?.isMultipart || getArchivePart(archiveFileName)
      ? activeArchive.title
      : activeArchive.folderPath

  const loadArchive = async (archivePath: string) => {
    setStage('loading')
    setError('')

    try {
      const entries = await window.api.listLocalLibraryArchive({
        archivePath,
        password: password || undefined
      })
      const archiveTree = buildArchiveTree(entries)
      setTree(archiveTree)
      setSelectedPaths(new Set(getAllSelectablePaths(archiveTree)))
      setPasswordRequired(entries.some((entry) => entry.isEncrypted))
      setStage('selection')
    } catch (loadError) {
      if (isPasswordError(loadError)) {
        setPasswordRequired(true)
      }
      setError(
        getArchiveErrorMessage(
          loadError,
          t,
          t(
            'box.local-library-archive.read-error',
            'Unable to read the archive.'
          )
        )
      )
      setStage(
        archiveInfo?.isMultipart && isArchivePartsError(loadError)
          ? 'multipart-waiting'
          : 'prompt'
      )
    }
  }

  const inspectArchive = async (
    archiveToInspect = activeArchive
  ): Promise<LocalLibraryArchiveInfo | null> => {
    setStage('loading')
    setError('')

    try {
      const info = await window.api.inspectLocalLibraryArchive(
        archiveToInspect.folderPath
      )
      setArchiveInfo(info)
      return info
    } catch (inspectionError) {
      setError(
        inspectionError instanceof Error
          ? inspectionError.message
          : t(
              'box.local-library-archive.read-error',
              'Unable to read the archive.'
            )
      )
      setStage('prompt')
      return null
    }
  }

  const prepareArchive = async (archiveToPrepare = activeArchive) => {
    const info = await inspectArchive(archiveToPrepare)
    if (!info) {
      return
    }

    if (info.isMultipart) {
      setStage('multipart-prompt')
      return
    }

    await loadArchive(info.archivePath)
  }

  const openNestedArchive = (
    nestedArchive: LocalLibraryWatchEntry,
    nextPreviousArchivePath: string | null,
    shouldPrepareImmediately = false
  ) => {
    resetArchiveDialog(nestedArchive, nextPreviousArchivePath)
    if (shouldPrepareImmediately) {
      void prepareArchive(nestedArchive)
    }
  }

  const finishWaiting = async () => {
    const info = await inspectArchive()
    if (!info) {
      return
    }

    if (info.missingParts.length > 0) {
      setError(
        t(
          'box.local-library-archive.missing-parts',
          'Archive parts are missing: {{parts}}',
          { parts: info.missingParts.join(', ') }
        )
      )
      setStage('multipart-waiting')
      return
    }

    await loadArchive(info.archivePath)
  }

  const togglePaths = useCallback((paths: string[], selected: boolean) => {
    setSelectedPaths((currentPaths) => {
      const nextPaths = new Set(currentPaths)
      for (const path of paths) {
        if (selected) {
          nextPaths.add(path)
        } else {
          nextPaths.delete(path)
        }
      }
      return nextPaths
    })
  }, [])

  const selectFinalRoot = useCallback((node: ArchiveTreeNode) => {
    setFinalRootPath(node.path)
    setFolderName(node.name)
    setSelectedPaths(new Set(getSelectablePaths(node)))
  }, [])

  const useAutomaticRoot = () => {
    setFinalRootPath(null)
    setSelectedPaths(new Set(getAllSelectablePaths(tree)))
  }

  const deletePreviousArchiveIfRequested = async (): Promise<string | null> => {
    if (!deletePreviousArchive || !previousArchivePath) {
      return previousArchivePath
    }

    await window.api.deleteLocalLibraryArchive(previousArchivePath)
    setPreviousArchivePath(null)
    return null
  }

  const deleteNestedArchiveIfRequested = async (
    archivePath: string
  ): Promise<string | null> => {
    if (
      !deleteNestedArchiveAfterExtraction ||
      !shouldOfferNestedArchiveCleanup
    ) {
      return archivePath
    }

    try {
      await window.api.deleteLocalLibraryArchive(archivePath)
      return null
    } catch (deletionError) {
      setError(
        deletionError instanceof Error
          ? deletionError.message
          : t(
              'box.local-library-archive.delete-nested-archive-error',
              'Unable to delete the selected nested archive.'
            )
      )
      return archivePath
    }
  }

  const continueAfterExtraction = async (
    nextExtractedFolder: ExtractedFolder,
    retainedActiveArchivePath: string | null,
    retainedPreviousArchivePath: string | null
  ) => {
    const foundNestedArchives = await window.api
      .findLocalLibraryNestedArchives(nextExtractedFolder.folderPath)
      .catch(() => [])

    if (foundNestedArchives.length > 0) {
      const nextPreviousArchivePath = activeArchive.cleanupAfterExtractionPath
        ? retainedPreviousArchivePath
        : (retainedActiveArchivePath ?? retainedPreviousArchivePath)
      const [nestedArchive] = foundNestedArchives
      if (
        foundNestedArchives.length === 1 &&
        nestedArchive.cleanupAfterExtractionPath
      ) {
        openNestedArchive(nestedArchive, nextPreviousArchivePath, true)
        return
      }

      setNestedArchives(foundNestedArchives)
      setExtractedFolder(nextExtractedFolder)
      setPreviousArchivePath(nextPreviousArchivePath)
      setStage('nested-selection')
      return
    }

    if (
      askToDeleteArchiveAfterExtraction &&
      !activeArchive.cleanupAfterExtractionPath &&
      retainedActiveArchivePath
    ) {
      setExtractedFolder(nextExtractedFolder)
      setStage('delete-prompt')
      return
    }

    onExtracted(nextExtractedFolder)
  }

  const extractArchive = async () => {
    if (
      !isValidFolderName(folderName) ||
      selectedPaths.size === 0 ||
      (isNestedArchive && !destinationDirectory.trim())
    ) {
      return
    }

    setStage('extracting')
    setExtractionProgress({ percent: 0 })
    setError('')

    try {
      const retainedPreviousArchivePath =
        await deletePreviousArchiveIfRequested()

      const nextExtractedFolder = await window.api.extractLocalLibraryArchive({
        archivePath: archiveInfo?.archivePath ?? activeArchive.folderPath,
        cleanupPath: activeArchive.cleanupAfterExtractionPath,
        destinationDirectory: destinationDirectory.trim() || undefined,
        destinationName: folderName.trim(),
        password: password || undefined,
        rootPath: finalRootPath ?? undefined,
        selectedPaths: [...selectedPaths]
      })
      const activeArchivePath =
        archiveInfo?.archivePath ?? activeArchive.folderPath
      const retainedActiveArchivePath =
        await deleteNestedArchiveIfRequested(activeArchivePath)
      await continueAfterExtraction(
        nextExtractedFolder,
        retainedActiveArchivePath,
        retainedPreviousArchivePath
      )
    } catch (extractionError) {
      if (isPasswordError(extractionError)) {
        setPasswordRequired(true)
      }
      setError(
        getArchiveErrorMessage(
          extractionError,
          t,
          t(
            'box.local-library-archive.extract-error',
            'Unable to extract the archive.'
          )
        )
      )
      setStage(
        archiveInfo?.isMultipart && isArchivePartsError(extractionError)
          ? 'multipart-waiting'
          : 'selection'
      )
    }
  }

  const finishExtraction = () => {
    if (extractedFolder) {
      onExtracted(extractedFolder)
    }
  }

  const useExtractedFolderAsIs = () => {
    if (!extractedFolder) {
      return
    }

    setNestedArchives([])
    if (
      askToDeleteArchiveAfterExtraction &&
      !activeArchive.cleanupAfterExtractionPath
    ) {
      setStage('delete-prompt')
    } else {
      onExtracted(extractedFolder)
    }
  }

  const deleteArchive = async () => {
    setStage('deleting')
    setError('')

    try {
      await window.api.deleteLocalLibraryArchive(
        archiveInfo?.archivePath ?? activeArchive.folderPath
      )
      finishExtraction()
    } catch (deletionError) {
      setError(
        deletionError instanceof Error
          ? deletionError.message
          : t(
              'box.local-library-archive.delete-error',
              'Unable to delete the original archive.'
            )
      )
      setStage('delete-prompt')
    }
  }

  const isBusy =
    stage === 'loading' || stage === 'extracting' || stage === 'deleting'
  const folderNameValid = isValidFolderName(folderName)
  const destinationDirectoryValid =
    !isNestedArchive || destinationDirectory.trim().length > 0
  const passwordMissing = passwordRequired && password.length === 0
  const closeDialog = stage === 'delete-prompt' ? finishExtraction : onClose
  const deletePreviousArchiveControl = previousArchivePath && (
    <FormControlLabel
      className="archiveDeletePreviousLabel"
      control={
        <Checkbox
          className="archiveDeletePreviousCheckbox"
          checked={deletePreviousArchive}
          onChange={(event) => setDeletePreviousArchive(event.target.checked)}
          size="small"
        />
      }
      label={t(
        'box.local-library-archive.delete-previous-archive',
        'Delete the previous archive "{{archive}}" when extracting this one',
        { archive: previousArchiveFileName }
      )}
    />
  )
  const deleteNestedArchiveControl = shouldOfferNestedArchiveCleanup && (
    <FormControlLabel
      className="archiveDeletePreviousLabel"
      control={
        <Checkbox
          className="archiveDeletePreviousCheckbox"
          checked={deleteNestedArchiveAfterExtraction}
          onChange={(event) =>
            setDeleteNestedArchiveAfterExtraction(event.target.checked)
          }
          size="small"
        />
      }
      label={t(
        'box.local-library-archive.delete-nested-archive',
        'Delete this nested archive "{{archive}}" after extraction',
        { archive: archiveFileName }
      )}
    />
  )
  const archiveCleanupControls = (deleteNestedArchiveControl ||
    deletePreviousArchiveControl) && (
    <div
      className="archiveCleanupOptions"
      role="group"
      aria-label={t('box.local-library-archive.cleanup-title', 'Cleanup')}
    >
      <strong>{t('box.local-library-archive.cleanup-title', 'Cleanup')}</strong>
      {deleteNestedArchiveControl}
      {deletePreviousArchiveControl}
    </div>
  )

  return (
    <Dialog
      onClose={isBusy ? () => {} : closeDialog}
      showCloseButton={!isBusy}
      className="ArchiveExtractionDialog"
    >
      <ArchiveExtractionHeader
        isNestedArchive={isNestedArchive}
        stage={stage}
      />
      <ArchiveExtractionContent
        model={{
          archiveInfo,
          displayArchiveName,
          error,
          extractedFolder,
          extractionProgress,
          isNestedArchive,
          nestedArchives,
          password,
          passwordRequired,
          previousArchiveFileName,
          previousArchivePath,
          promptCleanupControl: deletePreviousArchiveControl,
          selection: {
            defaultDestinationDirectory:
              activeArchive.extractionDestinationDirectory,
            destinationDirectory,
            destinationDirectoryValid,
            finalRootPath,
            folderName,
            folderNameValid,
            selectedPaths,
            tree
          },
          selectionCleanupControls: archiveCleanupControls,
          source,
          stage,
          title: activeArchive.title
        }}
        actions={{
          onOpenArchive: openNestedArchive,
          onPasswordChange: setPassword,
          selection: {
            onDestinationDirectoryChange: setDestinationDirectory,
            onFolderNameChange: setFolderName,
            onSelectFinalRoot: selectFinalRoot,
            onToggleAll: () =>
              setSelectedPaths(
                new Set(
                  selectedPaths.size === 0 ? getAllSelectablePaths(tree) : []
                )
              ),
            onTogglePaths: togglePaths,
            onUseAutomaticRoot: useAutomaticRoot
          }
        }}
      />
      <ArchiveExtractionFooter
        stage={stage}
        archiveInfo={archiveInfo}
        canExtractSelection={
          folderNameValid &&
          destinationDirectoryValid &&
          selectedPaths.size > 0 &&
          !passwordMissing
        }
        error={error}
        isBusy={isBusy}
        passwordMissing={passwordMissing}
        actions={{
          onCancel: onClose,
          onCheckParts: () => void finishWaiting(),
          onDeleteArchive: () => void deleteArchive(),
          onExtractSelection: () => void extractArchive(),
          onFinish: finishExtraction,
          onPrepareArchive: () => void prepareArchive(),
          onUseAvailableParts: () =>
            archiveInfo && void loadArchive(archiveInfo.archivePath),
          onUseFolderAsIs: useExtractedFolderAsIs,
          onWaitForParts: () => setStage('multipart-waiting')
        }}
      />
    </Dialog>
  )
}
