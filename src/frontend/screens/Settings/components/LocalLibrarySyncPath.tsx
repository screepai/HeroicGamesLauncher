import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Chip } from '@mui/material'

import { PathSelectionBox, TextInputField } from 'frontend/components/UI'
import useSetting from 'frontend/hooks/useSetting'

import './LocalLibrarySyncPath/index.css'

const LocalLibrarySyncPath = () => {
  const { t } = useTranslation()
  const [newExclusionRule, setNewExclusionRule] = useState('')
  const [localLibrarySyncPath, setLocalLibrarySyncPath] = useSetting(
    'localLibrarySyncPath',
    ''
  )
  const [localLibrarySyncExclusions, setLocalLibrarySyncExclusions] =
    useSetting('localLibrarySyncExclusions', [])

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
      <PathSelectionBox
        type="directory"
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
            disabled={!newExclusionRule.trim()}
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
