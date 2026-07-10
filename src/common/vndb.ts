import type { GameInfo } from './types'
import type { VndbGameMatchTarget, VndbUserDataSyncTarget } from './types/vndb'

export function getVndbMatchKey(
  match: Pick<VndbGameMatchTarget, 'appName' | 'runner'>
): string {
  return `${match.runner}:${match.appName}`
}

export function getGameVndbMatchKey(
  game: Pick<GameInfo, 'app_name' | 'runner'>
): string {
  return getVndbMatchKey({
    appName: game.app_name,
    runner: game.runner
  })
}

export function getVndbUserDataSyncTarget(
  game: GameInfo,
  includeReleases = true
): VndbUserDataSyncTarget {
  return {
    appName: game.app_name,
    runner: game.runner,
    installedAt: game.install.installed_at,
    installPath: game.install.install_path || game.folder_name,
    includeReleases
  }
}
