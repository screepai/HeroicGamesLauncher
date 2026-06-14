import type { AppSettings } from 'common/types'
import { useEffect, useState } from 'react'

export const APP_SETTING_CHANGED_EVENT = 'app-setting-changed'

type AppSettingChangedDetail = {
  key: keyof AppSettings
  value: AppSettings[keyof AppSettings]
}

export default function useAppSetting<T extends keyof AppSettings>(
  key: T,
  fallback: NonNullable<AppSettings[T]>
): NonNullable<AppSettings[T]> {
  const [value, setValue] = useState<NonNullable<AppSettings[T]>>(fallback)

  useEffect(() => {
    let isMounted = true

    void window.api.requestAppSettings().then((settings) => {
      if (isMounted) {
        setValue(settings[key] ?? fallback)
      }
    })

    const handleSettingChanged = (event: Event) => {
      const { detail } = event as CustomEvent<AppSettingChangedDetail>
      if (detail.key === key) {
        setValue(detail.value as NonNullable<AppSettings[T]>)
      }
    }
    window.addEventListener(APP_SETTING_CHANGED_EVENT, handleSettingChanged)

    return () => {
      isMounted = false
      window.removeEventListener(
        APP_SETTING_CHANGED_EVENT,
        handleSettingChanged
      )
    }
  }, [fallback, key])

  return value
}
