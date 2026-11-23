import { FileArchive, LoaderCircle } from 'lucide-react'
import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'

import type {
  LocalLibraryArchiveExtractionProgress,
  LocalLibraryArchiveInfo,
  LocalLibraryWatchEntry
} from 'common/types'
import {
  TextInputField,
  Alert,
  Button,
  Icon,
  ProgressBar,
  Stepper
} from 'frontend/components/UI'
import {
  ModalContent,
  ModalFooter,
  ModalHeader
} from 'frontend/components/UI/Modal'
import {
  ArchiveContentsSelection,
  type ArchiveContentsSelectionActions,
  type ArchiveContentsSelectionModel
} from './ArchiveContentsSelection'

export type ArchiveExtractionStage =
  | 'prompt'
  | 'multipart-prompt'
  | 'multipart-waiting'
  | 'loading'
  | 'selection'
  | 'nested-selection'
  | 'extracting'
  | 'delete-prompt'
  | 'deleting'

type ExtractedFolder = {
  folderPath: string
  title: string
}

export function ArchiveExtractionHeader({
  isNestedArchive,
  stage
}: {
  isNestedArchive: boolean
  stage: ArchiveExtractionStage
}) {
  const { t } = useTranslation()
  let title: string

  switch (stage) {
    case 'prompt':
      title = isNestedArchive
        ? t('box.local-library-archive.nested-title', 'Nested archive detected')
        : t('box.local-library-archive.title', 'Compressed archive detected')
      break
    case 'multipart-prompt':
    case 'multipart-waiting':
      title = t(
        'box.local-library-archive.multipart-title',
        'Multipart archive detected'
      )
      break
    case 'nested-selection':
      title = t(
        'box.local-library-archive.nested-archives-title',
        'Nested archives found'
      )
      break
    case 'delete-prompt':
    case 'deleting':
      title = t(
        'box.local-library-archive.complete-title',
        'Extraction complete'
      )
      break
    default:
      title = t(
        'box.local-library-archive.contents-title',
        'Choose archive contents'
      )
  }

  return <ModalHeader>{title}</ModalHeader>
}

export function ArchivePrompt({
  deletePreviousArchiveControl,
  displayArchiveName,
  isNestedArchive,
  previousArchiveFileName,
  source,
  title
}: {
  deletePreviousArchiveControl: ReactNode
  displayArchiveName: string
  isNestedArchive: boolean
  previousArchiveFileName?: string
  source: 'manual' | 'watcher'
  title: string
}) {
  const { t } = useTranslation()

  return (
    <>
      {isNestedArchive ? (
        <Alert variant="info">
          {t(
            'box.local-library-archive.nested-message',
            'Heroic found "{{title}}" inside "{{archive}}". Extract it to continue to the game files.',
            { title, archive: previousArchiveFileName }
          )}
        </Alert>
      ) : (
        <p>
          {source === 'manual'
            ? t(
                'box.local-library-archive.manual-message',
                'Do you want to extract the archive "{{title}}" before adding the game?',
                { title }
              )
            : t(
                'box.local-library-archive.message',
                'The archive "{{title}}" was added to your watched local library. Do you want to extract it before adding the game?',
                { title }
              )}
        </p>
      )}
      <code className="archivePath">{displayArchiveName}</code>
      {deletePreviousArchiveControl}
    </>
  )
}

export function MultipartArchiveStatus({
  archiveInfo,
  displayArchiveName,
  waiting
}: {
  archiveInfo: LocalLibraryArchiveInfo
  displayArchiveName: string
  waiting: boolean
}) {
  const { t } = useTranslation()

  return (
    <>
      <p>
        {waiting
          ? t(
              'box.local-library-archive.waiting-message',
              'Wait for all archive parts to finish downloading, then choose Check available parts.'
            )
          : t(
              'box.local-library-archive.multipart-message',
              'Heroic cannot tell from the filename whether more parts are still coming. Use the available parts to let 7-Zip verify the archive, or wait for more parts.'
            )}
      </p>
      <p>
        {t('box.local-library-archive.parts-found', '{{count}} part found', {
          count: archiveInfo.partPaths.length
        })}
      </p>
      <code className="archivePath">{displayArchiveName}</code>
    </>
  )
}

export function NestedArchiveCandidates({
  archives,
  extractedFolder,
  onOpenArchive,
  previousArchivePath
}: {
  archives: LocalLibraryWatchEntry[]
  extractedFolder: ExtractedFolder
  onOpenArchive: (
    archive: LocalLibraryWatchEntry,
    previousArchivePath: string | null
  ) => void
  previousArchivePath: string | null
}) {
  const { t } = useTranslation()

  return (
    <>
      <Alert variant="info">
        {t(
          'box.local-library-archive.nested-candidates-message',
          'Heroic found {{count}} nested archive inside "{{folder}}". Extract it, or keep this folder as-is.',
          { count: archives.length, folder: extractedFolder.title }
        )}
      </Alert>
      <div className="archiveNestedCandidates" role="list">
        {archives.map((archive) => {
          const archiveName =
            archive.folderPath.split(/[\\/]/).pop() ?? archive.folderPath
          return (
            <div
              className="archiveNestedCandidate"
              key={archive.folderPath}
              role="listitem"
            >
              <div className="archiveNestedCandidateInfo">
                <Icon glyph={FileArchive} size="lg" />
                <div>
                  <strong>{archive.title}</strong>
                  <code title={archive.folderPath}>{archiveName}</code>
                </div>
              </div>
              <Button
                className="archiveNestedCandidateButton"
                variant="secondary"
                size="sm"
                onClick={() => onOpenArchive(archive, previousArchivePath)}
              >
                {t(
                  'box.local-library-archive.extract-this-archive',
                  'Extract this archive'
                )}
              </Button>
            </div>
          )
        })}
      </div>
      <p className="archiveNestedRetentionNote">
        {t(
          'box.local-library-archive.nested-retention-note',
          'Unselected archives and loose files will remain inside "{{folder}}".',
          { folder: extractedFolder.title }
        )}
      </p>
    </>
  )
}

export function ArchiveBusyState({
  progress,
  stage
}: {
  progress: LocalLibraryArchiveExtractionProgress
  stage: 'loading' | 'extracting' | 'deleting'
}) {
  const { t } = useTranslation()

  if (stage !== 'extracting') {
    return (
      <div className="archiveExtractionLoading">
        <Icon
          glyph={LoaderCircle}
          size="xl"
          className="archiveExtractionSpinner"
        />
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
    )
  }

  return (
    <div className="archiveExtractionProgress">
      <span>
        {t(
          'box.local-library-archive.extracting',
          'Extracting selected contents...'
        )}
      </span>
      <ProgressBar
        value={progress.percent}
        size="md"
        showValue
        label={t(
          'box.local-library-archive.extracting',
          'Extracting selected contents...'
        )}
      />
      <div className="archiveExtractionCurrentFile" aria-live="polite">
        <b>
          {t('box.local-library-archive.current-file', 'Currently extracting')}:
        </b>
        <code title={progress.file}>
          {progress.file ??
            t('box.local-library-archive.preparing', 'Preparing extraction...')}
        </code>
      </div>
    </div>
  )
}

export function ArchiveDeletePrompt({
  archiveInfo,
  displayArchiveName,
  title
}: {
  archiveInfo: LocalLibraryArchiveInfo | null
  displayArchiveName: string
  title: string
}) {
  const { t } = useTranslation()

  return (
    <>
      <p>
        {archiveInfo?.isMultipart
          ? t(
              'box.local-library-archive.delete-multipart-message',
              'Do you want to delete all {{count}} parts of "{{title}}" now that extraction is complete?',
              { count: archiveInfo.partPaths.length, title }
            )
          : t(
              'box.local-library-archive.delete-message',
              'Do you want to delete the original archive now that extraction is complete?'
            )}
      </p>
      <code className="archivePath">{displayArchiveName}</code>
    </>
  )
}

type ContentModel = {
  archiveInfo: LocalLibraryArchiveInfo | null
  displayArchiveName: string
  error: string
  extractedFolder: ExtractedFolder | null
  extractionProgress: LocalLibraryArchiveExtractionProgress
  isNestedArchive: boolean
  nestedArchives: LocalLibraryWatchEntry[]
  password: string
  passwordRequired: boolean
  previousArchiveFileName?: string
  previousArchivePath: string | null
  promptCleanupControl: ReactNode
  selection: ArchiveContentsSelectionModel
  selectionCleanupControls: ReactNode
  source: 'manual' | 'watcher'
  stage: ArchiveExtractionStage
  title: string
}

type ContentActions = {
  onOpenArchive: (
    archive: LocalLibraryWatchEntry,
    previousArchivePath: string | null
  ) => void
  onPasswordChange: (password: string) => void
  /** Enter in the password field: runs the step's primary action. */
  onPasswordSubmit: () => void
  selection: ArchiveContentsSelectionActions
}

function ArchiveStageContent({
  actions,
  model
}: {
  actions: ContentActions
  model: ContentModel
}) {
  switch (model.stage) {
    case 'prompt':
      return (
        <ArchivePrompt
          deletePreviousArchiveControl={model.promptCleanupControl}
          displayArchiveName={model.displayArchiveName}
          isNestedArchive={model.isNestedArchive}
          previousArchiveFileName={model.previousArchiveFileName}
          source={model.source}
          title={model.title}
        />
      )
    case 'multipart-prompt':
    case 'multipart-waiting':
      return model.archiveInfo ? (
        <MultipartArchiveStatus
          archiveInfo={model.archiveInfo}
          displayArchiveName={model.displayArchiveName}
          waiting={model.stage === 'multipart-waiting'}
        />
      ) : null
    case 'nested-selection':
      return model.extractedFolder ? (
        <NestedArchiveCandidates
          archives={model.nestedArchives}
          extractedFolder={model.extractedFolder}
          onOpenArchive={actions.onOpenArchive}
          previousArchivePath={model.previousArchivePath}
        />
      ) : null
    case 'loading':
    case 'extracting':
    case 'deleting':
      return (
        <ArchiveBusyState
          progress={model.extractionProgress}
          stage={model.stage}
        />
      )
    case 'selection':
      return (
        <ArchiveContentsSelection
          actions={actions.selection}
          cleanupControls={model.selectionCleanupControls}
          isNestedArchive={model.isNestedArchive}
          model={model.selection}
          nestedArchiveTitle={model.title}
          previousArchiveFileName={model.previousArchiveFileName}
        />
      )
    case 'delete-prompt':
      return (
        <ArchiveDeletePrompt
          archiveInfo={model.archiveInfo}
          displayArchiveName={model.displayArchiveName}
          title={model.title}
        />
      )
  }
}

function getActiveStep(stage: ArchiveExtractionStage): number {
  switch (stage) {
    case 'prompt':
    case 'multipart-prompt':
    case 'multipart-waiting':
      return 0
    case 'loading':
    case 'selection':
    case 'nested-selection':
      return 1
    case 'extracting':
      return 2
    default:
      return 3
  }
}

export function ArchiveExtractionContent({
  actions,
  model
}: {
  actions: ContentActions
  model: ContentModel
}) {
  const { t } = useTranslation()
  const showPassword =
    model.passwordRequired &&
    (model.stage === 'prompt' || model.stage === 'selection')

  const steps = [
    { title: t('box.local-library-archive.step.detect', 'Detect') },
    { title: t('box.local-library-archive.step.choose', 'Choose') },
    { title: t('box.local-library-archive.step.extract', 'Extract') },
    { title: t('box.local-library-archive.step.finish', 'Finish') }
  ]

  return (
    <ModalContent className="archiveExtractionContent">
      <Stepper
        className="archiveStepper"
        steps={steps}
        activeStep={getActiveStep(model.stage)}
      />
      <ArchiveStageContent actions={actions} model={model} />
      {showPassword && (
        <TextInputField
          htmlId="archive-extraction-password"
          label={t('box.local-library-archive.password', 'Archive password')}
          value={model.password}
          onChange={actions.onPasswordChange}
          type="password"
          autoComplete="off"
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
              event.preventDefault()
              actions.onPasswordSubmit()
            }
          }}
        />
      )}
      {model.error && <Alert variant="warning">{model.error}</Alert>}
    </ModalContent>
  )
}

type FooterActions = {
  onCancel: () => void
  onCancelExtraction: () => void
  onCheckParts: () => void
  onDeleteArchive: () => void
  onExtractSelection: () => void
  onFinish: () => void
  onPrepareArchive: () => void
  onUseAvailableParts: () => void
  onUseFolderAsIs: () => void
  onWaitForParts: () => void
}

export function ArchiveExtractionFooter({
  actions,
  archiveInfo,
  canExtractSelection,
  error,
  isBusy,
  passwordMissing,
  stage
}: {
  actions: FooterActions
  archiveInfo: LocalLibraryArchiveInfo | null
  canExtractSelection: boolean
  error: string
  isBusy: boolean
  passwordMissing: boolean
  stage: ArchiveExtractionStage
}) {
  const { t } = useTranslation()

  return (
    <ModalFooter>
      {stage !== 'delete-prompt' && (
        <Button
          variant="secondary"
          onClick={
            stage === 'extracting'
              ? actions.onCancelExtraction
              : actions.onCancel
          }
          disabled={isBusy && stage !== 'extracting'}
        >
          {stage === 'extracting'
            ? t('box.local-library-archive.stop-extraction', 'Stop extraction')
            : t('button.cancel', 'Cancel')}
        </Button>
      )}
      {stage === 'prompt' && (
        <Button
          variant="primary"
          onClick={actions.onPrepareArchive}
          disabled={passwordMissing}
        >
          {error ? t('button.retry', 'Retry') : t('box.extract', 'Extract')}
        </Button>
      )}
      {stage === 'multipart-prompt' && archiveInfo && (
        <>
          <Button variant="secondary" onClick={actions.onUseAvailableParts}>
            {t(
              'box.local-library-archive.use-available-parts',
              'Use available parts'
            )}
          </Button>
          <Button variant="primary" onClick={actions.onWaitForParts}>
            {t(
              'box.local-library-archive.wait-for-parts',
              'Wait for more parts'
            )}
          </Button>
        </>
      )}
      {stage === 'multipart-waiting' && (
        <Button variant="primary" onClick={actions.onCheckParts}>
          {t(
            'box.local-library-archive.check-available-parts',
            'Check available parts'
          )}
        </Button>
      )}
      {stage === 'nested-selection' && (
        <Button variant="primary" onClick={actions.onUseFolderAsIs}>
          {t('box.local-library-archive.use-folder-as-is', 'Use folder as-is')}
        </Button>
      )}
      {stage === 'selection' && (
        <Button
          variant="primary"
          onClick={actions.onExtractSelection}
          disabled={!canExtractSelection}
        >
          {t('box.extract-selected', 'Extract Selected')}
        </Button>
      )}
      {stage === 'delete-prompt' && (
        <>
          <Button variant="secondary" onClick={actions.onFinish}>
            {t('box.local-library-archive.keep-archive', 'Keep Archive')}
          </Button>
          <Button variant="danger" onClick={actions.onDeleteArchive}>
            {t('box.local-library-archive.delete-archive', 'Delete Archive')}
          </Button>
        </>
      )}
    </ModalFooter>
  )
}
