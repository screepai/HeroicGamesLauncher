import type { GameInfo } from 'common/types'
import type { VndbGameMatch, VndbUserOptions } from 'common/types/vndb'
import {
  getVndbCategoryLabelSyncPlan,
  getVndbCategorySyncPlan,
  getVndbMatchVisualNovelId
} from 'common/vndbCategorySync'
import ContextProvider from 'frontend/state/ContextProvider'
import { useCallback, useContext } from 'react'
import { useTranslation } from 'react-i18next'
import useAppSetting from './useAppSetting'

interface CategoryLabelSyncCandidate {
  game: GameInfo
  gameId: string
  vnId: string
  nextLabelIds: number[]
  previousCategory: string | undefined
}

function getMatchKey(game: GameInfo): string {
  return `${game.runner}:${game.app_name}`
}

function getDisplayTitle(game: GameInfo): string {
  return game.overrides?.title || game.title
}

export default function useVndbCategoryLabelSync() {
  const { t } = useTranslation()
  const { customCategories, showDialogModal } = useContext(ContextProvider)
  const enableVndbIntegration = useAppSetting('enableVndbIntegration', true)
  const mode = useAppSetting('vndbCategoryLabelSyncMode', 'ask')

  const requestCategoryLabelSync = useCallback(
    async (games: GameInfo[], category: string, assigned: boolean) => {
      if (!enableVndbIntegration || mode === 'disabled' || games.length === 0) {
        return
      }

      let matches: Record<string, VndbGameMatch>
      try {
        if (!(await window.api.vndb.hasApiToken())) {
          return
        }
        matches = await window.api.vndb.getAllGameMatches()
      } catch {
        return
      }
      const preparationResults = await Promise.allSettled(
        games.map(async (game): Promise<CategoryLabelSyncCandidate | null> => {
          const match: VndbGameMatch | undefined = matches[getMatchKey(game)]
          if (!match) {
            return null
          }

          const vnId = getVndbMatchVisualNovelId(match)
          if (!vnId) {
            return null
          }

          const options: VndbUserOptions = await window.api.vndb.getUserOptions(
            { vnId }
          )
          if (!options.canRead || !options.canWrite) {
            return null
          }

          const plan = getVndbCategoryLabelSyncPlan({
            labels: options.labels,
            selectedLabelIds: options.selectedLabelIds,
            category,
            assigned
          })
          if (!plan) {
            return null
          }

          const gameId = `${game.app_name}_${game.runner}`
          const categoryMove = assigned
            ? getVndbCategorySyncPlan({
                categories: customCategories.listCategories(),
                categoryGames: customCategories.list,
                gameId,
                previousLabel: plan.previousLabel?.label,
                nextLabel: category
              })
            : null

          return {
            game,
            gameId,
            vnId,
            nextLabelIds: plan.nextLabelIds,
            previousCategory: categoryMove?.fromCategory
          }
        })
      )
      const candidates = preparationResults.flatMap((result) =>
        result.status === 'fulfilled' && result.value ? [result.value] : []
      )
      if (candidates.length === 0) {
        return
      }

      const skippedCount = games.length - candidates.length
      const isSingleGame = games.length === 1
      const message = isSingleGame
        ? assigned
          ? t(
              'category-settings.vndb-sync.add',
              'Set the VNDB label for "{{title}}" to "{{category}}"?',
              {
                title: getDisplayTitle(candidates[0].game),
                category
              }
            )
          : t(
              'category-settings.vndb-sync.remove',
              'Clear the VNDB label "{{category}}" from "{{title}}"?',
              {
                title: getDisplayTitle(candidates[0].game),
                category
              }
            )
        : t(
            assigned
              ? 'categories-manager.vndb-sync.add'
              : 'categories-manager.vndb-sync.remove',
            assigned
              ? 'Set the VNDB label to "{{category}}" for {{count}} games? {{skipped}} unmatched, unavailable, or already-correct games will be skipped.'
              : 'Clear the VNDB label "{{category}}" from {{count}} games? {{skipped}} unmatched, unavailable, or already-correct games will be skipped.',
            {
              category,
              count: candidates.length,
              skipped: skippedCount
            }
          )

      const applyUpdates = async () => {
        const updateResults = await Promise.allSettled(
          candidates.map(async (candidate) => {
            await window.api.vndb.updateUserOptions({
              vnId: candidate.vnId,
              update: { labels: candidate.nextLabelIds }
            })
          })
        )
        if (assigned) {
          const categoryMoves = updateResults.flatMap((result, index) => {
            const candidate = candidates[index]
            return result.status === 'fulfilled' && candidate.previousCategory
              ? [
                  {
                    fromCategory: candidate.previousCategory,
                    toCategory: category,
                    appName: candidate.gameId
                  }
                ]
              : []
          })
          if (categoryMoves.length > 0) {
            customCategories.moveGames(categoryMoves)
          }
        }
        const failedGames = updateResults.flatMap((result, index) =>
          result.status === 'rejected'
            ? [getDisplayTitle(candidates[index].game)]
            : []
        )
        if (failedGames.length === 0) {
          return
        }

        showDialogModal({
          type: 'ERROR',
          title: t(
            'categories-manager.vndb-sync.failed-title',
            'Some VNDB labels could not be updated'
          ),
          message: t(
            'categories-manager.vndb-sync.failed',
            '{{failed}} of {{count}} VNDB updates failed: {{games}}',
            {
              failed: failedGames.length,
              count: candidates.length,
              games: failedGames.join(', ')
            }
          )
        })
      }

      showDialogModal({
        title: t('categories-manager.vndb-sync.title', 'Update VNDB labels?'),
        message,
        buttons: [
          { text: t('box.no', 'No') },
          {
            text: t('box.yes', 'Yes'),
            onClick: () => void applyUpdates()
          }
        ]
      })
    },
    [customCategories, enableVndbIntegration, mode, showDialogModal, t]
  )

  return requestCategoryLabelSync
}
