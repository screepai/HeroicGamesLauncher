import type { VndbUserOptions } from 'common/types/vndb'
import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'

export type VndbUserOptionsState =
  | { status: 'idle' | 'loading' }
  | { status: 'ready'; options: VndbUserOptions }
  | { status: 'error'; message: string }

/** Loads the user's VNDB list options (labels, vote, dates) for a visual novel. */
export default function useVndbUserOptions(vnId: string) {
  const { t } = useTranslation('gamepage')
  const [state, setState] = useState<VndbUserOptionsState>({ status: 'idle' })

  useEffect(() => {
    if (!vnId.startsWith('v')) {
      setState({ status: 'idle' })
      return
    }

    let isMounted = true
    setState({ status: 'loading' })

    window.api.vndb
      .getUserOptions({ vnId })
      .then((options) => {
        if (isMounted) {
          setState({ status: 'ready', options })
        }
      })
      .catch((error) => {
        console.error(error)
        if (isMounted) {
          setState({
            status: 'error',
            message: t(
              'vndb.user-options-load-error',
              'Unable to load VNDB user options.'
            )
          })
        }
      })

    return () => {
      isMounted = false
    }
  }, [vnId, t])

  const setOptions = useCallback((options: VndbUserOptions) => {
    setState({ status: 'ready', options })
  }, [])

  const reload = useCallback(async () => {
    setOptions(await window.api.vndb.getUserOptions({ vnId }))
  }, [setOptions, vnId])

  return { state, setOptions, reload }
}
