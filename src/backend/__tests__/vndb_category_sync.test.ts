import {
  getNextVndbLabelIds,
  getPrimaryVndbLabel,
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
    { id: 5, label: 'Wishlist' },
    { id: 10, label: 'Custom' },
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

  it('preserves non-status labels when a status category is assigned', () => {
    expect(
      getVndbCategoryLabelSyncPlan({
        labels,
        selectedLabelIds: [1, 5, 10],
        category: 'Finished',
        assigned: true
      })
    ).toEqual({
      label: labels[1],
      nextLabelIds: [2, 5, 10],
      previousLabel: labels[0]
    })
  })

  it('adds an independent label without replacing the status category', () => {
    expect(
      getVndbCategoryLabelSyncPlan({
        labels,
        selectedLabelIds: [1],
        category: 'Wishlist',
        assigned: true
      })
    ).toEqual({
      label: labels[2],
      nextLabelIds: [1, 5]
    })
  })

  it('does nothing when the matching label is already selected', () => {
    expect(
      getVndbCategoryLabelSyncPlan({
        labels,
        selectedLabelIds: [2, 5],
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

describe('VNDB multi-label selection', () => {
  const labels = [
    { id: 5, label: 'Wishlist' },
    { id: 1, label: 'Playing' },
    { id: 10, label: 'Custom' }
  ]

  it('uses the status label when Wishlist and Playing are both selected', () => {
    expect(getPrimaryVndbLabel(labels, [5, 1])).toEqual(labels[1])
  })

  it('switches status without removing Wishlist or custom labels', () => {
    expect(
      getNextVndbLabelIds({
        selectedLabelIds: [1, 5, 10],
        labelId: 3,
        selected: true
      })
    ).toEqual([3, 5, 10])
  })

  it('adds and removes independent labels without changing the status', () => {
    expect(
      getNextVndbLabelIds({
        selectedLabelIds: [1, 5],
        labelId: 10,
        selected: true
      })
    ).toEqual([1, 5, 10])
    expect(
      getNextVndbLabelIds({
        selectedLabelIds: [1, 5, 10],
        labelId: 5,
        selected: false
      })
    ).toEqual([1, 10])
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
