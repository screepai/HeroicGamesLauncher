import { useState } from 'react'
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

import './LocalLibrarySyncPath/index.css'

const LocalLibrarySyncPath = () => {
  const { t } = useTranslation()
  const [newExclusionRule, setNewExclusionRule] = useState('')
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
          'setting.migration-archive-prompt-mode',
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
