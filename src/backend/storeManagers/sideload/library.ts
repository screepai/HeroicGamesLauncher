import { ExecResult, GameInfo } from 'common/types'
import { readdirSync } from 'graceful-fs'
import { dirname, join } from 'path'
import { libraryStore } from './electronStores'
import { logWarning } from 'backend/logger'
import { getMigratedExecutablePath } from 'backend/utils'
import { addShortcuts } from 'backend/shortcuts/shortcuts/shortcuts'
import { sendFrontendMessage } from 'backend/ipc'
import { isMac } from 'backend/constants/environment'
import { LibraryManager } from 'common/types/game_manager'
import SideloadGame from './games'

function getExecutableDir(executable: string): string {
  const usesBackslash = executable.includes('\\')
  const executableDir = dirname(executable.replaceAll('\\', '/'))
  return usesBackslash ? executableDir.replaceAll('/', '\\') : executableDir
}

export default class SideloadLibraryManager implements LibraryManager {
  init = () => Promise.resolve()

  getGame(id: string): SideloadGame {
    return new SideloadGame(id)
  }

  addNewApp({
    app_name,
    title,
    install: { executable, platform },
    art_cover,
    art_square,
    browserUrl,
    is_installed = true,
    description,
    customUserAgent,
    launchFullScreen,
    isVisualNovel
  }: GameInfo): void {
    const current = libraryStore.get('games', [])
    const gameIndex = current.findIndex((value) => value.app_name === app_name)
    const installedAt =
      gameIndex === -1
        ? new Date().toISOString()
        : current[gameIndex].install.installed_at
    const game: GameInfo = {
      runner: 'sideload',
      app_name,
      title,
      install: {
        executable,
        installed_at: installedAt,
        platform,
        is_dlc: false
      },
      folder_name:
        executable !== undefined ? getExecutableDir(executable) : undefined,
      art_cover,
      is_installed: is_installed !== undefined ? is_installed : true,
      art_square,
      canRunOffline: !browserUrl,
      browserUrl,
      description,
      customUserAgent,
      launchFullScreen,
      isVisualNovel
    }

    if (isMac && executable?.endsWith('.app')) {
      const macAppExecutable = readdirSync(
        join(executable, 'Contents', 'MacOS')
      )[0]
      game.install.executable = join(
        executable,
        'Contents',
        'MacOS',
        macAppExecutable
      )
    }

    // edit app in case it exists
    if (gameIndex !== -1) {
      current[gameIndex] = { ...current[gameIndex], ...game }
    } else {
      current.push(game)
      addShortcuts(new SideloadGame(app_name))
    }

    libraryStore.set('games', current)

    sendFrontendMessage('refreshLibrary', 'sideload')

    return
  }

  installState() {
    logWarning(`installState not implemented on Sideload Library Manager`)
  }

  async refresh() {
    logWarning(`refresh not implemented on Sideload Library Manager`)
    return null
  }

  getGameInfo(): GameInfo {
    logWarning(`getGameInfo not implemented on Sideload Library Manager`)
    return {
      app_name: '',
      runner: 'sideload',
      art_cover: '',
      art_square: '',
      install: {},
      is_installed: false,
      title: '',
      canRunOffline: false
    }
  }

  async listUpdateableGames(): Promise<string[]> {
    logWarning(
      `listUpdateableGames not implemented on Sideload Library Manager`
    )
    return []
  }

  async runRunnerCommand(): Promise<ExecResult> {
    logWarning(`runRunnerCommand not implemented on Sideload Library Manager`)
    return { stdout: '', stderr: '' }
  }

  async changeGameInstallPath(appName: string, newPath: string): Promise<void> {
    const current = libraryStore.get('games', [])
    const gameIndex = current.findIndex((value) => value.app_name === appName)
    if (gameIndex === -1) {
      logWarning(`sideload game not found in changeGameInstallPath: ${appName}`)
      return
    }

    const oldPath =
      current[gameIndex].install.install_path ||
      current[gameIndex].folder_name ||
      (current[gameIndex].install.executable
        ? getExecutableDir(current[gameIndex].install.executable)
        : undefined)

    current[gameIndex] = {
      ...current[gameIndex],
      folder_name: newPath,
      install: {
        ...current[gameIndex].install,
        executable: getMigratedExecutablePath(
          current[gameIndex].install.executable,
          oldPath,
          newPath
        ),
        install_path: newPath
      }
    }
    libraryStore.set('games', current)
    sendFrontendMessage('refreshLibrary', 'sideload')
  }

  async getInstallInfo(): Promise<undefined> {
    logWarning(`getInstallInfo not implemented on Sideload Library Manager`)
    return undefined
  }

  getLaunchOptions = () => []

  changeVersionPinnedStatus() {
    logWarning(
      'changeVersionPinnedStatus not implemented on Sideload Library Manager'
    )
  }
}
