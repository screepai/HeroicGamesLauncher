const mockGameSettings = {
  jpLocale: true,
  launcherArgs: '--from-settings "two words"'
}
const mockGlobalSettings = {
  localeEmulatorPath: 'C:\\Locale Emulator\\LEProc.exe'
}
const mockPrepareLaunch = jest.fn()
const mockPrepareWineLaunch = jest.fn()
const mockSetupWrappers = jest.fn()
const mockSetupWrapperEnvVars = jest.fn()
const mockSetupEnvVars = jest.fn()
const mockGetKnownFixesEnvVariables = jest.fn()
const mockCallRunner = jest.fn()
const mockRunWineCommand = jest.fn()
const mockLaunchCleanup = jest.fn()
const mockShowDialogBoxModalAuto = jest.fn()
const mockSendGameStatusUpdate = jest.fn()
const mockAccess = jest.fn()
const mockChmod = jest.fn()

jest.mock('../../../game_config')
jest.mock('../../../config')
jest.mock('backend/logger', () => ({
  logInfo: jest.fn(),
  logWarning: jest.fn(),
  LogPrefix: { Backend: 'Backend' }
}))
jest.mock('../../../launcher', () => ({
  callRunner: mockCallRunner,
  getKnownFixesEnvVariables: mockGetKnownFixesEnvVariables,
  launchCleanup: mockLaunchCleanup,
  prepareLaunch: mockPrepareLaunch,
  prepareWineLaunch: mockPrepareWineLaunch,
  runWineCommand: mockRunWineCommand,
  setupEnvVars: mockSetupEnvVars,
  setupWrapperEnvVars: mockSetupWrapperEnvVars,
  setupWrappers: mockSetupWrappers
}))
jest.mock('fs/promises', () => ({
  access: mockAccess,
  chmod: mockChmod
}))
jest.mock('../../../dialog/dialog', () => ({
  showDialogBoxModalAuto: mockShowDialogBoxModalAuto
}))
jest.mock('../../../utils/aborthandler/aborthandler', () => ({
  createAbortController: jest.fn(),
  deleteAbortController: jest.fn()
}))
jest.mock('electron')
jest.mock('backend/utils', () => ({
  sendGameStatusUpdate: mockSendGameStatusUpdate
}))
jest.mock('backend/constants/environment', () => ({
  isLinux: false,
  isMac: false,
  isWindows: true
}))
jest.mock('backend/constants/paths', () => ({
  windowIcon: 'icon.png'
}))

import type { GameInfo } from 'common/types'
import type { Game } from 'common/types/game_manager'
import type LogWriter from 'backend/logger/log_writer'
import { GlobalConfig } from '../../../config'
import { GameConfig } from '../../../game_config'
import { launchGame } from '../games'

const gameInfo: GameInfo = {
  app_name: 'visual-novel',
  runner: 'sideload',
  title: 'Visual Novel',
  art_cover: '',
  art_square: '',
  install: {
    executable: 'C:\\Games\\Visual Novel\\game.exe',
    install_path: 'C:\\Games\\Visual Novel',
    platform: 'Windows'
  },
  is_installed: true,
  canRunOffline: true
}

function makeGame(isNative: boolean): Game {
  return {
    getGameInfo: jest.fn(() => gameInfo),
    isNative: jest.fn(() => isNative)
  } as unknown as Game
}

const logWriter = {
  logError: jest.fn()
} as unknown as LogWriter

describe('launchGame Locale Emulator integration', () => {
  beforeEach(() => {
    jest.clearAllMocks()
    jest.spyOn(GameConfig, 'get').mockReturnValue({
      config: undefined,
      getSettings: jest.fn(() => Promise.resolve(mockGameSettings))
    } as unknown as ReturnType<typeof GameConfig.get>)
    jest.spyOn(GlobalConfig, 'get').mockReturnValue({
      getSettings: jest.fn(() => mockGlobalSettings)
    } as unknown as ReturnType<typeof GlobalConfig.get>)
    mockGameSettings.jpLocale = true
    mockGameSettings.launcherArgs = '--from-settings "two words"'
    mockGlobalSettings.localeEmulatorPath = 'C:\\Locale Emulator\\LEProc.exe'
    mockPrepareLaunch.mockResolvedValue({
      success: true,
      failureReason: undefined,
      rpcClient: undefined,
      mangoHudCommand: undefined,
      gameScopeCommand: undefined,
      gameModeBin: undefined,
      steamRuntime: undefined
    })
    mockSetupWrappers.mockReturnValue([])
    mockSetupWrapperEnvVars.mockReturnValue({})
    mockSetupEnvVars.mockReturnValue({})
    mockGetKnownFixesEnvVariables.mockReturnValue({})
    mockCallRunner.mockResolvedValue({ stdout: '', stderr: '' })
    mockRunWineCommand.mockResolvedValue({ stdout: '', stderr: '' })
    mockAccess.mockResolvedValue(undefined)
  })

  it('wraps a native Windows launch with Locale Emulator', async () => {
    const game = makeGame(true)

    await expect(launchGame(game, logWriter, ['--from-call'])).resolves.toBe(
      true
    )

    expect(game.isNative).toHaveBeenCalled()
    expect(mockCallRunner).toHaveBeenCalledWith(
      [
        '-run',
        'C:\\Games\\Visual Novel\\game.exe',
        '--from-settings',
        'two words',
        '--from-call'
      ],
      expect.objectContaining({
        bin: 'LEProc.exe',
        dir: 'C:\\Locale Emulator'
      }),
      expect.any(Object)
    )
    expect(mockRunWineCommand).not.toHaveBeenCalled()
  })

  it('passes the Game instance through the non-native launch path', async () => {
    const game = makeGame(false)

    await expect(launchGame(game, logWriter)).resolves.toBe(true)

    expect(mockPrepareWineLaunch).toHaveBeenCalledWith(game, logWriter)
    expect(mockRunWineCommand).toHaveBeenCalledWith(
      expect.objectContaining({
        commandParts: [
          'C:\\Locale Emulator\\LEProc.exe',
          '-run',
          'C:\\Games\\Visual Novel\\game.exe',
          '--from-settings',
          'two words'
        ]
      })
    )
  })

  it('blocks JP locale launches when Locale Emulator is not configured', async () => {
    mockGlobalSettings.localeEmulatorPath = ''
    const game = makeGame(true)

    await expect(launchGame(game, logWriter)).resolves.toBe(false)

    expect(mockShowDialogBoxModalAuto).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'ERROR'
      })
    )
    expect(mockPrepareLaunch).not.toHaveBeenCalled()
    expect(mockCallRunner).not.toHaveBeenCalled()
  })
})
