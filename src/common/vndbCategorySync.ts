import type { VndbGameMatch, VndbUserLabel } from 'common/types/vndb'

export interface VndbCategorySyncPlan {
  fromCategory?: string
  toCategory?: string
}

export interface VndbCategoryLabelSyncPlan {
  label: VndbUserLabel
  nextLabelIds: number[]
  previousLabel?: VndbUserLabel
}

const editableLabelDenylist = new Set([0, 7])
const statusLabelIds = new Set([1, 2, 3, 4])
const statusLabelPriority = [1, 2, 3, 4]

function normalizeName(value: string | undefined): string {
  return value?.trim().toLocaleLowerCase() ?? ''
}

function findMatchingCategory(
  categories: string[],
  label: string | undefined
): string | undefined {
  const normalizedLabel = normalizeName(label)
  if (!normalizedLabel) {
    return undefined
  }

  return categories.find(
    (category) => normalizeName(category) === normalizedLabel
  )
}

export function getPrimaryVndbLabel(
  labels: VndbUserLabel[],
  selectedLabelIds: number[]
): VndbUserLabel | undefined {
  const selectedIds = new Set(selectedLabelIds)
  const statusLabelId = statusLabelPriority.find((id) => selectedIds.has(id))
  const statusLabel = labels.find((label) => label.id === statusLabelId)

  return (
    statusLabel ??
    labels.find(
      (label) =>
        !editableLabelDenylist.has(label.id) && selectedIds.has(label.id)
    )
  )
}

export function getNextVndbLabelIds({
  selectedLabelIds,
  labelId,
  selected
}: {
  selectedLabelIds: number[]
  labelId: number
  selected: boolean
}): number[] {
  const nextLabelIds = selected
    ? statusLabelIds.has(labelId)
      ? selectedLabelIds.filter((id) => !statusLabelIds.has(id))
      : [...selectedLabelIds]
    : selectedLabelIds.filter((id) => id !== labelId)

  if (selected && !nextLabelIds.includes(labelId)) {
    nextLabelIds.push(labelId)
  }

  return [...new Set(nextLabelIds)].sort((left, right) => left - right)
}

export function getVndbCategorySyncPlan({
  categories,
  categoryGames,
  gameId,
  previousLabel,
  nextLabel
}: {
  categories: string[]
  categoryGames: Record<string, string[]>
  gameId: string
  previousLabel?: string
  nextLabel?: string
}): VndbCategorySyncPlan | null {
  if (normalizeName(previousLabel) === normalizeName(nextLabel)) {
    return null
  }

  const previousCategory = findMatchingCategory(categories, previousLabel)
  const nextCategory = findMatchingCategory(categories, nextLabel)
  const fromCategory =
    previousCategory && categoryGames[previousCategory]?.includes(gameId)
      ? previousCategory
      : undefined
  const toCategory =
    nextCategory && !categoryGames[nextCategory]?.includes(gameId)
      ? nextCategory
      : undefined

  if (!fromCategory && !toCategory) {
    return null
  }

  return {
    ...(fromCategory ? { fromCategory } : {}),
    ...(toCategory ? { toCategory } : {})
  }
}

export function getVndbCategoryLabelSyncPlan({
  labels,
  selectedLabelIds,
  category,
  assigned
}: {
  labels: VndbUserLabel[]
  selectedLabelIds: number[]
  category: string
  assigned: boolean
}): VndbCategoryLabelSyncPlan | null {
  const normalizedCategory = normalizeName(category)
  const label = labels.find(
    (candidate) =>
      !editableLabelDenylist.has(candidate.id) &&
      normalizeName(candidate.label) === normalizedCategory
  )
  if (!label) {
    return null
  }

  const previousLabel = statusLabelIds.has(label.id)
    ? getPrimaryVndbLabel(labels, selectedLabelIds)
    : undefined

  if (assigned) {
    if (selectedLabelIds.includes(label.id)) {
      return null
    }

    return {
      label,
      nextLabelIds: getNextVndbLabelIds({
        selectedLabelIds,
        labelId: label.id,
        selected: true
      }),
      ...(previousLabel ? { previousLabel } : {})
    }
  }

  if (!selectedLabelIds.includes(label.id)) {
    return null
  }

  return {
    label,
    nextLabelIds: selectedLabelIds.filter((id) => id !== label.id),
    ...(previousLabel ? { previousLabel } : {})
  }
}

export function getVndbMatchVisualNovelId(
  match: VndbGameMatch
): string | undefined {
  if (match.source !== 'release') {
    return match.vndbId.startsWith('v') ? match.vndbId : undefined
  }

  return (
    match.mainVndbId ??
    match.mainRelation?.id ??
    match.latestRelease?.vns[0]?.id ??
    match.releaseVns?.[0]?.id ??
    (match.vndbId.startsWith('v') ? match.vndbId : undefined)
  )
}
