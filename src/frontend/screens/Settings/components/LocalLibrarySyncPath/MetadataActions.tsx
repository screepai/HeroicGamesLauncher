import { useTranslation } from 'react-i18next'

type Props = {
  isBackingUp: boolean
  isRestoring: boolean
  onBackup: () => void
  onRestore: () => void
}

export default function MetadataActions({
  isBackingUp,
  isRestoring,
  onBackup,
  onRestore
}: Props) {
  const { t } = useTranslation()
  const isBusy = isBackingUp || isRestoring

  return (
    <>
      <div className="localLibraryMetadataActions">
        <button
          className="button is-secondary"
          disabled={isBusy}
          onClick={onBackup}
          type="button"
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
        </button>
        <button
          className="button is-secondary"
          disabled={isBusy}
          onClick={onRestore}
          type="button"
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
        </button>
      </div>
      <span className="smallMessage localLibraryMetadataHelp">
        {t(
          'setting.local-library-metadata-help',
          'Backups include local library games, custom metadata overrides, exclusion rules, all VNDB matches, and your VNDB token.'
        )}
      </span>
    </>
  )
}
