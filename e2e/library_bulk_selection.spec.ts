import { expect, test } from '@playwright/test'
import type { GameInfo } from '../src/common/types'
import { electronTest } from './helpers'

declare const window: { api: typeof import('../src/preload/api').default }

const createSideloadGame = (appName: string, title: string): GameInfo => ({
  app_name: appName,
  runner: 'sideload',
  title,
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
})

electronTest('bulk-selects library games', async (_app, page) => {
  await page.evaluate(
    ([firstGame, secondGame]) => {
      window.api.addNewApp(firstGame)
      window.api.addNewApp(secondGame)
    },
    [
      createSideloadGame('bulk-selection-one', 'Bulk Selection One'),
      createSideloadGame('bulk-selection-two', 'Bulk Selection Two')
    ]
  )

  const firstCard = page.locator(
    '.gameCard[data-app-name="bulk-selection-one"]:not([data-invisible])'
  )
  const secondCard = page.locator(
    '.gameCard[data-app-name="bulk-selection-two"]:not([data-invisible])'
  )

  await expect(firstCard).toBeVisible()
  await expect(secondCard).toBeVisible()

  await test.step('hold enters selection mode', async () => {
    const box = await firstCard.boundingBox()
    if (!box) {
      throw new Error('First game card has no bounding box')
    }

    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2)
    await page.mouse.down()
    await page.waitForTimeout(550)
    await page.mouse.up()

    await expect(page.getByText('1 selected')).toBeVisible()
    await expect(firstCard).toHaveAttribute('aria-selected', 'true')
  })

  await test.step('click selects another card', async () => {
    await secondCard.click()
    await expect(page.getByText('2 selected')).toBeVisible()
    await expect(secondCard).toHaveAttribute('aria-selected', 'true')
    await expect(
      page
        .locator('.libraryBulkSelection')
        .getByRole('button', { name: 'VNDB' })
    ).toBeVisible()
  })

  await test.step('bulk category applies to every selected game', async () => {
    await page
      .locator('.libraryBulkSelection')
      .getByRole('button', { name: 'Categories' })
      .click()
    const dialog = page.getByRole('dialog')

    await expect(dialog.getByText('Categorize 2 games')).toBeVisible()
    await dialog.getByPlaceholder('Add new category').fill('Bulk category')
    await dialog.getByTitle('Add', { exact: true }).click()

    const category = dialog.getByRole('button', {
      name: /Bulk category 2\/2/
    })
    await expect(category).toHaveAttribute('aria-pressed', 'true')
    await dialog.getByRole('button', { name: 'close' }).click()
  })

  await test.step('Escape exits selection mode', async () => {
    await page.keyboard.press('Escape')
    await expect(page.getByText('2 selected')).not.toBeVisible()
    await expect(firstCard).not.toHaveAttribute('aria-selected', 'true')
    await expect(secondCard).not.toHaveAttribute('aria-selected', 'true')
  })
})
