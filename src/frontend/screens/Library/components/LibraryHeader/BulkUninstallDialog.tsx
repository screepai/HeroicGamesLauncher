import { useContext, useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GameInfo, GameStatus, Status } from 'common/types'
import { WarningMessage } from 'frontend/components/UI'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from 'frontend/components/UI/Dialog'
import ContextProvider from 'frontend/state/ContextProvider'
import './BulkUninstallDialog.css'

export type BulkUninstallAction = 'heroicOnly' | 'entirely'

type Props = {
  action: BulkUninstallAction
  games: GameInfo[]
  onClose: () => void
  onComplete: () => void
}

type UninstallResult =
  | { status: 'pending' }
  | { status: 'uninstalling' }
  | { status: 'done' }
  | { status: 'error'; error: string }

type SkipReason = 'notInstalled' | 'dlc' | 'epicInstall' | 'busy'

const activeStatuses = new Set<Status>([
  'installing',
  'importing',
  'updating',
  'launching',
  'playing',
  'uninstalling',
  'repairing',
  'moving',
  'queued',
  'syncing-saves',
  'redist',
  'extracting',
  'winetricks'
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

function getSkipReason(
  game: GameInfo,
  action: BulkUninstallAction,
  libraryStatus: GameStatus[],
  installingEpicGame: boolean
): SkipReason | null {
  if (!game.is_installed) {
    return 'notInstalled'
  }
  if (action === 'heroicOnly' && game.install.is_dlc) {
    return 'dlc'
  }
  if (installingEpicGame && game.runner === 'legendary') {
    return 'epicInstall'
  }

  const currentStatus = libraryStatus.find(
    (entry) =>
      entry.appName === game.app_name &&
      (entry.runner === undefined || entry.runner === game.runner)
  )?.status

  return currentStatus && activeStatuses.has(currentStatus) ? 'busy' : null
}

export default function BulkUninstallDialog({
  action,
  games,
  onClose,
  onComplete
}: Props) {
  const { t } = useTranslation('gamepage')
  const { installingEpicGame, libraryStatus } = useContext(ContextProvider)
  const [isUninstalling, setIsUninstalling] = useState(false)
  const [targets, setTargets] = useState<GameInfo[] | null>(null)
  const [skippedAtStart, setSkippedAtStart] = useState<
    Array<{ game: GameInfo; reason: SkipReason }>
  >([])
  const [results, setResults] = useState<Record<string, UninstallResult>>({})

  const candidates = useMemo(() => {
    const eligible: GameInfo[] = []
    const skipped: Array<{ game: GameInfo; reason: SkipReason }> = []

    for (const game of getUniqueGames(games)) {
      const reason = getSkipReason(
        game,
        action,
        libraryStatus,
        installingEpicGame
      )
      if (reason) {
        skipped.push({ game, reason })
      } else {
        eligible.push(game)
      }
    }

    return { eligible, skipped }
  }, [action, games, installingEpicGame, libraryStatus])

  const displayedTargets = targets ?? candidates.eligible
  const displayedSkipped = targets ? skippedAtStart : candidates.skipped
  const hasStarted = targets !== null
  const closeDialog = hasStarted ? onComplete : onClose
  const finishedCount = displayedTargets.filter((game) => {
    const result = results[getGameKey(game)]
    return result?.status === 'done' || result?.status === 'error'
  }).length

  async function startUninstall() {
    if (isUninstalling || hasStarted || candidates.eligible.length === 0) {
      return
    }

    const gamesToUninstall = candidates.eligible
    setTargets(gamesToUninstall)
    setSkippedAtStart(candidates.skipped)
    setResults(
      Object.fromEntries(
        gamesToUninstall.map((game) => [
          getGameKey(game),
          { status: 'pending' }
        ])
      )
    )
    setIsUninstalling(true)

    let errorCount = 0
    for (const game of gamesToUninstall) {
      const key = getGameKey(game)
      setResults((previous) => ({
        ...previous,
        [key]: { status: 'uninstalling' }
      }))

      try {
        if (action === 'heroicOnly') {
          await window.api.removeGameFromHeroic(
            game.app_name,
            game.runner,
            false,
            false
          )
        } else {
          await window.api.uninstall(
            game.app_name,
            game.runner,
            false,
            false,
            true
          )
        }
        window.localStorage.removeItem(game.app_name)
        setResults((previous) => ({
          ...previous,
          [key]: { status: 'done' }
        }))
      } catch (error) {
        errorCount += 1
        setResults((previous) => ({
          ...previous,
          [key]: { status: 'error', error: String(error) }
        }))
      }
    }

    setIsUninstalling(false)
    if (errorCount === 0) {
      onComplete()
    }
  }

  function getSkipReasonLabel(reason: SkipReason): string {
    switch (reason) {
      case 'notInstalled':
        return t('library.bulk-uninstall.skip-not-installed', 'Not installed')
      case 'dlc':
        return t(
          'library.bulk-uninstall.skip-dlc',
          'DLC can only be uninstalled entirely'
        )
      case 'epicInstall':
        return t(
          'library.bulk-uninstall.skip-epic-install',
          'Another Epic game is being installed'
        )
      case 'busy':
        return t('library.bulk-uninstall.skip-busy', 'Game is busy')
    }
  }

  const entirely = action === 'entirely'

  return (
    <Dialog
      onClose={isUninstalling ? () => null : closeDialog}
      showCloseButton={!isUninstalling}
      className="BulkUninstallDialog"
    >
      <DialogHeader>
        {entirely
          ? t(
              'library.bulk-uninstall.entirely-title',
              'Uninstall Games Entirely'
            )
          : t(
              'library.bulk-uninstall.heroic-only-title',
              'Uninstall Games in Heroic'
            )}
      </DialogHeader>
      <DialogContent className="bulkUninstallContent">
        <p>
          {entirely
            ? t(
                'library.bulk-uninstall.entirely-description',
                'Uninstall {{count}} eligible selected games and delete their game files from disk.',
                { count: displayedTargets.length }
              )
            : t(
                'library.bulk-uninstall.heroic-only-description',
                'Remove {{count}} eligible selected games from the installed list and keep their game files.',
                { count: displayedTargets.length }
              )}
        </p>
        {entirely && (
          <WarningMessage>
            {t(
              'library.bulk-uninstall.delete-warning',
              'Game files will be permanently deleted. Wine prefixes and Heroic settings will be kept.'
            )}
          </WarningMessage>
        )}
        {displayedSkipped.length > 0 && (
          <WarningMessage>
            {t(
              'library.bulk-uninstall.skipped-count',
              '{{count}} selected games cannot be uninstalled with this action.',
              { count: displayedSkipped.length }
            )}
          </WarningMessage>
        )}
        <div className="bulkUninstallSummary">
          {hasStarted
            ? t(
                'library.bulk-uninstall.progress',
                '{{done}} of {{count}} uninstalls finished.',
                { done: finishedCount, count: displayedTargets.length }
              )
            : t(
                'library.bulk-uninstall.ready',
                '{{count}} games are ready to uninstall.',
                { count: displayedTargets.length }
              )}
        </div>
        <div className="bulkUninstallRows">
          {displayedTargets.map((game) => {
            const result = results[getGameKey(game)] ?? { status: 'pending' }
            return (
              <div className="bulkUninstallRow" key={getGameKey(game)}>
                <span>{game.overrides?.title || game.title}</span>
                <strong className={`uninstallStatus-${result.status}`}>
                  {result.status === 'pending' &&
                    t('library.bulk-uninstall.status-pending', 'Pending')}
                  {result.status === 'uninstalling' &&
                    t(
                      'library.bulk-uninstall.status-uninstalling',
                      'Uninstalling'
                    )}
                  {result.status === 'done' &&
                    t('library.bulk-uninstall.status-done', 'Done')}
                  {result.status === 'error' &&
                    t('library.bulk-uninstall.status-error', 'Error')}
                </strong>
                {result.status === 'error' && <em>{result.error}</em>}
              </div>
            )
          })}
          {displayedSkipped.map(({ game, reason }) => (
            <div
              className="bulkUninstallRow bulkUninstallRow--skipped"
              key={getGameKey(game)}
            >
              <span>{game.overrides?.title || game.title}</span>
              <small>{getSkipReasonLabel(reason)}</small>
              <strong>
                {t('library.bulk-uninstall.status-skipped', 'Skipped')}
              </strong>
            </div>
          ))}
        </div>
      </DialogContent>
      <DialogFooter>
        <button
          className="button is-secondary"
          onClick={closeDialog}
          disabled={isUninstalling}
        >
          {hasStarted
            ? t('button.close', 'Close')
            : t('button.cancel', 'Cancel')}
        </button>
        {!hasStarted && (
          <button
            className="button is-danger"
            onClick={() => void startUninstall()}
            disabled={isUninstalling || displayedTargets.length === 0}
          >
            {entirely
              ? t('box.uninstall.entirely', 'Uninstall entirely')
              : t('box.uninstall.heroicOnly', 'Uninstall in Heroic')}
          </button>
        )}
      </DialogFooter>
    </Dialog>
  )
}
