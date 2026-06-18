import { useEffect, useState } from 'react'

export const VNDB_API_TOKEN_CHANGED_EVENT = 'vndb-api-token-changed'

export function dispatchVndbApiTokenChanged(hasToken: boolean) {
  window.dispatchEvent(
    new CustomEvent(VNDB_API_TOKEN_CHANGED_EVENT, {
      detail: { hasToken }
    })
  )
}

export default function useHasVndbApiToken(enabled = true) {
  const [hasToken, setHasToken] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setHasToken(false)
      return
    }

    let isMounted = true
    const updateHasToken = (value: boolean) => {
      if (isMounted) {
        setHasToken(value)
      }
    }
    const handleTokenChanged = (event: Event) => {
      const { detail } = event as CustomEvent<{ hasToken?: boolean }>
      if (typeof detail?.hasToken === 'boolean') {
        updateHasToken(detail.hasToken)
      }
    }

    void window.api.vndb
      .hasApiToken()
      .then(updateHasToken)
      .catch(() => {
        updateHasToken(false)
      })
    window.addEventListener(VNDB_API_TOKEN_CHANGED_EVENT, handleTokenChanged)

    return () => {
      isMounted = false
      window.removeEventListener(
        VNDB_API_TOKEN_CHANGED_EVENT,
        handleTokenChanged
      )
    }
  }, [enabled])

  return hasToken
}
