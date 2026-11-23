import { useTranslation } from 'react-i18next'
import { Download, Upload } from 'lucide-react'
import { Alert, Button, ToggleSwitch } from 'frontend/components/UI'

type Props = {
  includeSecrets: boolean
  isBackingUp: boolean
  isRestoring: boolean
  onBackup: () => void
  onIncludeSecretsChange: (includeSecrets: boolean) => void
  onRestore: () => void
}

export default function MetadataActions({
  includeSecrets,
  isBackingUp,
  isRestoring,
  onBackup,
  onIncludeSecretsChange,
  onRestore
}: Props) {
  const { t } = useTranslation()
  const isBusy = isBackingUp || isRestoring

  return (
    <>
      <ToggleSwitch
        htmlId="localLibraryMetadataIncludeSecrets"
        value={includeSecrets}
        disabled={isBusy}
        handleChange={() => onIncludeSecretsChange(!includeSecrets)}
        title={t(
          'setting.local-library-sync.include-secrets',
          'Include API keys in backup (stored unencrypted)'
        )}
      />
      {includeSecrets && (
        <Alert variant="warning">
          {t(
            'setting.local-library-sync.include-secrets-warning',
            'Your SteamGridDB and VNDB keys will be saved as plain text. Anyone who can open the backup file can read them, so keep it somewhere private.'
          )}
        </Alert>
      )}
      <div className="localLibraryMetadataActions">
        <Button
          variant="secondary"
          size="sm"
          icon={<Download size={16} />}
          disabled={isBusy}
          onClick={onBackup}
        >
          {isBackingUp
            ? t(
                'setting.local-library-metadata-backup-running',
                'Backing up...'
              )
            : t(
                'setting.local-library-metadata-backup',
                'Back up local library metadata'
              )}
        </Button>
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload size={16} />}
          disabled={isBusy}
          onClick={onRestore}
        >
          {isRestoring
            ? t(
                'setting.local-library-metadata-restore-running',
                'Restoring...'
              )
            : t(
                'setting.local-library-metadata-restore',
                'Restore local library metadata'
              )}
        </Button>
      </div>
      <span className="smallMessage localLibraryMetadataHelp">
        {t(
          'setting.local-library-metadata-help',
          'Backups include local library games, custom metadata overrides, exclusion rules, and all VNDB matches. API keys are only included when the option above is enabled.'
        )}
      </span>
    </>
  )
}
