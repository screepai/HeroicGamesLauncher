/**
 * Fork-only backup stages and apply-time hooks.
 *
 * Kept out of the upstream-owned export.ts / apply.ts so those files only need
 * a few additive hook calls (they get merged from upstream regularly).
 *
 * Stages: `vndbMatches`, `gameOverrides`, `categoryOrder`, `secrets`.
 * Hooks:
 *  - `stripSecretsFromGlobalConfig`: the raw global config copy must not carry
 *    the safeStorage-encrypted tokens (they only decrypt on the machine that
 *    wrote them).
 *  - `captureForkLocalState` + the reconcile pass in `applyForkStages`: keep
 *    this machine's tokens when the raw config is restored, and keep this
 *    machine's value for path-typed settings that use another OS path style.
 */
import type AdmZip from 'adm-zip'
import { chmodSync, existsSync, readFileSync, writeFileSync } from 'graceful-fs'
import { join } from 'path'

import { GlobalConfig } from 'backend/config'
import { configStore } from 'backend/constants/key_value_stores'
import { sendFrontendMessage } from 'backend/ipc'
import { logWarning, LogPrefix } from 'backend/logger'
import { decryptApiKey } from 'backend/steamgrid/secureKey'
import {
  GAME_PATH_SETTINGS,
  resolveGameSettingsPaths,
  resolveRestoredPath
} from 'backend/storeManagers/sideload/pathStyle'
import { decryptSecret } from 'backend/utils/secureSecret'
import type { AppSettings, GameSettings } from 'common/types'
import type {
  HeroicApplyOptions,
  HeroicApplyStageResult,
  HeroicBackupManifest,
  HeroicBackupStageId,
  HeroicExportOptions
} from 'common/types/importExport'
import type { VndbGameMatch } from 'common/types/vndb'

import { BACKUP_PATHS } from './constants'
import { sourcePaths } from './paths'

export const FORK_BACKUP_PATHS = {
  vndbMatches: 'vndb/matches.json',
  gameOverrides: 'gameOverrides/overrides.json',
  categoryOrder: 'categories/customCategoriesOrder.json',
  secrets: 'secrets/secrets.json'
} as const

/** Stage ids this module owns (the wizard shows them as optional extras). */
export const FORK_STAGE_IDS: readonly HeroicBackupStageId[] = [
  'vndbMatches',
  'gameOverrides',
  'categoryOrder',
  'secrets'
]

/** Settings stored encrypted with this machine's safeStorage. */
const SECRET_SETTING_KEYS = ['vndbApiToken', 'steamGridDbApiKey'] as const

/** Global settings that hold a filesystem path. */
const GLOBAL_PATH_SETTINGS = [
  'altAureliaBin',
  'altButlerBin',
  'altCometBin',
  'altGogdlBin',
  'altLegendaryBin',
  'altNileBin',
  'customThemesPath',
  'defaultInstallPath',
  'defaultSteamPath',
  'defaultWinePrefix',
  'defaultWinePrefixDir',
  'egsLinkedPath',
  'localeEmulatorPath',
  'localLibrarySyncPath',
  'migrationArchivePath',
  'sharedWinePrefix'
] as const

type Obj = Record<string, unknown>

/**
 * `plain`: written by a user export, values are decrypted.
 * `device`: written into a rollback snapshot, values are the raw
 * safeStorage-encrypted strings and only valid on this machine.
 */
interface SecretsFile {
  format: 'plain' | 'device'
  vndbApiToken?: string
  steamGridDbApiKey?: string
}

function isRecord(value: unknown): value is Obj {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readJsonEntry(zip: AdmZip, entryPath: string): unknown {
  const entry = zip.getEntry(entryPath)
  if (!entry) return undefined
  try {
    return JSON.parse(entry.getData().toString('utf-8'))
  } catch {
    return undefined
  }
}

function addJson(zip: AdmZip, entryPath: string, data: unknown): void {
  zip.addFile(entryPath, Buffer.from(JSON.stringify(data, null, 2), 'utf-8'))
}

function clone<T>(value: T): T {
  return value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T)
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b)
}

function readLocalSettings(): Obj {
  try {
    return clone(GlobalConfig.get().getSettings() as unknown as Obj) ?? {}
  } catch {
    return {}
  }
}

/* ------------------------------------------------------------------ */
/* Export                                                              */
/* ------------------------------------------------------------------ */

/**
 * The raw config copy of the globalSettings stage must not contain the
 * encrypted tokens: they are not portable. Tokens travel in the opt-in
 * `secrets` stage instead.
 */
export function stripSecretsFromGlobalConfig(zip: AdmZip): void {
  const entryName = BACKUP_PATHS.globalSettings.config
  const parsed = readJsonEntry(zip, entryName)
  if (!isRecord(parsed)) return

  let changed = false
  const targets = [parsed, parsed['defaultSettings']]
  for (const target of targets) {
    if (!isRecord(target)) continue
    for (const key of SECRET_SETTING_KEYS) {
      if (key in target) {
        delete target[key]
        changed = true
      }
    }
  }
  if (changed) {
    zip.updateFile(entryName, Buffer.from(JSON.stringify(parsed, null, 2)))
  }
}

async function readSecrets(forSnapshot: boolean): Promise<SecretsFile> {
  if (forSnapshot) {
    const settings = readLocalSettings()
    const raw = (key: (typeof SECRET_SETTING_KEYS)[number]) =>
      typeof settings[key] === 'string' ? settings[key] : ''
    return {
      format: 'device',
      vndbApiToken: raw('vndbApiToken'),
      steamGridDbApiKey: raw('steamGridDbApiKey')
    }
  }

  const { getSteamGridDbApiKey } =
    await import('backend/storeManagers/sideload/metadataBackup')
  const { getDecryptedApiToken } = await import('backend/vndb/client')
  const secrets: SecretsFile = { format: 'plain' }
  const vndbApiToken = getDecryptedApiToken()
  const steamGridDbApiKey = getSteamGridDbApiKey()
  if (vndbApiToken) secrets.vndbApiToken = vndbApiToken
  if (steamGridDbApiKey) secrets.steamGridDbApiKey = steamGridDbApiKey
  return secrets
}

/** Adds the fork stages' entries to the archive and fills the manifest counts. */
export async function exportForkStages(
  zip: AdmZip,
  options: HeroicExportOptions,
  manifest: HeroicBackupManifest
): Promise<void> {
  const { stages } = options
  stripSecretsFromGlobalConfig(zip)

  if (stages.includes('vndbMatches')) {
    const { getAllVndbMatches } =
      await import('backend/storeManagers/sideload/metadataBackup')
    const matches = getAllVndbMatches()
    addJson(zip, FORK_BACKUP_PATHS.vndbMatches, matches)
    manifest.counts.vndbMatches = Object.keys(matches).length
  }

  if (stages.includes('gameOverrides')) {
    const { getAllGameOverrides } = await import('backend/game_overrides')
    const overrides = getAllGameOverrides()
    addJson(zip, FORK_BACKUP_PATHS.gameOverrides, overrides)
    manifest.counts.gameOverrides = Object.keys(overrides).length
  }

  if (stages.includes('categoryOrder')) {
    const order = configStore.get('games.customCategoriesOrder', [])
    addJson(zip, FORK_BACKUP_PATHS.categoryOrder, order)
    manifest.counts.categoryOrder = order.length
  }

  if (stages.includes('secrets')) {
    addJson(
      zip,
      FORK_BACKUP_PATHS.secrets,
      await readSecrets(!!options.forSnapshot)
    )
  }
}

/** Archives holding secrets must not be readable by other local users. */
export function finishForkExport(
  outputPath: string,
  options: HeroicExportOptions
): void {
  if (!options.stages.includes('secrets')) return
  try {
    chmodSync(outputPath, 0o600)
  } catch (error) {
    logWarning(
      ['Could not restrict permissions of the backup file:', error],
      LogPrefix.ImportExport
    )
  }
}

/* ------------------------------------------------------------------ */
/* Apply                                                               */
/* ------------------------------------------------------------------ */

export interface ForkLocalState {
  /** This machine's settings before the upstream stages ran. */
  settings: Obj
  /** This machine's per-game settings blocks (by appName) before apply. */
  perGame: Map<string, Obj | undefined>
}

function perGameFileName(entryName: string): string | undefined {
  const prefix = BACKUP_PATHS.perGameSettings.dir
  if (!entryName.startsWith(prefix)) return undefined
  const rel = entryName.slice(prefix.length)
  if (!rel.endsWith('.json') || rel.includes('/') || rel.includes('\\')) {
    return undefined
  }
  return rel.slice(0, -'.json'.length)
}

function readLocalGameBlock(appName: string): Obj | undefined {
  const file = join(sourcePaths.gamesConfigDir(), `${appName}.json`)
  try {
    if (!existsSync(file)) return undefined
    const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'))
    return isRecord(parsed) && isRecord(parsed[appName])
      ? parsed[appName]
      : undefined
  } catch {
    return undefined
  }
}

/** Call before the upstream stages run. */
export function captureForkLocalState(
  zip: AdmZip,
  options: HeroicApplyOptions
): ForkLocalState {
  const perGame = new Map<string, Obj | undefined>()
  if (options.stages.includes('perGameSettings')) {
    for (const entry of zip.getEntries()) {
      const appName = perGameFileName(entry.entryName)
      if (!appName || entry.isDirectory) continue
      perGame.set(appName, clone(readLocalGameBlock(appName)))
    }
  }
  return { settings: readLocalSettings(), perGame }
}

function setLocalSetting(key: string, value: unknown): void {
  GlobalConfig.get().setSetting(key as keyof AppSettings, value)
}

/** Puts back this machine's tokens after the raw config was overwritten. */
function restoreLocalSecrets(local: ForkLocalState): void {
  const current = readLocalSettings()
  for (const key of SECRET_SETTING_KEYS) {
    const before = local.settings[key]
    if (before === undefined || current[key] === before) continue
    setLocalSetting(key, before)
  }
}

/**
 * Keeps this machine's value for path settings that the restored config set to
 * a path of another OS style (e.g. `C:\Games` restored on Linux). Upstream
 * writes those raw; this only reverts the ones that cannot work here.
 */
function keepLocalForeignGlobalPaths(local: ForkLocalState): string[] {
  const kept: string[] = []
  const current = readLocalSettings()

  const revert = (key: string) => {
    const before = local.settings[key]
    if (before === undefined || sameJson(before, current[key])) return
    setLocalSetting(key, before)
    kept.push(key)
  }

  for (const key of GLOBAL_PATH_SETTINGS) {
    const value = current[key]
    if (typeof value !== 'string' || sameJson(value, local.settings[key])) {
      continue
    }
    if (resolveRestoredPath(value, undefined) === undefined) revert(key)
  }

  const customWinePaths = current['customWinePaths']
  if (
    Array.isArray(customWinePaths) &&
    !sameJson(customWinePaths, local.settings['customWinePaths'])
  ) {
    const usable = customWinePaths.filter(
      (path): path is string =>
        typeof path === 'string' &&
        resolveRestoredPath(path, undefined) !== undefined
    )
    if (usable.length !== customWinePaths.length) {
      setLocalSetting('customWinePaths', usable)
      kept.push('customWinePaths')
    }
  }

  const resolved = resolveGameSettingsPaths(
    current as Partial<GameSettings>,
    local.settings as Partial<GameSettings>,
    undefined
  ) as Obj
  for (const key of [...GAME_PATH_SETTINGS, 'wineVersion']) {
    if (!(key in current) || sameJson(resolved[key], current[key])) continue
    revert(key)
  }

  return kept
}

/** Same rule for the per-game settings files upstream just wrote. */
function keepLocalForeignGamePaths(
  options: HeroicApplyOptions,
  local: ForkLocalState
): string[] {
  const fixed: string[] = []
  for (const [appName, localBlock] of local.perGame) {
    if (
      options.includedAppNames.length > 0 &&
      !options.includedAppNames.includes(appName)
    ) {
      continue
    }
    const file = join(sourcePaths.gamesConfigDir(), `${appName}.json`)
    try {
      if (!existsSync(file)) continue
      const parsed: unknown = JSON.parse(readFileSync(file, 'utf-8'))
      if (!isRecord(parsed) || !isRecord(parsed[appName])) continue
      const resolved = resolveGameSettingsPaths(
        parsed[appName] as Partial<GameSettings>,
        localBlock as Partial<GameSettings> | undefined,
        undefined
      )
      if (sameJson(resolved, parsed[appName])) continue
      writeFileSync(
        file,
        JSON.stringify({ ...parsed, [appName]: resolved }, null, 2)
      )
      fixed.push(appName)
    } catch (error) {
      logWarning(
        [`Could not remap paths of ${appName}'s settings:`, error],
        LogPrefix.ImportExport
      )
    }
  }
  return fixed
}

/**
 * Runs after the upstream stages: keeps this machine's tokens, and keeps this
 * machine's value for foreign-OS paths. Rollback restores this machine's own
 * data, so only the token handling applies there.
 */
function reconcileUpstreamApply(
  zip: AdmZip,
  options: HeroicApplyOptions,
  local: ForkLocalState,
  warnings: string[],
  rollbackMode: boolean
): void {
  try {
    if (options.stages.includes('globalSettings')) {
      restoreLocalSecrets(local)
      if (!rollbackMode) {
        const kept = keepLocalForeignGlobalPaths(local)
        if (kept.length > 0) {
          warnings.push(
            `Kept this machine's value for settings that used paths from another operating system: ${kept.join(', ')}.`
          )
        }
      }
    }
    if (options.stages.includes('perGameSettings') && !rollbackMode) {
      const fixed = keepLocalForeignGamePaths(options, local)
      if (fixed.length > 0) {
        warnings.push(
          `Dropped paths from another operating system in the settings of ${fixed.length} game(s).`
        )
      }
    }
  } catch (error) {
    warnings.push(`Could not reconcile restored settings: ${String(error)}`)
  }
}

async function applyVndbMatches(
  zip: AdmZip,
  rollbackMode: boolean
): Promise<HeroicApplyStageResult> {
  const raw = readJsonEntry(zip, FORK_BACKUP_PATHS.vndbMatches)
  if (!isRecord(raw)) {
    return { stage: 'vndbMatches', ok: true, message: 'Not in backup' }
  }

  const { isVndbGameMatch, getAllVndbMatches } =
    await import('backend/storeManagers/sideload/metadataBackup')
  const { vndbMatchesStore } = await import('backend/vndb/electronStore')
  const incoming = Object.fromEntries(
    Object.entries(raw).filter((entry): entry is [string, VndbGameMatch] =>
      isVndbGameMatch(entry[1])
    )
  )
  // Import merges (backup entries win); rollback restores the exact snapshot.
  const next = rollbackMode ? incoming : { ...getAllVndbMatches(), ...incoming }
  vndbMatchesStore.set('matches', next)
  sendFrontendMessage('vndbMatchesChanged', next)
  return {
    stage: 'vndbMatches',
    ok: true,
    message: `${Object.keys(incoming).length} match(es)`
  }
}

type GameOverride = {
  title?: string
  art_cover?: string
  art_square?: string
  isVisualNovel?: boolean
}

function parseOverride(value: unknown): GameOverride | undefined {
  if (!isRecord(value)) return undefined
  const override: GameOverride = {}
  if (typeof value.title === 'string') override.title = value.title
  if (typeof value.isVisualNovel === 'boolean') {
    override.isVisualNovel = value.isVisualNovel
  }
  // Artwork can be a local file path; one from another OS cannot work here.
  for (const key of ['art_cover', 'art_square'] as const) {
    const art = value[key]
    if (typeof art !== 'string' || !art) continue
    if (resolveRestoredPath(art, undefined) !== undefined) override[key] = art
  }
  return Object.keys(override).length > 0 ? override : undefined
}

async function applyGameOverrides(
  zip: AdmZip,
  rollbackMode: boolean
): Promise<HeroicApplyStageResult> {
  const raw = readJsonEntry(zip, FORK_BACKUP_PATHS.gameOverrides)
  if (!isRecord(raw)) {
    return { stage: 'gameOverrides', ok: true, message: 'Not in backup' }
  }

  const { getAllGameOverrides, setGameOverrides } =
    await import('backend/game_overrides')
  const incoming = new Map<string, GameOverride>()
  for (const [appName, value] of Object.entries(raw)) {
    const override = parseOverride(value)
    if (override) incoming.set(appName, override)
  }

  const previous = clone(getAllGameOverrides())
  const touched: string[] = []
  const write = (appName: string, override: GameOverride) => {
    touched.push(appName)
    if (setGameOverrides(appName, override) === false) {
      throw new Error(`Could not save metadata overrides for ${appName}.`)
    }
  }

  try {
    for (const [appName, override] of incoming) write(appName, override)
    if (rollbackMode) {
      for (const appName of Object.keys(previous)) {
        if (!incoming.has(appName)) write(appName, {})
      }
    }
  } catch (error) {
    for (const appName of touched.reverse()) {
      setGameOverrides(appName, previous[appName] ?? {})
    }
    throw error
  }

  sendFrontendMessage('metadataChanged', getAllGameOverrides())
  return {
    stage: 'gameOverrides',
    ok: true,
    message: `${incoming.size} override(s)`
  }
}

function applyCategoryOrder(zip: AdmZip): HeroicApplyStageResult {
  const raw = readJsonEntry(zip, FORK_BACKUP_PATHS.categoryOrder)
  if (!Array.isArray(raw)) {
    return { stage: 'categoryOrder', ok: true, message: 'Not in backup' }
  }

  const categories = configStore.get('games.customCategories', {})
  const currentOrder = configStore.get('games.customCategoriesOrder', [])
  const exists = (name: unknown): name is string =>
    typeof name === 'string' && name in categories
  // Backup order first, then whatever else is present locally.
  const order = [
    ...new Set([
      ...raw.filter(exists),
      ...currentOrder.filter(exists),
      ...Object.keys(categories)
    ])
  ]
  configStore.set('games.customCategoriesOrder', order)
  return {
    stage: 'categoryOrder',
    ok: true,
    message: `${order.length} categor(ies) ordered`
  }
}

async function applySecrets(zip: AdmZip): Promise<HeroicApplyStageResult> {
  const raw = readJsonEntry(zip, FORK_BACKUP_PATHS.secrets)
  if (!isRecord(raw)) {
    return { stage: 'secrets', ok: true, message: 'Not in backup' }
  }

  const device = raw.format === 'device'
  const read = (key: keyof Omit<SecretsFile, 'format'>): string | undefined =>
    typeof raw[key] === 'string' ? raw[key] : undefined

  const { setSteamGridDbApiKey } =
    await import('backend/storeManagers/sideload/metadataBackup')
  const { setStoredApiToken } = await import('backend/vndb/client')

  let applied = 0
  const vndb = read('vndbApiToken')
  if (vndb !== undefined && (device || vndb.trim())) {
    // Always re-encrypt for this machine through the regular setters.
    setStoredApiToken(device ? decryptSecret(vndb, 'vndb') : vndb)
    applied++
  }
  const steamGridDb = read('steamGridDbApiKey')
  if (steamGridDb !== undefined && (device || steamGridDb.trim())) {
    setSteamGridDbApiKey(device ? decryptApiKey(steamGridDb) : steamGridDb)
    applied++
  }
  return { stage: 'secrets', ok: true, message: `${applied} secret(s)` }
}

/**
 * Runs the reconcile pass over what the upstream stages wrote, then the fork
 * stages that were selected.
 */
export async function applyForkStages(
  zip: AdmZip,
  options: HeroicApplyOptions,
  local: ForkLocalState,
  warnings: string[],
  rollbackMode: boolean
): Promise<HeroicApplyStageResult[]> {
  reconcileUpstreamApply(zip, options, local, warnings, rollbackMode)

  const results: HeroicApplyStageResult[] = []
  if (options.stages.includes('vndbMatches')) {
    results.push(await applyVndbMatches(zip, rollbackMode))
  }
  if (options.stages.includes('gameOverrides')) {
    results.push(await applyGameOverrides(zip, rollbackMode))
  }
  if (options.stages.includes('categoryOrder')) {
    results.push(applyCategoryOrder(zip))
  }
  if (options.stages.includes('secrets')) {
    results.push(await applySecrets(zip))
  }
  return results
}
