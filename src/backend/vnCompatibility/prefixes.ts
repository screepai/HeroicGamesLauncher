import { isAbsolute, join, relative, resolve } from 'path'
import {
  existsSync,
  readFileSync,
  renameSync,
  writeFileSync
} from 'graceful-fs'

import { GlobalConfig } from 'backend/config'
import { isLinux } from 'backend/constants/environment'
import { userHome } from 'backend/constants/paths'
import { validWine, verifyWinePrefix } from 'backend/launcher'
import { logError, logInfo, LogPrefix } from 'backend/logger'
import { libraryManagerMap } from 'backend/storeManagers'
import {
  removeSpecialcharacters,
  sendGameStatusUpdate,
  writeConfig
} from 'backend/utils'
import type { GameSettings } from 'common/types'
import { isWindowsPlatform } from 'common/utils'
import type {
  VnCompatibilityPrefixCreateArgs,
  VnCompatibilityPrefixCreateResult,
  VnCompatibilityPrefixRecipe
} from 'common/types/vnCompatibility'

const activeGameCreations = new Set<string>()
const activePrefixCreations = new Set<string>()
const bootstrapDllOverrides = 'mscoree,mshtml='
const managedPrefixMetadataName = '.heroic-prefix.json'

type ManagedPrefixMetadata = {
  version: 1
  kind: 'recipe'
  recipe: VnCompatibilityPrefixRecipe
  installedSpecialCodecs: string[]
}

export function normalizeWinePrefixPath(path: string): string {
  return resolve(path.replace(/^~(?=\/|$)/, userHome))
}

export function isDefaultWinePrefixPath(
  winePrefix: string,
  configuredPrefixes: string[]
): boolean {
  const normalizedPrefix = normalizeWinePrefixPath(winePrefix)
  return configuredPrefixes.some(
    (prefix) =>
      Boolean(prefix) && normalizeWinePrefixPath(prefix) === normalizedPrefix
  )
}

function isInside(basePath: string, candidatePath: string): boolean {
  const pathFromBase = relative(basePath, candidatePath)
  return (
    pathFromBase !== '' &&
    !pathFromBase.startsWith('..') &&
    !isAbsolute(pathFromBase)
  )
}

export function getDedicatedPrefixPath(
  basePath: string,
  title: string,
  appName: string
): string {
  const normalizedBasePath = resolve(basePath)
  const safeTitle = removeSpecialcharacters(title).trim()
  const safeAppName = removeSpecialcharacters(appName).trim()
  const folderName =
    safeTitle && !['.', '..'].includes(safeTitle) ? safeTitle : safeAppName
  const candidatePath = resolve(join(normalizedBasePath, folderName))

  if (!folderName || !isInside(normalizedBasePath, candidatePath)) {
    throw new Error('Heroic could not create a safe per-game prefix path')
  }

  return candidatePath
}

function normalizeRecipeName(name: string): string {
  return name
    .normalize('NFKD')
    .toLocaleLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
}

function validateRecipe(
  recipe: VnCompatibilityPrefixRecipe
): VnCompatibilityPrefixRecipe {
  const name = recipe.name.trim()
  if (
    !name ||
    name.length > 100 ||
    !['32-bit', '64-bit'].includes(recipe.architecture)
  ) {
    throw new Error('The Wine prefix recipe is invalid')
  }

  const getComponents = (components: string[]) => {
    if (!Array.isArray(components) || components.length > 64) {
      throw new Error('The Wine prefix recipe has too many components')
    }
    const unique = [...new Set(components)]
    if (unique.some((component) => !/^[a-z0-9_.+-]+$/i.test(component))) {
      throw new Error('The Wine prefix recipe contains an invalid component')
    }
    return unique
  }

  return {
    name,
    architecture: recipe.architecture,
    specialCodecs: getComponents(recipe.specialCodecs),
    winetricks: getComponents(recipe.winetricks)
  }
}

export function getRecipePrefixPath(basePath: string, recipe: string): string {
  const recipeName = normalizeRecipeName(recipe)
  if (!recipeName) throw new Error('The Wine prefix recipe name is invalid')

  return getDedicatedPrefixPath(
    join(basePath, 'recipes'),
    recipeName,
    recipeName
  )
}

function getMetadataPath(winePrefix: string): string {
  return join(winePrefix, managedPrefixMetadataName)
}

export function getManagedPrefixMetadata(
  winePrefix: string
): ManagedPrefixMetadata | null {
  const metadataPath = getMetadataPath(winePrefix)
  if (!existsSync(metadataPath)) return null

  try {
    const metadata = JSON.parse(
      readFileSync(metadataPath, 'utf8')
    ) as ManagedPrefixMetadata
    if (
      metadata.version !== 1 ||
      metadata.kind !== 'recipe' ||
      !metadata.recipe?.name ||
      !Array.isArray(metadata.installedSpecialCodecs)
    ) {
      return null
    }
    return metadata
  } catch {
    return null
  }
}

function writeManagedPrefixMetadata(
  winePrefix: string,
  metadata: ManagedPrefixMetadata
) {
  const metadataPath = getMetadataPath(winePrefix)
  const temporaryPath = `${metadataPath}.tmp`
  writeFileSync(temporaryPath, `${JSON.stringify(metadata, null, 2)}\n`)
  renameSync(temporaryPath, metadataPath)
}

function writeRecipeMetadata(
  winePrefix: string,
  recipe: VnCompatibilityPrefixRecipe,
  current: ManagedPrefixMetadata | null
) {
  writeManagedPrefixMetadata(winePrefix, {
    version: 1,
    kind: 'recipe',
    recipe,
    installedSpecialCodecs: current?.installedSpecialCodecs ?? []
  })
}

function getCompatibleRecipeMetadata(
  winePrefix: string,
  recipe: VnCompatibilityPrefixRecipe
): ManagedPrefixMetadata | null {
  const current = getManagedPrefixMetadata(winePrefix)
  if (
    current &&
    (normalizeRecipeName(current.recipe.name) !==
      normalizeRecipeName(recipe.name) ||
      current.recipe.architecture !== recipe.architecture)
  ) {
    throw new Error('The existing managed prefix uses an incompatible recipe')
  }
  return current
}

export function recordInstalledSpecialCodecs(
  winePrefix: string,
  codecs: string[]
) {
  const current = getManagedPrefixMetadata(winePrefix)
  if (!current) return

  writeManagedPrefixMetadata(winePrefix, {
    ...current,
    installedSpecialCodecs: [
      ...new Set([...current.installedSpecialCodecs, ...codecs])
    ].sort()
  })
}

function getPrefixBootstrapSettings(
  settings: GameSettings,
  recipe?: VnCompatibilityPrefixRecipe
): GameSettings {
  if (
    recipe?.architecture === '32-bit' &&
    settings.wineVersion.type !== 'wine'
  ) {
    throw new Error('32-bit recipes require a Wine version instead of Proton')
  }

  if (settings.wineVersion.type !== 'wine') return settings

  const enviromentOptions = settings.enviromentOptions.map((option) => ({
    ...option
  }))
  const override = enviromentOptions.find(
    ({ key }) => key.toLocaleLowerCase() === 'winedlloverrides'
  )
  if (override) {
    override.value = [override.value, bootstrapDllOverrides]
      .filter(Boolean)
      .join(';')
  } else {
    enviromentOptions.push({
      key: 'WINEDLLOVERRIDES',
      value: bootstrapDllOverrides
    })
  }

  if (recipe) {
    const wineArchitecture =
      recipe.architecture === '32-bit' ? 'win32' : 'win64'
    const architectureOption = enviromentOptions.find(
      ({ key }) => key.toLocaleLowerCase() === 'winearch'
    )
    if (architectureOption) {
      architectureOption.value = wineArchitecture
    } else {
      enviromentOptions.push({ key: 'WINEARCH', value: wineArchitecture })
    }
  }

  return { ...settings, enviromentOptions }
}

export async function createDedicatedPrefix({
  appName,
  runner,
  recipe
}: VnCompatibilityPrefixCreateArgs): Promise<VnCompatibilityPrefixCreateResult> {
  if (!isLinux) {
    return { status: 'error', error: 'Wine prefix creation requires Linux' }
  }

  const gameKey = `${runner}:${appName}`
  if (activeGameCreations.has(gameKey)) {
    return {
      status: 'error',
      error: 'A Wine prefix is already being created for this game'
    }
  }

  activeGameCreations.add(gameKey)
  let lockedPrefix: string | undefined
  sendGameStatusUpdate({ appName, runner, status: 'winetricks' })
  try {
    const managedRecipe = recipe ? validateRecipe(recipe) : undefined
    const game = libraryManagerMap[runner].getGame(appName)
    const gameInfo = game.getGameInfo()
    if (
      !gameInfo.is_installed ||
      !isWindowsPlatform(gameInfo.install.platform)
    ) {
      throw new Error(
        'A dedicated Wine prefix requires an installed Windows game'
      )
    }

    const gameSettings = await game.getSettings()
    const globalSettings = GlobalConfig.get().getSettings()
    const configuredPrefixes = [
      globalSettings.sharedWinePrefix,
      globalSettings.winePrefix
    ].filter(Boolean)

    if (
      !managedRecipe &&
      gameSettings.winePrefix &&
      !isDefaultWinePrefixPath(gameSettings.winePrefix, configuredPrefixes)
    ) {
      return {
        status: 'done',
        winePrefix: gameSettings.winePrefix
      }
    }

    if (!globalSettings.defaultWinePrefixDir) {
      throw new Error(
        'Choose a folder for new Wine prefixes in Heroic settings'
      )
    }

    let winePrefix = managedRecipe
      ? getRecipePrefixPath(
          globalSettings.defaultWinePrefixDir,
          managedRecipe.name
        )
      : getDedicatedPrefixPath(
          globalSettings.defaultWinePrefixDir,
          gameInfo.overrides?.title || gameInfo.title,
          appName
        )
    if (
      !managedRecipe &&
      isDefaultWinePrefixPath(winePrefix, configuredPrefixes)
    ) {
      winePrefix = getDedicatedPrefixPath(
        globalSettings.defaultWinePrefixDir,
        `${gameInfo.overrides?.title || gameInfo.title} ${appName}`,
        appName
      )
    }

    const recipeMetadata = managedRecipe
      ? getCompatibleRecipeMetadata(winePrefix, managedRecipe)
      : null

    if (activePrefixCreations.has(winePrefix)) {
      throw new Error('This Wine prefix is already being created')
    }
    activePrefixCreations.add(winePrefix)
    lockedPrefix = winePrefix

    if (
      !['wine', 'proton'].includes(gameSettings.wineVersion.type) ||
      !(await validWine(gameSettings.wineVersion))
    ) {
      throw new Error(
        'Select an installed Wine or Proton version for this game first'
      )
    }

    const dedicatedSettings = { ...gameSettings, winePrefix }
    const { res } = await verifyWinePrefix(
      getPrefixBootstrapSettings(dedicatedSettings, managedRecipe)
    )
    if (res.abort || res.error) {
      throw new Error(res.error || 'Wine prefix creation was cancelled')
    }

    if (managedRecipe) {
      writeRecipeMetadata(winePrefix, managedRecipe, recipeMetadata)
    }
    writeConfig(appName, dedicatedSettings)
    logInfo(
      [`Created a dedicated Wine prefix for ${appName}:`, winePrefix],
      LogPrefix.WineTricks
    )
    return {
      status: 'done',
      winePrefix
    }
  } catch (error) {
    logError(
      ['Dedicated Wine prefix creation failed:', error],
      LogPrefix.WineTricks
    )
    return { status: 'error', error: String(error) }
  } finally {
    activeGameCreations.delete(gameKey)
    if (lockedPrefix) activePrefixCreations.delete(lockedPrefix)
    sendGameStatusUpdate({ appName, runner, status: 'done' })
  }
}
