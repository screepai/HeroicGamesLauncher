import type { GameInfo } from 'common/types'
import type { VndbGameMatch } from 'common/types/vndb'
import { useEffect, useState } from 'react'

/**
 * Loads the stored VNDB match of a game and asks the backend to fill in any
 * missing details/releases (`vndb.hydrateMatch`). Hydration runs once per
 * game, not after every match update.
 */
export default function useVndbMatch(gameInfo: GameInfo, enabled = true) {
  const { app_name: appName, runner } = gameInfo
  const isActive = enabled && Boolean(gameInfo.isVisualNovel)
  const [match, setMatch] = useState<VndbGameMatch | null>(null)

  useEffect(() => {
    if (!isActive) {
      setMatch(null)
      return
    }

    let isMounted = true

    async function load() {
      const storedMatch = await window.api.vndb.getGameMatch({
        appName,
        runner
      })
      if (!isMounted) {
        return
      }

      setMatch(storedMatch)
      if (!storedMatch) {
        return
      }

      try {
        const hydratedMatch = await window.api.vndb.hydrateMatch({
          appName,
          runner
        })
        if (isMounted && hydratedMatch) {
          setMatch(hydratedMatch)
        }
      } catch (error) {
        console.error(error)
      }
    }

    load().catch((error) => {
      console.error(error)
      if (isMounted) {
        setMatch(null)
      }
    })

    return () => {
      isMounted = false
    }
  }, [appName, isActive, runner])

  return { match, setMatch }
}
