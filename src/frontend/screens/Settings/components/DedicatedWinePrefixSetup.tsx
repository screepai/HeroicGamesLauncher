import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import CircularProgress from '@mui/material/CircularProgress'
import type { Runner } from 'common/types'
import type { VnCompatibilityPrefixRecipe } from 'common/types/vnCompatibility'
import { WarningMessage } from 'frontend/components/UI'

type PrefixCreationState =
  | { status: 'idle' }
  | { status: 'confirming'; recipe: VnCompatibilityPrefixRecipe | null }
  | { status: 'creating'; recipe: VnCompatibilityPrefixRecipe | null }
  | { status: 'done' }
  | {
      status: 'error'
      recipe: VnCompatibilityPrefixRecipe | null
      error: string
    }

type Props = {
  appName: string
  runner: Runner
  title: string
  overrideTitle?: string
  winePrefix: string
  usesSharedPrefix: boolean
  onCreated: (winePrefix: string) => void
}

export default function DedicatedWinePrefixSetup({
  appName,
  runner,
  title,
  overrideTitle,
  winePrefix,
  usesSharedPrefix,
  onCreated
}: Props) {
  const { t } = useTranslation('gamepage')
  const [creation, setCreation] = useState<PrefixCreationState>({
    status: 'idle'
  })
  const [recipes, setRecipes] = useState<VnCompatibilityPrefixRecipe[]>([])
  const creationPending = useRef(false)
  const selectedRecipe = 'recipe' in creation ? creation.recipe : null

  useEffect(() => {
    let mounted = true
    const titles = [title, overrideTitle].filter(
      (candidate): candidate is string => Boolean(candidate)
    )
    window.api.vnCompatibility
      .get({ titles })
      .then((result) => {
        if (!mounted || result?.match !== 'title') return

        const found = new Map<string, VnCompatibilityPrefixRecipe>()
        for (const entry of result.entries) {
          const setup = result.prefixSetups[entry.winePrefix]
          if (!setup || found.has(entry.winePrefix)) continue
          found.set(entry.winePrefix, { name: entry.winePrefix, ...setup })
        }
        setRecipes([...found.values()])
      })
      .catch(() => undefined)

    return () => {
      mounted = false
    }
  }, [overrideTitle, title])

  if (!usesSharedPrefix && recipes.length === 0 && creation.status !== 'done') {
    return null
  }

  async function createDedicatedPrefix() {
    if (
      creationPending.current ||
      (creation.status !== 'confirming' && creation.status !== 'error')
    ) {
      return
    }

    creationPending.current = true
    const recipe = creation.recipe
    setCreation({ status: 'creating', recipe })
    try {
      const result = await window.api.vnCompatibility.createDedicatedPrefix({
        appName,
        runner,
        recipe: recipe ?? undefined
      })
      if (result.status === 'error') {
        setCreation({ status: 'error', recipe, error: result.error })
        return
      }

      onCreated(result.winePrefix)
      setCreation({ status: 'done' })
    } catch (error) {
      setCreation({ status: 'error', recipe, error: String(error) })
    } finally {
      creationPending.current = false
    }
  }

  return (
    <section className="dedicatedWinePrefixSetup" aria-live="polite">
      {creation.status === 'done' ? (
        <>
          <strong>
            {t(
              'compatibility.create-prefix-complete-title',
              'Separate prefix ready'
            )}
          </strong>
          <p>
            {t(
              'compatibility.create-prefix-complete-settings',
              'Heroic created, initialized, and selected this prefix:'
            )}
          </p>
          <code title={winePrefix}>{winePrefix}</code>
        </>
      ) : usesSharedPrefix ? (
        <>
          <strong>
            {t(
              'compatibility.shared-prefix-settings-title',
              'This game is using a shared prefix'
            )}
          </strong>
          <p>
            {t(
              'compatibility.shared-prefix-settings-description',
              'Create a separate prefix before installing game-specific codecs or components.'
            )}
          </p>
        </>
      ) : (
        <>
          <strong>
            {t(
              'compatibility.recipe-prefix-settings-title',
              'Reusable recipe prefixes'
            )}
          </strong>
          <p>
            {t(
              'compatibility.recipe-prefix-settings-description',
              'Move this game to a prefix shared only with games using the same VNWiki recipe.'
            )}
          </p>
        </>
      )}

      {creation.status === 'confirming' && (
        <WarningMessage>
          {selectedRecipe
            ? t(
                'compatibility.create-recipe-prefix-warning',
                'This prefix is shared only with games using the same {{recipe}} recipe. Existing components and saves are not copied from the current prefix.',
                { recipe: selectedRecipe.name }
              )
            : t(
                'compatibility.create-prefix-warning',
                'The shared prefix is left untouched, but its installed components and saves are not copied. Back up or move any saves stored inside it before switching.'
              )}
        </WarningMessage>
      )}
      {creation.status === 'creating' && (
        <div className="dedicatedWinePrefixProgress">
          <CircularProgress size={20} />
          <span>
            {t(
              'compatibility.creating-prefix-detail',
              'Creating and initializing the prefix. This can take a minute…'
            )}
          </span>
        </div>
      )}
      {creation.status === 'error' && (
        <WarningMessage>
          {t('compatibility.create-prefix-failed', 'Could not create prefix:')}{' '}
          {creation.error}
        </WarningMessage>
      )}

      <div className="dedicatedWinePrefixActions">
        {creation.status === 'idle' && (
          <>
            {recipes.map((recipe) => (
              <button
                key={recipe.name}
                className="button is-primary"
                onClick={() => setCreation({ status: 'confirming', recipe })}
              >
                {t(
                  'compatibility.use-recipe-prefix',
                  'Use {{recipe}} recipe prefix',
                  { recipe: recipe.name }
                )}
              </button>
            ))}
            {usesSharedPrefix && (
              <button
                className={
                  recipes.length ? 'button is-secondary' : 'button is-primary'
                }
                onClick={() =>
                  setCreation({ status: 'confirming', recipe: null })
                }
              >
                {t(
                  'compatibility.create-isolated-prefix',
                  'Create isolated prefix'
                )}
              </button>
            )}
          </>
        )}
        {(creation.status === 'confirming' || creation.status === 'error') && (
          <>
            <button
              className="button is-secondary"
              onClick={() => setCreation({ status: 'idle' })}
            >
              {t('compatibility.cancel', 'Cancel')}
            </button>
            <button
              className="button is-primary"
              onClick={() => void createDedicatedPrefix()}
            >
              {t(
                'compatibility.create-and-use-prefix',
                'Create and use prefix'
              )}
            </button>
          </>
        )}
      </div>
    </section>
  )
}
