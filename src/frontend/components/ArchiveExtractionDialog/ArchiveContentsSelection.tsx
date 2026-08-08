import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import {
  PathSelectionBox,
  TextInputField,
  WarningMessage
} from 'frontend/components/UI'
import { ArchiveTreeItem, type ArchiveTreeNode } from './ArchiveTree'

export type ArchiveContentsSelectionModel = {
  defaultDestinationDirectory?: string
  destinationDirectory: string
  destinationDirectoryValid: boolean
  finalRootPath: string | null
  folderName: string
  folderNameValid: boolean
  selectedPaths: Set<string>
  tree: ArchiveTreeNode[]
}

export type ArchiveContentsSelectionActions = {
  onDestinationDirectoryChange: (path: string) => void
  onFolderNameChange: (name: string) => void
  onSelectFinalRoot: (node: ArchiveTreeNode) => void
  onToggleAll: () => void
  onTogglePaths: (paths: string[], selected: boolean) => void
  onUseAutomaticRoot: () => void
}

type Props = {
  actions: ArchiveContentsSelectionActions
  cleanupControls: ReactNode
  isNestedArchive: boolean
  model: ArchiveContentsSelectionModel
  nestedArchiveTitle: string
  previousArchiveFileName?: string
}

function getFinalFolderPath(directory: string, folderName: string): string {
  const trimmedDirectory = directory.replace(/[\\/]+$/, '')
  const separator =
    directory.lastIndexOf('\\') > directory.lastIndexOf('/') ? '\\' : '/'
  return `${trimmedDirectory}${separator}${folderName.trim()}`
}

function ArchiveOutputSettings({
  actions,
  isNestedArchive,
  model
}: {
  actions: ArchiveContentsSelectionActions
  isNestedArchive: boolean
  model: ArchiveContentsSelectionModel
}) {
  const { t } = useTranslation()
  const showOutputPreview =
    isNestedArchive && model.destinationDirectoryValid && model.folderNameValid

  return (
    <section
      className="archiveOutputSettings"
      aria-labelledby="archive-output-settings-label"
    >
      <div className="archiveOutputSettingsHeader">
        <strong id="archive-output-settings-label">
          {t('box.local-library-archive.output-location', 'Output location')}
        </strong>
        <span>
          {t(
            'box.local-library-archive.output-location-help',
            'Choose the parent directory and name for the extracted game.'
          )}
        </span>
      </div>

      {isNestedArchive && (
        <PathSelectionBox
          htmlId="archive-extraction-destination"
          type="directory"
          path={model.destinationDirectory}
          onPathChange={actions.onDestinationDirectoryChange}
          pathDialogTitle={t(
            'box.local-library-archive.destination-dialog',
            'Select extraction destination'
          )}
          pathDialogDefaultPath={
            model.destinationDirectory || model.defaultDestinationDirectory
          }
          placeholder={t(
            'box.local-library-archive.destination-placeholder',
            'Select where to create the final game folder...'
          )}
          label={t('box.local-library-archive.destination', 'Parent directory')}
          afterInput={
            <span className="smallMessage">
              {t(
                'box.local-library-archive.destination-help',
                'Choose any directory outside the temporary archive folder.'
              )}
            </span>
          }
          noDeleteButton
        />
      )}

      {!model.destinationDirectoryValid && (
        <WarningMessage>
          {t(
            'box.local-library-archive.destination-required',
            'Choose an extraction destination.'
          )}
        </WarningMessage>
      )}

      <TextInputField
        htmlId="archive-extraction-folder-name"
        label={t('box.local-library-archive.folder-name', 'Final folder name')}
        value={model.folderName}
        onChange={actions.onFolderNameChange}
        warning={
          model.folderNameValid
            ? undefined
            : t(
                'box.local-library-archive.invalid-folder-name',
                'Enter a valid folder name.'
              )
        }
      />

      {showOutputPreview && (
        <div className="archiveOutputPreview" role="status">
          <span>
            {t('box.local-library-archive.output-preview', 'Final game folder')}
          </span>
          <code>
            {getFinalFolderPath(model.destinationDirectory, model.folderName)}
          </code>
        </div>
      )}
    </section>
  )
}

export function ArchiveContentsSelection({
  actions,
  cleanupControls,
  isNestedArchive,
  model,
  nestedArchiveTitle,
  previousArchiveFileName
}: Props) {
  const { t } = useTranslation()

  return (
    <>
      {isNestedArchive && (
        <div className="archiveNestedNotice" role="status">
          <p>
            {t(
              'box.local-library-archive.nested-selection-message',
              'Heroic opened "{{title}}" from "{{archive}}". Choose the contents to extract.',
              {
                title: nestedArchiveTitle,
                archive: previousArchiveFileName
              }
            )}
          </p>
        </div>
      )}

      {cleanupControls}

      <ArchiveOutputSettings
        actions={actions}
        isNestedArchive={isNestedArchive}
        model={model}
      />

      <div className="archiveSelectionActions">
        <button className="button is-secondary" onClick={actions.onToggleAll}>
          {model.selectedPaths.size === 0
            ? t('box.select-all', 'Select All')
            : t('box.unselect-all', 'Unselect All')}
        </button>
        <span>
          {t('box.local-library-archive.selected-count', '{{count}} selected', {
            count: model.selectedPaths.size
          })}
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
            model.finalRootPath === null ? 'is-selected' : ''
          ]
            .filter(Boolean)
            .join(' ')}
          type="button"
          aria-pressed={model.finalRootPath === null}
          onClick={actions.onUseAutomaticRoot}
        >
          {model.finalRootPath === null && <span aria-hidden="true">✓</span>}
          <span className="archiveAutomaticRootText">
            <strong>
              {t('box.local-library-archive.automatic-folder', 'Automatic')}
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
          {model.tree.map((node) => (
            <ArchiveTreeItem
              key={node.path}
              node={node}
              selectedPaths={model.selectedPaths}
              finalRootPath={model.finalRootPath}
              onToggle={actions.onTogglePaths}
              onSelectFinalRoot={actions.onSelectFinalRoot}
            />
          ))}
        </ul>
      </div>
    </>
  )
}
