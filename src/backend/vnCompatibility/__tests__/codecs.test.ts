import { EventEmitter } from 'events'

const codecScriptHashMock =
  'c95f0d8ab0c0695cc7cb729cfd98c6336bf6523c7f313553fb1e3e05b2184a17'
const childrenMock: EventEmitter[] = []
const spawnMock = jest.fn()
function createChildMock() {
  const child = new EventEmitter() as EventEmitter & {
    stdout: EventEmitter & { setEncoding: jest.Mock }
    stderr: EventEmitter & { setEncoding: jest.Mock }
  }
  child.stdout = Object.assign(new EventEmitter(), {
    setEncoding: jest.fn()
  })
  child.stderr = Object.assign(new EventEmitter(), {
    setEncoding: jest.fn()
  })
  childrenMock.push(child)
  return child
}
const sendGameStatusUpdateMock = jest.fn()
const logErrorMock = jest.fn()

jest.mock('child_process', () => ({ spawn: spawnMock }))
jest.mock('crypto', () => ({
  createHash: () => ({
    update() {
      return this
    },
    digest: () => codecScriptHashMock
  })
}))
jest.mock('fs/promises', () => ({ chmod: jest.fn() }))
jest.mock('graceful-fs', () => ({
  existsSync: () => true,
  mkdirSync: jest.fn(),
  readFileSync: jest.fn(),
  rmSync: jest.fn()
}))
jest.mock('backend/config', () => ({
  GlobalConfig: {
    get: () => ({
      getSettings: () => ({
        sharedWinePrefix: '/prefixes/shared',
        winePrefix: '/prefixes/default'
      })
    })
  }
}))
jest.mock('backend/constants/environment', () => ({ isLinux: true }))
jest.mock('backend/constants/paths', () => ({
  toolsPath: '/tools',
  userHome: '/home/test'
}))
jest.mock('backend/ipc', () => ({ sendFrontendMessage: jest.fn() }))
jest.mock('backend/launcher', () => ({
  setupEnvVars: () => ({}),
  setupWineEnvVars: () => ({}),
  verifyWinePrefix: () => Promise.resolve({ res: { stdout: '', stderr: '' } })
}))
jest.mock('backend/logger', () => ({
  logError: logErrorMock,
  logInfo: jest.fn(),
  LogPrefix: { WineTricks: 'Winetricks' }
}))
jest.mock('backend/storeManagers', () => ({
  libraryManagerMap: {
    legendary: {
      getGame: (appName: string) => ({
        getSettings: () =>
          Promise.resolve({
            enviromentOptions: [],
            winePrefix: `/prefixes/${appName}`,
            wineVersion: { bin: '/usr/bin/wine', type: 'wine' }
          })
      })
    }
  }
}))
jest.mock('backend/utils', () => ({
  sendGameStatusUpdate: sendGameStatusUpdateMock
}))
jest.mock('backend/utils/inet/downloader', () => ({
  DAYS: 86_400_000,
  downloadFile: jest.fn()
}))
jest.mock('../prefixes', () => ({
  getManagedPrefixMetadata: () => null,
  isDefaultWinePrefixPath: (path: string, prefixes: string[]) =>
    prefixes.includes(path),
  recordInstalledSpecialCodecs: jest.fn()
}))

import { installSpecialCodecs } from '../codecs'

const flushPromises = () =>
  new Promise<void>((resolve) => setImmediate(resolve))

beforeEach(() => {
  jest.clearAllMocks()
  childrenMock.length = 0
  spawnMock.mockImplementation(createChildMock)
})

it('runs only one shared codec helper process at a time', async () => {
  const firstInstall = installSpecialCodecs({
    appName: 'first-game',
    runner: 'legendary',
    codecs: ['quartz2']
  })
  await flushPromises()
  expect(spawnMock).toHaveBeenCalledTimes(1)

  const secondInstall = installSpecialCodecs({
    appName: 'second-game',
    runner: 'legendary',
    codecs: ['quartz2']
  })
  await flushPromises()

  expect(spawnMock).toHaveBeenCalledTimes(1)
  await expect(secondInstall).resolves.toEqual({
    status: 'error',
    error: 'A Special Codecs installation is already running'
  })

  childrenMock[0].emit('close', 0)
  await expect(firstInstall).resolves.toEqual({ status: 'done' })
})
