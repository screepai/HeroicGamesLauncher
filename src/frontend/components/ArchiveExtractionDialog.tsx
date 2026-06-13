import { useState } from 'react'
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
}

type Stage = 'prompt' | 'loading' | 'selection' | 'extracting'

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

function ArchiveTreeItem({
  node,
  selectedPaths,
  onToggle
}: {
  node: ArchiveTreeNode
  selectedPaths: Set<string>
  onToggle: (paths: string[], selected: boolean) => void
}) {
  const selectablePaths = getSelectablePaths(node)
  const selectedCount = selectablePaths.filter((path) =>
    selectedPaths.has(path)
  ).length
  const checked = selectedCount === selectablePaths.length
  const indeterminate = selectedCount > 0 && !checked

  return (
    <li>
      <FormControlLabel
        className="archiveTreeLabel"
        control={
          <Checkbox
            className="archiveTreeCheckbox"
            checked={checked}
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
      {node.children.length > 0 && (
        <ul>
          {node.children.map((child) => (
            <ArchiveTreeItem
              key={child.path}
              node={child}
              selectedPaths={selectedPaths}
              onToggle={onToggle}
            />
          ))}
        </ul>
      )}
    </li>
  )
}

export default function ArchiveExtractionDialog({
  archive,
  onClose,
  onExtracted
}: Props) {
  const { t } = useTranslation()
  const [stage, setStage] = useState<Stage>('prompt')
  const [tree, setTree] = useState<ArchiveTreeNode[]>([])
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set())
  const [folderName, setFolderName] = useState(archive.title)
  const [password, setPassword] = useState('')
  const [passwordRequired, setPasswordRequired] = useState(false)
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

  const togglePaths = (paths: string[], selected: boolean) => {
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
        selectedPaths: [...selectedPaths]
      })
      onExtracted(extractedFolder)
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

  const isBusy = stage === 'loading' || stage === 'extracting'
  const folderNameValid = isValidFolderName(folderName)
  const passwordMissing = passwordRequired && password.length === 0

  return (
    <Dialog
      onClose={isBusy ? () => {} : onClose}
      showCloseButton={!isBusy}
      className="ArchiveExtractionDialog"
    >
      <DialogHeader>
        {stage === 'prompt'
          ? t('box.local-library-archive.title', 'Compressed archive detected')
          : t(
              'box.local-library-archive.contents-title',
              'Choose archive contents'
            )}
      </DialogHeader>
      <DialogContent className="archiveExtractionContent">
        {stage === 'prompt' && (
          <>
            <p>
              {t(
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
                : t(
                    'box.local-library-archive.extracting',
                    'Extracting selected contents...'
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
                !folderNameValid
                  ? t(
                      'box.local-library-archive.invalid-folder-name',
                      'Enter a valid folder name.'
                    )
                  : undefined
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

            <div className="archiveTree" role="tree">
              <ul>
                {tree.map((node) => (
                  <ArchiveTreeItem
                    key={node.path}
                    node={node}
                    selectedPaths={selectedPaths}
                    onToggle={togglePaths}
                  />
                ))}
              </ul>
            </div>
          </>
        )}

        {passwordRequired && !isBusy && (
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
        <button
          className="button is-secondary"
          onClick={onClose}
          disabled={isBusy}
        >
          {t('button.cancel', 'Cancel')}
        </button>
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
      </DialogFooter>
    </Dialog>
  )
}
