import { useContext, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Chip, MenuItem, SelectChangeEvent } from '@mui/material'

import {
  PathSelectionBox,
  SelectField,
  TextInputField,
  ToggleSwitch
} from 'frontend/components/UI'
import type { AppSettings } from 'common/types'
import useSetting from 'frontend/hooks/useSetting'
import ContextProvider from 'frontend/state/ContextProvider'
import { dispatchVndbApiTokenChanged } from 'frontend/hooks/useHasVndbApiToken'

import './LocalLibrarySyncPath/index.css'

type LocalLibraryMetadataPathMapping = {
  destinationPath: string
  sourcePath: string
}

const LocalLibrarySyncPath = () => {
  const { t } = useTranslation()
  const { customCategories, showDialogModal } = useContext(ContextProvider)
  const [newExclusionRule, setNewExclusionRule] = useState('')
  const [isBackingUpMetadata, setIsBackingUpMetadata] = useState(false)
  const [isRestoringMetadata, setIsRestoringMetadata] = useState(false)
  const [enableLocalLibraryWatcher, setEnableLocalLibraryWatcher] = useSetting(
    'enableLocalLibraryWatcher',
    true
  )
  const [detectLocalLibraryArchives, setDetectLocalLibraryArchives] =
    useSetting('detectLocalLibraryArchives', true)
  const [
    askToDeleteArchiveAfterExtraction,
    setAskToDeleteArchiveAfterExtraction
  ] = useSetting('askToDeleteArchiveAfterExtraction', true)
  const [localLibrarySyncPath, setLocalLibrarySyncPath] = useSetting(
    'localLibrarySyncPath',
    ''
  )
  const [localLibrarySyncExclusions, setLocalLibrarySyncExclusions] =
    useSetting('localLibrarySyncExclusions', [])
  const [migrationArchivePath, setMigrationArchivePath] = useSetting(
    'migrationArchivePath',
    ''
  )
  const [migrationArchivePromptMode, setMigrationArchivePromptMode] =
    useSetting('migrationArchivePromptMode', 'ask')

  const onMigrationArchivePromptModeChange = (event: SelectChangeEvent) => {
    setMigrationArchivePromptMode(
      event.target.value as AppSettings['migrationArchivePromptMode']
    )
  }

  const addExclusionRule = () => {
    const rule = newExclusionRule.trim()
    if (
      !rule ||
      localLibrarySyncExclusions.some(
        (existingRule) => existingRule.toLowerCase() === rule.toLowerCase()
      )
    ) {
      return
    }

    setLocalLibrarySyncExclusions([...localLibrarySyncExclusions, rule])
    setNewExclusionRule('')
  }

  const removeExclusionRule = (rule: string) => {
    setLocalLibrarySyncExclusions(
      localLibrarySyncExclusions.filter((existingRule) => existingRule !== rule)
    )
  }

  const showMetadataMessage = (
    title: string,
    message: string,
    type: 'MESSAGE' | 'ERROR' = 'MESSAGE'
  ) => {
    showDialogModal({
      showDialog: true,
      title,
      message,
      type,
      buttons: [
        {
          text: t('box.ok', 'Ok'),
          onClick: () => showDialogModal({ showDialog: false })
        }
      ]
    })
  }

  const getErrorMessage = (error: unknown) =>
    error instanceof Error ? error.message : String(error)

  const backupLocalLibraryMetadata = async () => {
    const backupDirectory = await window.api.openDialog({
      buttonLabel: t('box.choose', 'Choose'),
      defaultPath: migrationArchivePath || localLibrarySyncPath,
      properties: ['openDirectory', 'createDirectory'],
      title: t(
        'box.local-library-metadata-backup-folder',
        'Select metadata backup folder'
      )
    })

    if (!backupDirectory) {
      return
    }

    setIsBackingUpMetadata(true)
    try {
      const backupPath =
        await window.api.backupLocalLibraryMetadata(backupDirectory)
      showMetadataMessage(
        t(
          'setting.local-library-metadata-backup-success',
          'Local library metadata backup created'
        ),
        backupPath
      )
    } catch (error) {
      showMetadataMessage(
        t(
          'setting.local-library-metadata-backup-error',
          'Could not back up local library metadata'
        ),
        getErrorMessage(error),
        'ERROR'
      )
    } finally {
      setIsBackingUpMetadata(false)
    }
  }

  const restoreLocalLibraryMetadata = async (
    backupPath: string,
    pathMapping?: LocalLibraryMetadataPathMapping
  ) => {
    setIsRestoringMetadata(true)
    try {
      const result = await window.api.restoreLocalLibraryMetadata({
        backupPath,
        pathMapping
      })
      if (result.localLibrarySettings) {
        setAskToDeleteArchiveAfterExtraction(
          result.localLibrarySettings.askToDeleteArchiveAfterExtraction
        )
        setDetectLocalLibraryArchives(
          result.localLibrarySettings.detectLocalLibraryArchives
        )
        setEnableLocalLibraryWatcher(
          result.localLibrarySettings.enableLocalLibraryWatcher
        )
        setLocalLibrarySyncExclusions(
          result.localLibrarySettings.localLibrarySyncExclusions
        )
        setLocalLibrarySyncPath(
          result.localLibrarySettings.localLibrarySyncPath
        )
        setMigrationArchivePath(
          result.localLibrarySettings.migrationArchivePath
        )
        setMigrationArchivePromptMode(
          result.localLibrarySettings.migrationArchivePromptMode
        )
      }
      if (result.customCategories) {
        customCategories.restore(result.customCategories)
      }
      if (result.vndbApiToken) {
        dispatchVndbApiTokenChanged(true)
      }
      showMetadataMessage(
        t(
          'setting.local-library-metadata-restore-success',
          'Local library metadata restored'
        ),
        t(
          'setting.local-library-metadata-restore-success-message',
          'Restored {{total}} local games ({{added}} new, {{updated}} updated), {{overrides}} metadata overrides, {{categories}} categories, {{playtime}} playtime records, {{gameSettings}} game settings, {{vndbMatches}} VNDB matches, local library settings, {{steamGridDbStatus}}, and {{tokenStatus}}.',
          {
            ...result,
            steamGridDbStatus: result.steamGridDbApiKey
              ? t(
                  'setting.local-library-metadata-steamgriddb-restored',
                  'SteamGridDB API key'
                )
              : t(
                  'setting.local-library-metadata-steamgriddb-not-restored',
                  'no SteamGridDB API key'
                ),
            tokenStatus: result.vndbApiToken
              ? t('setting.local-library-metadata-token-restored', 'VNDB token')
              : t(
                  'setting.local-library-metadata-token-not-restored',
                  'no VNDB token'
                )
          }
        )
      )
    } catch (error) {
      showMetadataMessage(
        t(
          'setting.local-library-metadata-restore-error',
          'Could not restore local library metadata'
        ),
        getErrorMessage(error),
        'ERROR'
      )
    } finally {
      setIsRestoringMetadata(false)
    }
  }

  const confirmRestoreLocalLibraryMetadata = (
    backupPath: string,
    pathMapping?: LocalLibraryMetadataPathMapping
  ) => {
    showDialogModal({
      showDialog: true,
      title: t(
        'setting.local-library-metadata-restore-confirm-title',
        'Restore local library metadata?'
      ),
      message: pathMapping
        ? t(
            'setting.local-library-metadata-restore-confirm-message-with-path',
            'This will merge the backup into your current local library. Games with the same app name will be replaced by the backup. Paths under {{sourcePath}} will be remapped to {{destinationPath}}.',
            pathMapping
          )
        : t(
            'setting.local-library-metadata-restore-confirm-message',
            'This will merge the backup into your current local library. Games with the same app name will be replaced by the backup.'
          ),
      type: 'MESSAGE',
      buttons: [
        {
          text: t('box.cancel', 'Cancel'),
          onClick: () => showDialogModal({ showDialog: false })
        },
        {
          text: t('box.restore', 'Restore'),
          onClick: () => {
            showDialogModal({ showDialog: false })
            void restoreLocalLibraryMetadata(backupPath, pathMapping)
          }
        }
      ]
    })
  }

  const chooseMetadataRestorePath = async (
    backupPath: string,
    sourcePath: string
  ) => {
    const destinationPath = await window.api.openDialog({
      buttonLabel: t('box.choose', 'Choose'),
      defaultPath: localLibrarySyncPath || migrationArchivePath,
      properties: ['openDirectory', 'createDirectory'],
      title: t(
        'box.local-library-metadata-restore-path',
        'Select replacement game folder'
      )
    })

    if (destinationPath) {
      confirmRestoreLocalLibraryMetadata(backupPath, {
        destinationPath,
        sourcePath
      })
    }
  }

  const confirmCrossOsMetadataRestorePath = (
    backupPath: string,
    sourcePath: string
  ) => {
    showDialogModal({
      showDialog: true,
      title: t(
        'setting.local-library-metadata-cross-os-title',
        'Restore paths from another OS?'
      ),
      message: t(
        'setting.local-library-metadata-cross-os-message',
        'This backup points to {{sourcePath}}, but those paths do not match this OS. Choose a replacement folder to remap restored game paths, or restore with the saved paths.',
        { sourcePath }
      ),
      type: 'MESSAGE',
      buttons: [
        {
          text: t('box.cancel', 'Cancel'),
          onClick: () => showDialogModal({ showDialog: false })
        },
        {
          text: t(
            'setting.local-library-metadata-restore-saved-paths',
            'Use saved paths'
          ),
          onClick: () => {
            showDialogModal({ showDialog: false })
            confirmRestoreLocalLibraryMetadata(backupPath)
          }
        },
        {
          text: t(
            'setting.local-library-metadata-choose-replacement-path',
            'Choose folder'
          ),
          onClick: () => {
            showDialogModal({ showDialog: false })
            void chooseMetadataRestorePath(backupPath, sourcePath)
          }
        }
      ]
    })
  }

  const selectLocalLibraryMetadataBackup = async () => {
    const backupPath = await window.api.openDialog({
      buttonLabel: t('box.choose', 'Choose'),
      defaultPath: migrationArchivePath || localLibrarySyncPath,
      filters: [
        {
          name: t(
            'setting.local-library-metadata-backup-file',
            'Heroic local library metadata'
          ),
          extensions: ['json']
        }
      ],
      properties: ['openFile'],
      title: t(
        'box.local-library-metadata-restore-file',
        'Select metadata backup'
      )
    })

    if (backupPath) {
      try {
        const restoreInfo =
          await window.api.inspectLocalLibraryMetadataBackup(backupPath)

        if (restoreInfo.shouldPromptForPath && restoreInfo.sourcePath) {
          confirmCrossOsMetadataRestorePath(backupPath, restoreInfo.sourcePath)
          return
        }

        confirmRestoreLocalLibraryMetadata(backupPath)
      } catch (error) {
        showMetadataMessage(
          t(
            'setting.local-library-metadata-restore-error',
            'Could not restore local library metadata'
          ),
          getErrorMessage(error),
          'ERROR'
        )
      }
    }
  }

  return (
    <>
      <ToggleSwitch
        htmlId="enableLocalLibraryWatcher"
        value={enableLocalLibraryWatcher}
        handleChange={() =>
          setEnableLocalLibraryWatcher(!enableLocalLibraryWatcher)
        }
        title={t(
          'setting.enableLocalLibraryWatcher',
          'Watch local library folder for new games'
        )}
        description={t(
          'setting.enableLocalLibraryWatcher-description',
          'Pause folder and archive detection without clearing the watched folder or exclusion rules.'
        )}
      />
      <ToggleSwitch
        htmlId="detectLocalLibraryArchives"
        value={detectLocalLibraryArchives}
        disabled={!enableLocalLibraryWatcher}
        handleChange={() =>
          setDetectLocalLibraryArchives(!detectLocalLibraryArchives)
        }
        title={t(
          'setting.detectLocalLibraryArchives',
          'Detect compressed archives in watched folders'
        )}
      />
      <ToggleSwitch
        htmlId="askToDeleteArchiveAfterExtraction"
        value={askToDeleteArchiveAfterExtraction}
        handleChange={() =>
          setAskToDeleteArchiveAfterExtraction(
            !askToDeleteArchiveAfterExtraction
          )
        }
        title={t(
          'setting.askToDeleteArchiveAfterExtraction',
          'Ask to delete archives after extraction'
        )}
        description={t(
          'setting.askToDeleteArchiveAfterExtraction-description',
          'When disabled, extracted archives are kept without showing a deletion prompt.'
        )}
      />

      <SelectField
        htmlId="migration_archive_prompt_mode"
        value={migrationArchivePromptMode}
        onChange={onMigrationArchivePromptModeChange}
        label={t(
          'setting.migration-archive-prompt-mode-label',
          'After migrating games'
        )}
        afterSelect={
          <span className="smallMessage">
            {t(
              'setting.migration-archive-prompt-mode-help',
              'Choose whether Heroic should remember migrated destination folders as an archive location.'
            )}
          </span>
        }
      >
        <MenuItem value="ask">
          {t('setting.migration-archive-prompt-mode.ask', 'Ask every time')}
        </MenuItem>
        <MenuItem value="always">
          {t(
            'setting.migration-archive-prompt-mode.always',
            'Always remember archive folder'
          )}
        </MenuItem>
        <MenuItem value="never">
          {t(
            'setting.migration-archive-prompt-mode.never',
            'Never remember archive folder'
          )}
        </MenuItem>
      </SelectField>

      <PathSelectionBox
        type="directory"
        onPathChange={setMigrationArchivePath}
        path={migrationArchivePath}
        pathDialogTitle={t(
          'box.migration-archive-path',
          'Select migration archive folder'
        )}
        pathDialogDefaultPath={migrationArchivePath || localLibrarySyncPath}
        placeholder={t(
          'setting.migration-archive-path-placeholder',
          'Select a folder used to archive migrated games...'
        )}
        label={t('setting.migration-archive-path', 'Migration archive folder')}
        htmlId="migration_archive_path"
        afterInput={
          <span className="smallMessage">
            {t(
              'setting.migration-archive-path-help',
              'This does not change the watched local library folder.'
            )}
          </span>
        }
      />

      <PathSelectionBox
        type="directory"
        disabled={!enableLocalLibraryWatcher}
        onPathChange={setLocalLibrarySyncPath}
        path={localLibrarySyncPath}
        pathDialogTitle={t(
          'box.local-library-sync-path',
          'Select local library folder'
        )}
        pathDialogDefaultPath={localLibrarySyncPath}
        placeholder={t(
          'setting.local-library-sync-path-placeholder',
          'Select a folder to watch for new games...'
        )}
        label={t(
          'setting.local-library-sync-path',
          'Watched local library folder'
        )}
        htmlId="local_library_sync_path"
        afterInput={
          <span className="smallMessage">
            {t(
              'setting.local-library-sync-path-help',
              'New top-level folders will prompt you to add a game. Existing folders are ignored.'
            )}
          </span>
        }
      />

      <div className="localLibraryMetadataActions">
        <button
          className="button is-secondary"
          disabled={isBackingUpMetadata || isRestoringMetadata}
          onClick={backupLocalLibraryMetadata}
          type="button"
        >
          {isBackingUpMetadata
            ? t(
                'setting.local-library-metadata-backup-running',
                'Backing up...'
              )
            : t(
                'setting.local-library-metadata-backup',
                'Back up local library metadata'
              )}
        </button>
        <button
          className="button is-secondary"
          disabled={isBackingUpMetadata || isRestoringMetadata}
          onClick={selectLocalLibraryMetadataBackup}
          type="button"
        >
          {isRestoringMetadata
            ? t(
                'setting.local-library-metadata-restore-running',
                'Restoring...'
              )
            : t(
                'setting.local-library-metadata-restore',
                'Restore local library metadata'
              )}
        </button>
      </div>

      <span className="smallMessage localLibraryMetadataHelp">
        {t(
          'setting.local-library-metadata-help',
          'Backups include local library games, custom metadata overrides, exclusion rules, all VNDB matches, and your VNDB token.'
        )}
      </span>

      <TextInputField
        htmlId="local_library_sync_exclusion"
        disabled={!enableLocalLibraryWatcher}
        extraClass="withRightButton localLibraryExclusionInput"
        label={t(
          'setting.local-library-sync-exclusions',
          'Excluded folder patterns'
        )}
        value={newExclusionRule}
        onChange={setNewExclusionRule}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault()
            addExclusionRule()
          }
        }}
        placeholder={t(
          'setting.local-library-sync-exclusions-placeholder',
          'Folder name or wildcard pattern'
        )}
        afterInput={
          <button
            className="button is-primary rightButton"
            type="button"
            disabled={!enableLocalLibraryWatcher || !newExclusionRule.trim()}
            onClick={addExclusionRule}
          >
            {t('box.add', 'Add')}
          </button>
        }
      />

      <div className="localLibraryExclusionRules">
        {localLibrarySyncExclusions.map((rule) => (
          <Chip
            className="localLibraryExclusionChip"
            key={rule}
            label={rule}
            disabled={!enableLocalLibraryWatcher}
            onDelete={() => removeExclusionRule(rule)}
            variant="outlined"
          />
        ))}
      </div>

      <span className="smallMessage localLibraryExclusionHelp">
        {t(
          'setting.local-library-sync-exclusions-help',
          'Rules match top-level folder names and ignore letter case. Use * for any text and ? for one character.'
        )}
      </span>
    </>
  )
}

export default LocalLibrarySyncPath
