import {
  getVndbCategoryLabelSyncPlan,
  getVndbCategorySyncPlan,
  getVndbMatchVisualNovelId
} from 'common/vndbCategorySync'

describe('getVndbCategorySyncPlan', () => {
  const gameId = 'game_sideload'
  const categories = ['Playing', 'Finished']

  it('moves a game between matching label categories', () => {
    expect(
      getVndbCategorySyncPlan({
        categories,
        categoryGames: { Playing: [gameId], Finished: [] },
        gameId,
        previousLabel: 'Playing',
        nextLabel: 'Finished'
      })
    ).toEqual({
      fromCategory: 'Playing',
      toCategory: 'Finished'
    })
  })

  it('removes the previous category when the label is cleared', () => {
    expect(
      getVndbCategorySyncPlan({
        categories,
        categoryGames: { Playing: [gameId], Finished: [] },
        gameId,
        previousLabel: 'Playing'
      })
    ).toEqual({ fromCategory: 'Playing' })
  })

  it('matches category names case-insensitively', () => {
    expect(
      getVndbCategorySyncPlan({
        categories,
        categoryGames: { Playing: [], Finished: [] },
        gameId,
        nextLabel: 'playing'
      })
    ).toEqual({ toCategory: 'Playing' })
  })

  it('does nothing when no category membership needs to change', () => {
    expect(
      getVndbCategorySyncPlan({
        categories,
        categoryGames: { Playing: [gameId], Finished: [] },
        gameId,
        previousLabel: 'Playing',
        nextLabel: 'Playing'
      })
    ).toBeNull()
  })
})

describe('getVndbCategoryLabelSyncPlan', () => {
  const labels = [
    { id: 1, label: 'Playing' },
    { id: 2, label: 'Finished' },
    { id: 7, label: 'Voted' }
  ]

  it('sets the matching label when a category is assigned', () => {
    expect(
      getVndbCategoryLabelSyncPlan({
        labels,
        selectedLabelIds: [1],
        category: 'finished',
        assigned: true
      })
    ).toEqual({
      label: labels[1],
      nextLabelIds: [2],
      previousLabel: labels[0]
    })
  })

  it('does nothing when the matching label is already selected', () => {
    expect(
      getVndbCategoryLabelSyncPlan({
        labels,
        selectedLabelIds: [2],
        category: 'Finished',
        assigned: true
      })
    ).toBeNull()
  })

  it('only removes the matching label when a category is unassigned', () => {
    expect(
      getVndbCategoryLabelSyncPlan({
        labels,
        selectedLabelIds: [2, 99],
        category: 'Finished',
        assigned: false
      })
    ).toEqual({
      label: labels[1],
      nextLabelIds: [99],
      previousLabel: labels[1]
    })
  })

  it('ignores categories matching non-editable labels', () => {
    expect(
      getVndbCategoryLabelSyncPlan({
        labels,
        selectedLabelIds: [],
        category: 'Voted',
        assigned: true
      })
    ).toBeNull()
  })
})

describe('getVndbMatchVisualNovelId', () => {
  it('uses the main visual novel for release matches', () => {
    expect(
      getVndbMatchVisualNovelId({
        appName: 'game',
        runner: 'sideload',
        title: 'Game',
        vndbId: 'r1',
        vndbTitle: 'Game',
        mainVndbId: 'v1',
        source: 'release',
        syncedAt: '2026-06-16'
      })
    ).toBe('v1')
  })
})
