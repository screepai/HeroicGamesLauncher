import { expect, test } from '@playwright/test'
import type { GameInfo } from '../src/common/types'
import type { VndbGameMatchUpdate, VndbRelease } from '../src/common/types/vndb'
import { electronTest } from './helpers'

declare const window: { api: typeof import('../src/preload/api').default }

const game: GameInfo = {
  app_name: 'vndb-release-selection',
  runner: 'sideload',
  title: 'VNDB Release Selection',
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

const releases: VndbRelease[] = [
  {
    id: 'r900001',
    title: 'Release One',
    released: '2025-01-01',
    languages: ['en'],
    platforms: ['win'],
    vns: [
      {
        id: 'v900001',
        title: game.title,
        rtype: 'complete',
        relations: []
      }
    ]
  },
  {
    id: 'r900002',
    title: 'Release Two',
    released: '2026-01-01',
    languages: ['en'],
    platforms: ['win'],
    vns: [
      {
        id: 'v900001',
        title: game.title,
        rtype: 'complete',
        relations: []
      }
    ]
  }
]

const match: VndbGameMatchUpdate = {
  appName: game.app_name,
  runner: game.runner,
  title: game.title,
  vndbId: 'v900001',
  vndbTitle: game.title,
  source: 'visualNovel',
  released: '2025-01-01',
  rating: null,
  lengthMinutes: null,
  description: null,
  tags: [],
  developers: [],
  languages: ['en'],
  relations: [],
  latestRelease: releases[0],
  selectedReleases: [releases[0]],
  releases,
  releaseVns: releases[0].vns
}

electronTest('toggles multiple VNDB releases', async (_app, page) => {
  await test.step('seed game and VNDB match', async () => {
    await page.evaluate(
      async ([gameInfo, matchUpdate]) => {
        window.api.addNewApp(gameInfo)
        await window.api.vndb.syncGameMatches([matchUpdate])
      },
      [game, match] as const
    )
  })

  await test.step('open VNDB tab', async () => {
    await page
      .locator(
        '.gameCard[data-app-name="vndb-release-selection"]:not([data-invisible])'
      )
      .click()
    await page.getByRole('tab', { name: 'VNDB' }).click()
  })

  const releaseOne = page.locator('.vndbInfoReleaseOption', {
    hasText: 'Release One'
  })
  const releaseTwo = page.locator('.vndbInfoReleaseOption', {
    hasText: 'Release Two'
  })

  await test.step('toggle release membership', async () => {
    await expect(releaseOne).toHaveAttribute('aria-pressed', 'true')
    await expect(releaseTwo).toHaveAttribute('aria-pressed', 'false')

    await releaseTwo.click()
    await expect(releaseOne).toHaveAttribute('aria-pressed', 'true')
    await expect(releaseTwo).toHaveAttribute('aria-pressed', 'true')

    await releaseOne.click()
    await expect(releaseOne).toHaveAttribute('aria-pressed', 'false')
    await expect(releaseTwo).toHaveAttribute('aria-pressed', 'true')

    await releaseTwo.click()
    await expect(releaseOne).toHaveAttribute('aria-pressed', 'false')
    await expect(releaseTwo).toHaveAttribute('aria-pressed', 'false')
    await expect(
      page.getByRole('heading', { name: 'Downloaded release selector' })
    ).toBeVisible()
  })
})
