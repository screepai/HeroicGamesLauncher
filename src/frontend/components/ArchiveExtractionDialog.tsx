import { memo, useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Checkbox,
  CircularProgress,
  FormControlLabel,
  LinearProgress
} from '@mui/material'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'

import type {
  LocalLibraryArchiveEntry,
  LocalLibraryArchiveExtractionProgress,
  LocalLibraryArchiveInfo,
  LocalLibraryWatchEntry
} from 'common/types'
import { getArchivePart } from 'common/local_library_archive'
import { TextInputField, WarningMessage } from 'frontend/components/UI'
import useAppSetting from 'frontend/hooks/useAppSetting'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from 'frontend/components/UI/Dialog'

import './ArchiveExtractionDialog/index.css'

type ArchiveTreeNode = LocalLibraryArchiveEntry & {
  children: ArchiveTreeNode[]
  name: string
}

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

type Stage =
  | 'prompt'
  | 'multipart-prompt'
  | 'multipart-waiting'
  | 'loading'
  | 'selection'
  | 'extracting'
  | 'delete-prompt'
  | 'deleting'

const PASSWORD_ERROR_MESSAGE = 'Archive password is required or incorrect'
const INCOMPLETE_ARCHIVE_ERROR_MESSAGE =
  'The archive is incomplete. Add the remaining parts and try again.'
const MISSING_ARCHIVE_PARTS_ERROR_MESSAGE = 'Archive parts are missing:'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

function isPasswordError(error: unknown): boolean {
  return getErrorMessage(error).includes(PASSWORD_ERROR_MESSAGE)
}

function isIncompleteArchiveError(error: unknown): boolean {
  return getErrorMessage(error).includes(INCOMPLETE_ARCHIVE_ERROR_MESSAGE)
}

function isMissingArchivePartsError(error: unknown): boolean {
  return getErrorMessage(error).includes(MISSING_ARCHIVE_PARTS_ERROR_MESSAGE)
}

function isArchivePartsError(error: unknown): boolean {
  return isIncompleteArchiveError(error) || isMissingArchivePartsError(error)
}

function buildArchiveTree(
  entries: LocalLibraryArchiveEntry[]
): ArchiveTreeNode[] {
  const nodes = new Map<string, ArchiveTreeNode>()

  for (const entry of entries) {
    nodes.set(entry.path, {
      ...entry,
      children: [],
      name: entry.path.split('/').pop() ?? entry.path
    })
  }

  const roots: ArchiveTreeNode[] = []
  for (const node of nodes.values()) {
    const separatorIndex = node.path.lastIndexOf('/')
    const parentPath =
      separatorIndex === -1 ? undefined : node.path.slice(0, separatorIndex)
    const parent = parentPath ? nodes.get(parentPath) : undefined

    if (parent) {
      parent.children.push(node)
    } else {
      roots.push(node)
    }
  }

  const sortNodes = (treeNodes: ArchiveTreeNode[]) => {
    treeNodes.sort(
      (left, right) =>
        Number(right.isDirectory) - Number(left.isDirectory) ||
        left.name.localeCompare(right.name)
    )
    treeNodes.forEach((node) => sortNodes(node.children))
  }
  sortNodes(roots)

  return roots
}

function getSelectablePaths(node: ArchiveTreeNode): string[] {
  if (!node.isDirectory || node.children.length === 0) {
    return [node.path]
  }

  return node.children.flatMap(getSelectablePaths)
}

function getAllSelectablePaths(nodes: ArchiveTreeNode[]): string[] {
  return nodes.flatMap(getSelectablePaths)
}

function isValidFolderName(folderName: string): boolean {
  const normalizedName = folderName.trim()
  const hasControlCharacter = [...normalizedName].some(
    (character) => character.charCodeAt(0) < 32
  )
  return (
    normalizedName.length > 0 &&
    normalizedName !== '.' &&
    normalizedName !== '..' &&
    !hasControlCharacter &&
    !/[<>:"/\\|?*]/.test(normalizedName) &&
    !/[. ]$/.test(normalizedName)
  )
}

const ArchiveTreeItem = memo(function ArchiveTreeItem({
  node,
  selectedPaths,
  finalRootPath,
  onToggle,
  onSelectFinalRoot
}: {
  node: ArchiveTreeNode
  selectedPaths: Set<string>
  finalRootPath: string | null
  onToggle: (paths: string[], selected: boolean) => void
  onSelectFinalRoot: (node: ArchiveTreeNode) => void
}) {
  const { t } = useTranslation()
  const selectablePaths = getSelectablePaths(node)
  const selectedCount = selectablePaths.filter((path) =>
    selectedPaths.has(path)
  ).length
  const checked = selectedCount === selectablePaths.length
  const indeterminate = selectedCount > 0 && !checked
  const selectableWithinRoot =
    !finalRootPath ||
    node.path === finalRootPath ||
    node.path.startsWith(`${finalRootPath}/`)

  return (
    <li>
      <div className="archiveTreeRow">
        <FormControlLabel
          className="archiveTreeLabel"
          control={
            <Checkbox
              className="archiveTreeCheckbox"
              checked={checked}
              disabled={!selectableWithinRoot}
              indeterminate={indeterminate}
              onChange={() => onToggle(selectablePaths, !checked)}
              size="small"
            />
          }
          label={
            <span className="archiveTreeEntry">
              {node.isDirectory ? (
                <FolderOutlinedIcon fontSize="small" />
              ) : (
                <InsertDriveFileOutlinedIcon fontSize="small" />
              )}
              <span>{node.name}</span>
            </span>
          }
        />
        {node.isDirectory && (
          <button
            className={[
              'archiveFinalRootButton',
              finalRootPath === node.path ? 'is-selected' : ''
            ]
              .filter(Boolean)
              .join(' ')}
            type="button"
            aria-pressed={finalRootPath === node.path}
            aria-label={t(
              'box.local-library-archive.use-folder-as-final',
              'Use {{folder}} as the final folder',
              { folder: node.name }
            )}
            onClick={() => onSelectFinalRoot(node)}
          >
            {finalRootPath === node.path && <span aria-hidden="true">✓</span>}
            {finalRootPath === node.path
              ? t('box.local-library-archive.final-folder', 'Final folder')
              : t(
                  'box.local-library-archive.use-as-final-folder',
                  'Use as final'
                )}
          </button>
        )}
      </div>
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <ArchiveTreeItem
              key={child.path}
              node={child}
              selectedPaths={selectedPaths}
              finalRootPath={finalRootPath}
              onToggle={onToggle}
              onSelectFinalRoot={onSelectFinalRoot}
            />
          ))}
        </ul>
      )}
    </li>
  )
})

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
  const [stage, setStage] = useState<Stage>('prompt')
  const [tree, setTree] = useState<ArchiveTreeNode[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [folderName, setFolderName] = useState(activeArchive.title)
  const [password, setPassword] = useState('')
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [archiveInfo, setArchiveInfo] =
    useState<LocalLibraryArchiveInfo | null>(null)
  const [finalRootPath, setFinalRootPath] = useState<string | null>(null)
  const [extractedFolder, setExtractedFolder] =
    useState<ExtractedFolder | null>(null)
  const [extractionProgress, setExtractionProgress] =
    useState<LocalLibraryArchiveExtractionProgress>({ percent: 0 })
  const [previousArchivePath, setPreviousArchivePath] = useState<string | null>(
    null
  )
  const [deletePreviousArchive, setDeletePreviousArchive] = useState(false)
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
      setPassword('')
      setPasswordRequired(false)
      setArchiveInfo(null)
      setFinalRootPath(null)
      setExtractedFolder(null)
      setExtractionProgress({ percent: 0 })
      setPreviousArchivePath(nextPreviousArchivePath)
      setDeletePreviousArchive(false)
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
        isPasswordError(loadError)
          ? t(
              'box.local-library-archive.password-error',
              'Enter the archive password and try again.'
            )
          : isIncompleteArchiveError(loadError)
            ? t(
                'box.local-library-archive.incomplete',
                'The archive is incomplete. Add the remaining parts and try again.'
              )
            : loadError instanceof Error
              ? loadError.message
              : t(
                  'box.local-library-archive.read-error',
                  'Unable to read the archive.'
                )
      )
      setStage(
        archiveInfo?.isMultipart && isArchivePartsError(loadError)
          ? 'multipart-waiting'
          : 'prompt'
      )
    }
  }

  const inspectArchive = async (): Promise<LocalLibraryArchiveInfo | null> => {
    setStage('loading')
    setError('')

    try {
      const info = await window.api.inspectLocalLibraryArchive(
        activeArchive.folderPath
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

  const prepareArchive = async () => {
    const info = await inspectArchive()
    if (!info) {
      return
    }

    if (info.isMultipart) {
      setStage('multipart-prompt')
      return
    }

    await loadArchive(info.archivePath)
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

  const extractArchive = async () => {
    if (!isValidFolderName(folderName) || selectedPaths.size === 0) {
      return
    }

    setStage('extracting')
    setExtractionProgress({ percent: 0 })
    setError('')

    try {
      let retainedPreviousArchivePath = previousArchivePath
      if (deletePreviousArchive && previousArchivePath) {
        await window.api.deleteLocalLibraryArchive(previousArchivePath)
        retainedPreviousArchivePath = null
        setPreviousArchivePath(null)
      }

      const extractedFolder = await window.api.extractLocalLibraryArchive({
        archivePath: archiveInfo?.archivePath ?? activeArchive.folderPath,
        cleanupPath: activeArchive.cleanupAfterExtractionPath,
        destinationDirectory: activeArchive.extractionDestinationDirectory,
        destinationName: folderName.trim(),
        password: password || undefined,
        rootPath: finalRootPath ?? undefined,
        selectedPaths: [...selectedPaths]
      })
      const nestedArchives = await window.api
        .findLocalLibraryNestedArchives(extractedFolder.folderPath)
        .catch(() => [])

      if (nestedArchives.length > 0) {
        resetArchiveDialog(
          nestedArchives[0],
          activeArchive.cleanupAfterExtractionPath
            ? retainedPreviousArchivePath
            : (archiveInfo?.archivePath ?? activeArchive.folderPath)
        )
      } else if (
        askToDeleteArchiveAfterExtraction &&
        !activeArchive.cleanupAfterExtractionPath
      ) {
        setExtractedFolder(extractedFolder)
        setStage('delete-prompt')
      } else {
        onExtracted(extractedFolder)
      }
    } catch (extractionError) {
      if (isPasswordError(extractionError)) {
        setPasswordRequired(true)
      }
      setError(
        isPasswordError(extractionError)
          ? t(
              'box.local-library-archive.password-error',
              'Enter the archive password and try again.'
            )
          : isIncompleteArchiveError(extractionError)
            ? t(
                'box.local-library-archive.incomplete',
                'The archive is incomplete. Add the remaining parts and try again.'
              )
            : extractionError instanceof Error
              ? extractionError.message
              : t(
                  'box.local-library-archive.extract-error',
                  'Unable to extract the archive.'
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
  const passwordMissing = passwordRequired && password.length === 0
  const closeDialog = stage === 'delete-prompt' ? finishExtraction : onClose

  return (
    <Dialog
      onClose={isBusy ? () => {} : closeDialog}
      showCloseButton={!isBusy}
      className="ArchiveExtractionDialog"
    >
      <DialogHeader>
        {stage === 'prompt'
          ? isNestedArchive
            ? t(
                'box.local-library-archive.nested-title',
                'Nested archive detected'
              )
            : t(
                'box.local-library-archive.title',
                'Compressed archive detected'
              )
          : stage === 'multipart-prompt' || stage === 'multipart-waiting'
            ? t(
                'box.local-library-archive.multipart-title',
                'Multipart archive detected'
              )
            : stage === 'delete-prompt' || stage === 'deleting'
              ? t(
                  'box.local-library-archive.complete-title',
                  'Extraction complete'
                )
              : t(
                  'box.local-library-archive.contents-title',
                  'Choose archive contents'
                )}
      </DialogHeader>
      <DialogContent className="archiveExtractionContent">
        {stage === 'prompt' && (
          <>
            {isNestedArchive ? (
              <div className="archiveNestedNotice" role="status">
                <p>
                  {t(
                    'box.local-library-archive.nested-message',
                    'Heroic found "{{title}}" inside "{{archive}}". Extract it to continue to the game files.',
                    {
                      title: activeArchive.title,
                      archive: previousArchiveFileName
                    }
                  )}
                </p>
              </div>
            ) : (
              <p>
                {source === 'manual'
                  ? t(
                      'box.local-library-archive.manual-message',
                      'Do you want to extract the archive "{{title}}" before adding the game?',
                      activeArchive
                    )
                  : t(
                      'box.local-library-archive.message',
                      'The archive "{{title}}" was added to your watched local library. Do you want to extract it before adding the game?',
                      activeArchive
                    )}
              </p>
            )}
            <code className="archivePath">{displayArchiveName}</code>
            {previousArchivePath && (
              <FormControlLabel
                className="archiveDeletePreviousLabel"
                control={
                  <Checkbox
                    className="archiveDeletePreviousCheckbox"
                    checked={deletePreviousArchive}
                    onChange={(event) =>
                      setDeletePreviousArchive(event.target.checked)
                    }
                    size="small"
                  />
                }
                label={t(
                  'box.local-library-archive.delete-previous-archive',
                  'Delete the previous archive "{{archive}}" when extracting this one',
                  { archive: previousArchiveFileName }
                )}
              />
            )}
          </>
        )}

        {stage === 'multipart-prompt' && archiveInfo && (
          <>
            <p>
              {t(
                'box.local-library-archive.multipart-message',
                'Heroic cannot tell from the filename whether more parts are still coming. Use the available parts to let 7-Zip verify the archive, or wait for more parts.'
              )}
            </p>
            <p>
              {t(
                'box.local-library-archive.parts-found',
                '{{count}} part found',
                { count: archiveInfo.partPaths.length }
              )}
            </p>
            <code className="archivePath">{displayArchiveName}</code>
          </>
        )}

        {stage === 'multipart-waiting' && archiveInfo && (
          <>
            <p>
              {t(
                'box.local-library-archive.waiting-message',
                'Wait for all archive parts to finish downloading, then choose Check available parts.'
              )}
            </p>
            <p>
              {t(
                'box.local-library-archive.parts-found',
                '{{count}} part found',
                { count: archiveInfo.partPaths.length }
              )}
            </p>
            <code className="archivePath">{displayArchiveName}</code>
          </>
        )}

        {isBusy &&
          (stage === 'extracting' ? (
            <div className="archiveExtractionProgress">
              <div className="archiveExtractionProgressHeader">
                <span>
                  {t(
                    'box.local-library-archive.extracting',
                    'Extracting selected contents...'
                  )}
                </span>
                <span>{extractionProgress.percent}%</span>
              </div>
              <LinearProgress
                variant="determinate"
                value={extractionProgress.percent}
              />
              <div className="archiveExtractionCurrentFile" aria-live="polite">
                <b>
                  {t(
                    'box.local-library-archive.current-file',
                    'Currently extracting'
                  )}
                  :
                </b>
                <code title={extractionProgress.file}>
                  {extractionProgress.file ??
                    t(
                      'box.local-library-archive.preparing',
                      'Preparing extraction...'
                    )}
                </code>
              </div>
            </div>
          ) : (
            <div className="archiveExtractionLoading">
              <CircularProgress size={32} />
              <span>
                {stage === 'loading'
                  ? t(
                      'box.local-library-archive.reading',
                      'Reading archive contents...'
                    )
                  : t(
                      'box.local-library-archive.deleting',
                      'Deleting original archive...'
                    )}
              </span>
            </div>
          ))}

        {stage === 'selection' && (
          <>
            <TextInputField
              htmlId="archive-extraction-folder-name"
              label={t(
                'box.local-library-archive.folder-name',
                'Final folder name'
              )}
              value={folderName}
              onChange={setFolderName}
              warning={
                folderNameValid
                  ? undefined
                  : t(
                      'box.local-library-archive.invalid-folder-name',
                      'Enter a valid folder name.'
                    )
              }
            />

            <div className="archiveSelectionActions">
              <button
                className="button is-secondary"
                onClick={() =>
                  setSelectedPaths(
                    new Set(
                      selectedPaths.size === 0
                        ? getAllSelectablePaths(tree)
                        : []
                    )
                  )
                }
              >
                {selectedPaths.size === 0
                  ? t('box.select-all', 'Select All')
                  : t('box.unselect-all', 'Unselect All')}
              </button>
              <span>
                {t(
                  'box.local-library-archive.selected-count',
                  '{{count}} selected',
                  { count: selectedPaths.size }
                )}
              </span>
            </div>

            <div
              className="archiveFinalRoot"
              role="group"
              aria-labelledby="archive-final-root-label"
            >
              <div className="archiveFinalRootHeader">
                <strong id="archive-final-root-label">
                  {t('box.local-library-archive.final-folder', 'Final folder')}
                </strong>
                <span>
                  {t(
                    'box.local-library-archive.final-folder-help',
                    'Choose Automatic, or mark a directory in the archive as the final folder.'
                  )}
                </span>
              </div>
              <button
                className={[
                  'archiveFinalRootButton',
                  'archiveAutomaticRootButton',
                  finalRootPath === null ? 'is-selected' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                type="button"
                aria-pressed={finalRootPath === null}
                onClick={useAutomaticRoot}
              >
                {finalRootPath === null && <span aria-hidden="true">✓</span>}
                <span className="archiveAutomaticRootText">
                  <strong>
                    {t(
                      'box.local-library-archive.automatic-folder',
                      'Automatic'
                    )}
                  </strong>
                  <small>
                    {t(
                      'box.local-library-archive.automatic-folder-description',
                      'Let Heroic choose from the archive structure.'
                    )}
                  </small>
                </span>
              </button>
            </div>

            <div className="archiveTreeHelp">
              <span>
                {t(
                  'box.local-library-archive.use-as-final-folder-help',
                  'Use the action beside a directory to make it the final folder.'
                )}
              </span>
            </div>

            <div className="archiveTree" role="tree">
              <ul>
                {tree.map((node) => (
                  <ArchiveTreeItem
                    key={node.path}
                    node={node}
                    selectedPaths={selectedPaths}
                    finalRootPath={finalRootPath}
                    onToggle={togglePaths}
                    onSelectFinalRoot={selectFinalRoot}
                  />
                ))}
              </ul>
            </div>
          </>
        )}

        {stage === 'delete-prompt' && (
          <>
            <p>
              {archiveInfo?.isMultipart
                ? t(
                    'box.local-library-archive.delete-multipart-message',
                    'Do you want to delete all {{count}} parts of "{{title}}" now that extraction is complete?',
                    {
                      count: archiveInfo.partPaths.length,
                      title: activeArchive.title
                    }
                  )
                : t(
                    'box.local-library-archive.delete-message',
                    'Do you want to delete the original archive now that extraction is complete?'
                  )}
            </p>
            <code className="archivePath">{displayArchiveName}</code>
          </>
        )}

        {passwordRequired && (stage === 'prompt' || stage === 'selection') && (
          <TextInputField
            htmlId="archive-extraction-password"
            label={t('box.local-library-archive.password', 'Archive password')}
            value={password}
            onChange={setPassword}
            type="password"
            autoComplete="off"
          />
        )}

        {error && <WarningMessage>{error}</WarningMessage>}
      </DialogContent>
      <DialogFooter>
        {stage !== 'delete-prompt' && (
          <button
            className="button is-secondary"
            onClick={onClose}
            disabled={isBusy}
          >
            {t('button.cancel', 'Cancel')}
          </button>
        )}
        {stage === 'prompt' && (
          <button
            className="button is-success"
            onClick={() => void prepareArchive()}
            disabled={passwordMissing}
          >
            {error ? t('button.retry', 'Retry') : t('box.extract', 'Extract')}
          </button>
        )}
        {stage === 'multipart-prompt' && archiveInfo && (
          <>
            <button
              className="button is-secondary"
              onClick={() => void loadArchive(archiveInfo.archivePath)}
            >
              {t(
                'box.local-library-archive.use-available-parts',
                'Use available parts'
              )}
            </button>
            <button
              className="button is-success"
              onClick={() => setStage('multipart-waiting')}
            >
              {t(
                'box.local-library-archive.wait-for-parts',
                'Wait for more parts'
              )}
            </button>
          </>
        )}
        {stage === 'multipart-waiting' && (
          <button
            className="button is-success"
            onClick={() => void finishWaiting()}
          >
            {t(
              'box.local-library-archive.check-available-parts',
              'Check available parts'
            )}
          </button>
        )}
        {stage === 'selection' && (
          <button
            className="button is-success"
            onClick={() => void extractArchive()}
            disabled={
              !folderNameValid || selectedPaths.size === 0 || passwordMissing
            }
          >
            {t('box.extract-selected', 'Extract Selected')}
          </button>
        )}
        {stage === 'delete-prompt' && (
          <>
            <button className="button is-secondary" onClick={finishExtraction}>
              {t('box.local-library-archive.keep-archive', 'Keep Archive')}
            </button>
            <button
              className="button is-danger"
              onClick={() => void deleteArchive()}
            >
              {t('box.local-library-archive.delete-archive', 'Delete Archive')}
            </button>
          </>
        )}
      </DialogFooter>
    </Dialog>
  )
}
