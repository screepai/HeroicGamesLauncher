import { expect } from '@playwright/test'
import type { GameInfo } from '../src/common/types'
import type {
  VndbGameMatchTarget,
  VndbGameMatchUpdate,
  VndbSearchResult
} from '../src/common/types/vndb'
import { electronTest } from './helpers'

declare const window: { api: typeof import('../src/preload/api').default }

const game: GameInfo = {
  app_name: 'vndb-sync-confirm',
  runner: 'sideload',
  title: 'VNDB Sync Confirm',
  art_cover: '',
  art_square: '',
  browserUrl: 'https://example.com',
  canRunOffline: false,
  is_installed: true,
  install: {
    executable: '',
    is_dlc: false,
    platform: 'Browser'
  }
}

const suggestedResult: VndbSearchResult = {
  id: 'v910001',
  title: 'Wrong Automatic Result',
  source: 'visualNovel',
  developers: [],
  languages: [],
  platforms: [],
  relations: []
}

electronTest(
  'does not confirm automatic VNDB search suggestions',
  async (app, page) => {
    await page.evaluate(async (gameInfo) => {
      window.api.addNewApp(gameInfo)
      await window.api.vndb.syncGameMatches([
        {
          appName: gameInfo.app_name,
          runner: gameInfo.runner,
          title: gameInfo.title,
          vndbId: null
        }
      ])
    }, game)

    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler('vndb.matchGames')
      ipcMain.removeHandler('vndb.syncGameMatches')

      ipcMain.handle(
        'vndb.matchGames',
        (_event, games: VndbGameMatchTarget[]) =>
          games.map((target) => ({
            game: target,
            result: {
              id: 'v910001',
              title: 'Wrong Automatic Result',
              source: 'visualNovel',
              developers: [],
              languages: [],
              platforms: [],
              relations: []
            } satisfies VndbSearchResult
          }))
      )
      ipcMain.handle(
        'vndb.syncGameMatches',
        (_event, updates: VndbGameMatchUpdate[]) => {
          ;(
            globalThis as { vndbSyncUpdates?: VndbGameMatchUpdate[] }
          ).vndbSyncUpdates = updates
          return {}
        }
      )
    })

    await page.getByRole('button', { name: 'VNDB', exact: true }).click()

    const row = page.locator('.vndbSyncRow', { hasText: game.title })
    await expect(page.getByText(suggestedResult.title)).not.toBeVisible()
    await expect(row.getByText('Search VNDB')).toBeVisible()

    await page.getByRole('button', { name: 'Confirm' }).click()

    const updates = await app.evaluate(
      () =>
        (globalThis as { vndbSyncUpdates?: VndbGameMatchUpdate[] })
          .vndbSyncUpdates
    )
    const update = updates?.find((item) => item.appName === game.app_name)
    expect(update?.vndbId).toBeNull()
  }
)
