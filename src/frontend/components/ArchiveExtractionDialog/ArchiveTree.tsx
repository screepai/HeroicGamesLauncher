import { memo } from 'react'
import { useTranslation } from 'react-i18next'
import { Checkbox, FormControlLabel } from '@mui/material'
import FolderOutlinedIcon from '@mui/icons-material/FolderOutlined'
import InsertDriveFileOutlinedIcon from '@mui/icons-material/InsertDriveFileOutlined'

import type { LocalLibraryArchiveEntry } from 'common/types'

export type ArchiveTreeNode = LocalLibraryArchiveEntry & {
  children: ArchiveTreeNode[]
  name: string
}

export function buildArchiveTree(
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

export function getSelectablePaths(node: ArchiveTreeNode): string[] {
  if (!node.isDirectory || node.children.length === 0) {
    return [node.path]
  }

  return node.children.flatMap(getSelectablePaths)
}

export function getAllSelectablePaths(nodes: ArchiveTreeNode[]): string[] {
  return nodes.flatMap(getSelectablePaths)
}

export const ArchiveTreeItem = memo(function ArchiveTreeItem({
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
