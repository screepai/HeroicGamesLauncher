import { memo, useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox, CircularProgress, FormControlLabel } from '@mui/material'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'

import type {
  LocalLibraryArchiveEntry,
  LocalLibraryWatchEntry
} from 'common/types'
import { TextInputField, WarningMessage } from 'frontend/components/UI'
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
  | 'loading'
  | 'selection'
  | 'extracting'
  | 'delete-prompt'
  | 'deleting'

function isPasswordError(error: unknown): boolean {
  return (
    error instanceof Error &&
    error.message === 'Archive password is required or incorrect'
  )
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
            onClick={() => onSelectFinalRoot(node)}
          >
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
  const [stage, setStage] = useState<Stage>('prompt')
  const [tree, setTree] = useState<ArchiveTreeNode[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [folderName, setFolderName] = useState(archive.title)
  const [password, setPassword] = useState('')
  const [passwordRequired, setPasswordRequired] = useState(false)
  const [finalRootPath, setFinalRootPath] = useState<string | null>(null)
  const [extractedFolder, setExtractedFolder] =
    useState<ExtractedFolder | null>(null)
  const [error, setError] = useState('')

  const loadArchive = async () => {
    setStage('loading')
    setError('')

    try {
      const entries = await window.api.listLocalLibraryArchive({
        archivePath: archive.folderPath,
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
          : loadError instanceof Error
            ? loadError.message
            : t(
                'box.local-library-archive.read-error',
                'Unable to read the archive.'
              )
      )
      setStage('prompt')
    }
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
    setError('')

    try {
      const extractedFolder = await window.api.extractLocalLibraryArchive({
        archivePath: archive.folderPath,
        destinationName: folderName.trim(),
        password: password || undefined,
        rootPath: finalRootPath ?? undefined,
        selectedPaths: [...selectedPaths]
      })
      setExtractedFolder(extractedFolder)
      setStage('delete-prompt')
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
          : extractionError instanceof Error
            ? extractionError.message
            : t(
                'box.local-library-archive.extract-error',
                'Unable to extract the archive.'
              )
      )
      setStage('selection')
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
      await window.api.deleteLocalLibraryArchive(archive.folderPath)
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
          ? t('box.local-library-archive.title', 'Compressed archive detected')
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
            <p>
              {source === 'manual'
                ? t(
                    'box.local-library-archive.manual-message',
                    'Do you want to extract the archive "{{title}}" before adding the game?',
                    archive
                  )
                : t(
                    'box.local-library-archive.message',
                    'The archive "{{title}}" was added to your watched local library. Do you want to extract it before adding the game?',
                    archive
                  )}
            </p>
            <code className="archivePath">{archive.folderPath}</code>
          </>
        )}

        {isBusy && (
          <div className="archiveExtractionLoading">
            <CircularProgress size={32} />
            <span>
              {stage === 'loading'
                ? t(
                    'box.local-library-archive.reading',
                    'Reading archive contents...'
                  )
                : stage === 'extracting'
                  ? t(
                      'box.local-library-archive.extracting',
                      'Extracting selected contents...'
                    )
                  : t(
                      'box.local-library-archive.deleting',
                      'Deleting original archive...'
                    )}
            </span>
          </div>
        )}

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

            <div className="archiveFinalRoot">
              <span>
                {t(
                  'box.local-library-archive.final-folder-help',
                  'Choose the directory that should become the final extracted folder.'
                )}
              </span>
              <button
                className={[
                  'archiveFinalRootButton',
                  finalRootPath === null ? 'is-selected' : ''
                ]
                  .filter(Boolean)
                  .join(' ')}
                type="button"
                aria-pressed={finalRootPath === null}
                onClick={useAutomaticRoot}
              >
                {t('box.local-library-archive.automatic-folder', 'Automatic')}
              </button>
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
              {t(
                'box.local-library-archive.delete-message',
                'Do you want to delete the original archive now that extraction is complete?'
              )}
            </p>
            <code className="archivePath">{archive.folderPath}</code>
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
            onClick={() => void loadArchive()}
            disabled={passwordMissing}
          >
            {error ? t('button.retry', 'Retry') : t('box.extract', 'Extract')}
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
