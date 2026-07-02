import { useEffect, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { AppSettings, GameInfo, Runner } from 'common/types'
import { PathSelectionBox, WarningMessage } from 'frontend/components/UI'
import './BulkGameMigrationDialog.css'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from 'frontend/components/UI/Dialog'
import { APP_SETTING_CHANGED_EVENT } from 'frontend/hooks/useAppSetting'

type Props = {
  games: GameInfo[]
  onClose: () => void
}

type MigrationResult =
  | { status: 'pending' }
  | { status: 'moving' }
  | { status: 'done' }
  | { status: 'error'; error: string }

const supportedRunners = new Set<Runner>([
  'legendary',
  'gog',
  'nile',
  'sideload'
])

function getGameKey(game: Pick<GameInfo, 'runner' | 'app_name'>): string {
  return `${game.runner}:${game.app_name}`
}

function getUniqueGames(games: GameInfo[]): GameInfo[] {
  const seen = new Set<string>()
  return games.filter((game) => {
    const key = getGameKey(game)
    if (seen.has(key)) {
      return false
    }
    seen.add(key)
    return true
  })
}

export function isMigratableGame(game: GameInfo): boolean {
  return (
    game.is_installed &&
    supportedRunners.has(game.runner) &&
    Boolean(getMigratableInstallPath(game)) &&
    !game.install.is_dlc &&
    !game.thirdPartyManagedApp
  )
}

function getMigratableInstallPath(game: GameInfo): string {
  return (
    game.install.install_path ||
    game.folder_name ||
    game.install.executable ||
    ''
  )
}

export default function BulkGameMigrationDialog({ games, onClose }: Props) {
  const { t } = useTranslation('gamepage')
  const [destination, setDestination] = useState('')
  const [defaultPath, setDefaultPath] = useState<string | undefined>()
  const [migrationArchivePath, setMigrationArchivePath] = useState('')
  const [migrationArchivePromptMode, setMigrationArchivePromptMode] =
    useState<AppSettings['migrationArchivePromptMode']>('ask')
  const [isMigrating, setIsMigrating] = useState(false)
  const [results, setResults] = useState<Record<string, MigrationResult>>({})
  const [showArchivePrompt, setShowArchivePrompt] = useState(false)
  const [rememberArchiveChoice, setRememberArchiveChoice] = useState(false)

  const uniqueGames = useMemo(() => getUniqueGames(games), [games])
  const migratableGames = useMemo(
    () => uniqueGames.filter(isMigratableGame),
    [uniqueGames]
  )
  const skippedGames = useMemo(
    () => uniqueGames.filter((game) => !isMigratableGame(game)),
    [uniqueGames]
  )
  const finishedCount = migratableGames.filter((game) => {
    const result = results[getGameKey(game)]
    return result?.status === 'done' || result?.status === 'error'
  }).length
  const hasStarted = Object.keys(results).length > 0

  useEffect(() => {
    window.api.requestAppSettings().then((settings) => {
      const {
        defaultInstallPath,
        migrationArchivePath,
        migrationArchivePromptMode
      } = settings
      const archivePath = migrationArchivePath ?? ''
      setDefaultPath(archivePath || defaultInstallPath)
      setDestination(archivePath || defaultInstallPath || '')
      setMigrationArchivePath(archivePath)
      setMigrationArchivePromptMode(migrationArchivePromptMode ?? 'ask')
    })
  }, [])

  function setAppSetting<T extends keyof AppSettings>(
    key: T,
    value: AppSettings[T]
  ) {
    window.api.setSetting({ appName: 'default', key, value })
    window.dispatchEvent(
      new CustomEvent(APP_SETTING_CHANGED_EVENT, {
        detail: { key, value }
      })
    )
  }

  function isDestinationArchived(): boolean {
    return (
      Boolean(destination) &&
      migrationArchivePath.toLowerCase() === destination.toLowerCase()
    )
  }

  function saveDestinationAsArchive() {
    setAppSetting('migrationArchivePath', destination)
    setMigrationArchivePath(destination)
  }

  function startMigration() {
    if (!destination || isMigrating || migratableGames.length === 0) {
      return
    }

    if (isDestinationArchived()) {
      void runMigration(false)
      return
    }

    if (migrationArchivePromptMode === 'always') {
      void runMigration(true)
      return
    }

    if (migrationArchivePromptMode === 'never') {
      void runMigration(false)
      return
    }

    setShowArchivePrompt(true)
  }

  async function handleArchivePromptChoice(saveArchivePath: boolean) {
    setShowArchivePrompt(false)

    if (rememberArchiveChoice) {
      const nextMode: AppSettings['migrationArchivePromptMode'] =
        saveArchivePath ? 'always' : 'never'
      setAppSetting('migrationArchivePromptMode', nextMode)
      setMigrationArchivePromptMode(nextMode)
    }

    await runMigration(saveArchivePath)
  }

  async function runMigration(saveArchivePath: boolean) {
    if (!destination || isMigrating || migratableGames.length === 0) {
      return
    }

    setIsMigrating(true)
    setResults(
      Object.fromEntries(
        migratableGames.map((game) => [getGameKey(game), { status: 'pending' }])
      )
    )

    const movedRunners = new Set<Runner>()

    for (const game of migratableGames) {
      const key = getGameKey(game)
      setResults((previous) => ({
        ...previous,
        [key]: { status: 'moving' }
      }))

      try {
        const result = await window.api.moveInstall({
          appName: game.app_name,
          path: destination,
          runner: game.runner
        })

        if (result.status === 'done') {
          movedRunners.add(game.runner)
          setResults((previous) => ({
            ...previous,
            [key]: { status: 'done' }
          }))
        } else {
          setResults((previous) => ({
            ...previous,
            [key]: { status: 'error', error: result.error }
          }))
        }
      } catch (error) {
        setResults((previous) => ({
          ...previous,
          [key]: { status: 'error', error: String(error) }
        }))
      }
    }

    for (const runner of movedRunners) {
      await window.api.refreshLibrary(runner)
    }

    if (saveArchivePath) {
      saveDestinationAsArchive()
    }

    setIsMigrating(false)
  }

  function getSkipReason(game: GameInfo): string {
    if (!game.is_installed) {
      return t('library.migration.skip-not-installed', 'Not installed')
    }
    if (!supportedRunners.has(game.runner)) {
      return t('library.migration.skip-runner', 'Move is not supported')
    }
    if (game.install.is_dlc) {
      return t('library.migration.skip-dlc', 'DLC follows its base game')
    }
    if (game.thirdPartyManagedApp) {
      return t(
        'library.migration.skip-third-party',
        'Managed by another launcher'
      )
    }
    return t('library.migration.skip-path', 'Install path is missing')
  }

  return (
    <Dialog
      onClose={isMigrating ? () => null : onClose}
      showCloseButton={!isMigrating}
      className="BulkGameMigrationDialog"
    >
      <DialogHeader>
        {t('library.migration.title', 'Migrate Games')}
      </DialogHeader>
      <DialogContent className="bulkGameMigrationContent">
        <p>
          {t(
            'library.migration.description',
            'Move {{count}} eligible selected games to a different folder or drive.',
            { count: migratableGames.length }
          )}
        </p>
        {skippedGames.length > 0 && (
          <WarningMessage>
            {t(
              'library.migration.skipped-count',
              '{{count}} selected games cannot be migrated.',
              { count: skippedGames.length }
            )}
          </WarningMessage>
        )}
        <PathSelectionBox
          htmlId="bulk-game-migration-path"
          type="directory"
          path={destination}
          onPathChange={setDestination}
          pathDialogTitle={t('box.move.path')}
          pathDialogDefaultPath={defaultPath}
          placeholder={t(
            'library.migration.destination-placeholder',
            'Destination folder'
          )}
          label={t('library.migration.destination', 'Destination')}
          disabled={isMigrating}
          noDeleteButton
        />
        <div className="bulkGameMigrationSummary">
          {isMigrating || hasStarted
            ? t(
                'library.migration.progress',
                '{{done}} of {{count}} migrations finished.',
                { done: finishedCount, count: migratableGames.length }
              )
            : t(
                'library.migration.ready',
                '{{count}} games are ready to migrate.',
                { count: migratableGames.length }
              )}
        </div>
        <div className="bulkGameMigrationRows">
          {migratableGames.map((game) => {
            const result = results[getGameKey(game)] ?? { status: 'pending' }
            return (
              <div className="bulkGameMigrationRow" key={getGameKey(game)}>
                <span>{game.title}</span>
                <small title={getMigratableInstallPath(game)}>
                  {getMigratableInstallPath(game)}
                </small>
                <strong className={`migrationStatus-${result.status}`}>
                  {result.status === 'pending' &&
                    t('library.migration.status-pending', 'Pending')}
                  {result.status === 'moving' &&
                    t('library.migration.status-moving', 'Moving')}
                  {result.status === 'done' &&
                    t('library.migration.status-done', 'Done')}
                  {result.status === 'error' &&
                    t('library.migration.status-error', 'Error')}
                </strong>
                {result.status === 'error' && <em>{result.error}</em>}
              </div>
            )
          })}
          {skippedGames.map((game) => (
            <div
              className="bulkGameMigrationRow bulkGameMigrationRow--skipped"
              key={getGameKey(game)}
            >
              <span>{game.title}</span>
              <small>{getSkipReason(game)}</small>
              <strong>
                {t('library.migration.status-skipped', 'Skipped')}
              </strong>
            </div>
          ))}
        </div>
      </DialogContent>
      <DialogFooter>
        <button
          className="button is-secondary"
          onClick={onClose}
          disabled={isMigrating}
        >
          {hasStarted && !isMigrating
            ? t('button.close', 'Close')
            : t('button.cancel', 'Cancel')}
        </button>
        {!hasStarted && (
          <button
            className="button is-success"
            onClick={() => void startMigration()}
            disabled={
              isMigrating || !destination || migratableGames.length === 0
            }
          >
            {t('library.migration.start', 'Start Migration')}
          </button>
        )}
      </DialogFooter>
      {showArchivePrompt && (
        <Dialog
          onClose={() => setShowArchivePrompt(false)}
          showCloseButton
          className="MigrationArchivePromptDialog"
        >
          <DialogHeader>
            {t(
              'library.migration.archive-prompt-title',
              'Remember migration archive folder?'
            )}
          </DialogHeader>
          <DialogContent className="migrationArchivePromptContent">
            <p>
              {t(
                'library.migration.archive-prompt-message',
                'Do you want to save this destination as your migration archive folder?'
              )}
            </p>
            <strong title={destination}>{destination}</strong>
            <label className="migrationArchiveRememberChoice">
              <input
                type="checkbox"
                checked={rememberArchiveChoice}
                onChange={(event) =>
                  setRememberArchiveChoice(event.target.checked)
                }
              />
              {t(
                'library.migration.archive-prompt-remember',
                'Remember this choice'
              )}
            </label>
          </DialogContent>
          <DialogFooter>
            <button
              className="button is-secondary"
              onClick={() => void handleArchivePromptChoice(false)}
            >
              {t('box.no', 'No')}
            </button>
            <button
              className="button is-success"
              onClick={() => void handleArchivePromptChoice(true)}
            >
              {t('box.yes', 'Yes')}
            </button>
          </DialogFooter>
        </Dialog>
      )}
    </Dialog>
  )
}
