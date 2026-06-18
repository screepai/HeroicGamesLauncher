import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { InfoBox, TextInputField } from 'frontend/components/UI'
import { dispatchVndbApiTokenChanged } from 'frontend/hooks/useHasVndbApiToken'
import useSetting from 'frontend/hooks/useSetting'

export default function VndbApiToken() {
  const { t } = useTranslation()
  const [value, setValue] = useState('')
  const [hasToken, setHasToken] = useState(false)
  const [enableVndbIntegration] = useSetting('enableVndbIntegration', true)
  const url = 'https://vndb.org/u/tokens'

  useEffect(() => {
    void window.api.vndb.hasApiToken().then(setHasToken)
  }, [])

  const onChange = (newValue: string) => {
    setValue(newValue)
    void window.api.vndb.setApiToken(newValue).then(() => {
      const nextHasToken = !!newValue
      setHasToken(nextHasToken)
      dispatchVndbApiTokenChanged(nextHasToken)
    })
  }

  const placeholder = hasToken
    ? t(
        'settings.vndb.apitoken.placeholder_saved',
        'Token saved - type to replace, clear to remove'
      )
    : t('settings.vndb.apitoken.placeholder', 'Enter your VNDB API Token here')

  return (
    <TextInputField
      label={t('settings.vndb.apitoken.title', 'VNDB API Token')}
      placeholder={placeholder}
      onChange={onChange}
      value={value}
      htmlId="vndb-api-token"
      type="password"
      disabled={!enableVndbIntegration}
      afterInput={
        <InfoBox text={t('settings.advanced.details', 'Details')}>
          <span style={{ userSelect: 'text' }}>
            {t(
              'settings.vndb.help.description',
              'Provide your VNDB API token for authenticated VNDB actions such as list management. The token is stored encrypted when your system supports it. You can get one at {{url}}',
              { url }
            )}
          </span>
        </InfoBox>
      }
    />
  )
}
