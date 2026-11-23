import type { TFunction } from 'i18next'

import type { HeroicBackupStageId } from 'common/types/importExport'

export function stageLabels(
  t: TFunction<'translation'>
): Record<HeroicBackupStageId, string> {
  return {
    globalSettings: t('import-export.stage.globalSettings', 'Global settings'),
    perGameSettings: t(
      'import-export.stage.perGameSettings',
      'Per-game settings'
    ),
    playtime: t('import-export.stage.playtime', 'Playtime and play history'),
    credentials: t('import-export.stage.credentials', 'Store logins'),
    libraryCache: t(
      'import-export.stage.libraryCache',
      'Installed games and library'
    ),
    sideloadLibrary: t(
      'import-export.stage.sideloadLibrary',
      'Sideloaded games'
    ),
    wineMetadata: t(
      'import-export.stage.wineMetadata',
      'Wine / Proton versions'
    ),
    categories: t('import-export.stage.categories', 'Custom categories'),
    categoryOrder: t(
      'import-export.stage.categoryOrder',
      'Custom category order'
    ),
    vndbMatches: t('import-export.stage.vndbMatches', 'VNDB matches'),
    gameOverrides: t(
      'import-export.stage.gameOverrides',
      'Game metadata overrides'
    ),
    secrets: t(
      'import-export.stage.secrets',
      'API keys and tokens (stored unencrypted)'
    )
  }
}

export const ALL_STAGES: HeroicBackupStageId[] = [
  'globalSettings',
  'perGameSettings',
  'playtime',
  'credentials',
  'libraryCache',
  'sideloadLibrary',
  'wineMetadata',
  'categories',
  'categoryOrder',
  'vndbMatches',
  'gameOverrides',
  'secrets'
]

/** Stages that only exist in this fork; shown as optional extras on import. */
export const EXTRA_STAGES: HeroicBackupStageId[] = [
  'vndbMatches',
  'gameOverrides',
  'categoryOrder',
  'secrets'
]

/** Secrets are written unencrypted, so they are opt-in on export and import. */
export const DEFAULT_EXPORT_STAGES: HeroicBackupStageId[] = ALL_STAGES.filter(
  (stage) => stage !== 'secrets'
)
export const DEFAULT_IMPORT_EXTRAS: HeroicBackupStageId[] = EXTRA_STAGES.filter(
  (stage) => stage !== 'secrets'
)

export function timestampedBackupName(now = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  const y = now.getFullYear()
  const m = pad(now.getMonth() + 1)
  const d = pad(now.getDate())
  const hh = pad(now.getHours())
  const mm = pad(now.getMinutes())
  const ss = pad(now.getSeconds())
  return `heroic-backup-${y}-${m}-${d}_${hh}-${mm}-${ss}.zip`
}
