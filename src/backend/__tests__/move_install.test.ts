import { promises as fs } from 'fs'
import { isAbsolute, join, relative } from 'path'

import type { GameInfo } from 'common/types'
import { getMigratedExecutablePath, moveOnWindows } from '../utils'

jest.mock('electron')
jest.mock('../logger')
jest.mock('../dialog/dialog')

const heroicTestRoot = 'V:\\Heroic Archive UI Test'
const migrationTestRoot = join(heroicTestRoot, 'migration-system-test')
const describeIfWindows =
  process.platform === 'win32' ? describe : describe.skip

async function pathExists(path: string): Promise<boolean> {
  try {
    await fs.access(path)
    return true
  } catch {
    return false
  }
}

describe('move install', () => {
  const runIfHeroicTestFolderExists =
    process.platform === 'win32' ? test : test.skip

  runIfHeroicTestFolderExists(
    'moves an installed game folder into the selected destination on Windows',
    async () => {
      if (!(await pathExists(heroicTestRoot))) {
        console.warn(
          `Skipping move install test because ${heroicTestRoot} is not available.`
        )
        return
      }

      const sourceParent = join(migrationTestRoot, 'source')
      const destinationParent = join(migrationTestRoot, 'destination')
      const installPath = join(sourceParent, 'Heroic Migration Test Game')
      const destinationPath = join(
        destinationParent,
        'Heroic Migration Test Game'
      )
      const sourceFile = join(installPath, 'data', 'save.txt')
      const destinationFile = join(destinationPath, 'data', 'save.txt')
      const executablePath = join(installPath, 'Game.exe')
      const destinationExecutablePath = join(destinationPath, 'Game.exe')

      await fs.rm(migrationTestRoot, { recursive: true, force: true })
      await fs.mkdir(join(installPath, 'data'), { recursive: true })
      await fs.mkdir(destinationParent, { recursive: true })
      await fs.writeFile(sourceFile, 'migration-test-data', 'utf8')
      await fs.writeFile(executablePath, 'fake-executable', 'utf8')

      const gameInfo = {
        app_name: 'heroic-migration-test',
        runner: 'legendary',
        title: 'Heroic Migration Test Game',
        art_cover: '',
        art_square: '',
        install: {
          executable: relative(installPath, executablePath),
          install_path: installPath,
          platform: 'Windows'
        },
        is_installed: true,
        canRunOffline: true
      } as GameInfo

      const result = await moveOnWindows(destinationParent, gameInfo)

      expect(result).toEqual({
        status: 'done',
        installPath: destinationPath
      })
      await expect(fs.readFile(destinationFile, 'utf8')).resolves.toBe(
        'migration-test-data'
      )
      expect(gameInfo.install.executable).toBeDefined()
      const executable = gameInfo.install.executable!
      await expect(
        fs.readFile(
          join(result.status === 'done' ? result.installPath : '', executable),
          'utf8'
        )
      ).resolves.toBe('fake-executable')
      expect(isAbsolute(executable)).toBe(false)
      await expect(
        fs.access(destinationExecutablePath)
      ).resolves.toBeUndefined()
      await expect(fs.access(sourceFile)).rejects.toThrow()
      await expect(fs.access(executablePath)).rejects.toThrow()

      await fs.rm(migrationTestRoot, { recursive: true, force: true })
    },
    30000
  )
})

describeIfWindows('getMigratedExecutablePath', () => {
  it('leaves relative executable paths unchanged', () => {
    expect(
      getMigratedExecutablePath(
        join('Binaries', 'Game.exe'),
        'V:\\Games\\Old Game',
        'V:\\Games\\New Game'
      )
    ).toBe(join('Binaries', 'Game.exe'))
  })

  it('migrates absolute executable paths inside the old install path', () => {
    expect(
      getMigratedExecutablePath(
        'V:\\Games\\Old Game\\Binaries\\Game.exe',
        'V:\\Games\\Old Game',
        'V:\\Games\\New Game'
      )
    ).toBe('V:\\Games\\New Game\\Binaries\\Game.exe')
  })

  it('leaves absolute executable paths outside the old install path unchanged', () => {
    expect(
      getMigratedExecutablePath(
        'V:\\Tools\\CustomLauncher.exe',
        'V:\\Games\\Old Game',
        'V:\\Games\\New Game'
      )
    ).toBe('V:\\Tools\\CustomLauncher.exe')
  })
})
