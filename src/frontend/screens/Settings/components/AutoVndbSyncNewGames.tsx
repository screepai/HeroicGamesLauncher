import { ToggleSwitch } from 'frontend/components/UI'
import useSetting from 'frontend/hooks/useSetting'
import { useTranslation } from 'react-i18next'

const AutoVndbSyncNewGames = () => {
  const { t } = useTranslation()
  const [autoVndbSyncNewGames, setAutoVndbSyncNewGames] = useSetting(
    'autoVndbSyncNewGames',
    true
  )

  return (
    <ToggleSwitch
      htmlId="autoVndbSyncNewGames"
      value={autoVndbSyncNewGames}
      handleChange={() => setAutoVndbSyncNewGames(!autoVndbSyncNewGames)}
      title={t(
        'setting.autoVndbSyncNewGames',
        'Automatically sync newly added visual novels with VNDB'
      )}
    />
  )
}

export default AutoVndbSyncNewGames
