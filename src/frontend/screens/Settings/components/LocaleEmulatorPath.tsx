import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import { PathSelectionBox } from 'frontend/components/UI'
import useSetting from 'frontend/hooks/useSetting'
import ContextProvider from 'frontend/state/ContextProvider'

const LocaleEmulatorPath = () => {
  const { t } = useTranslation()
  const { platform } = useContext(ContextProvider)
  const [localeEmulatorPath, setLocaleEmulatorPath] = useSetting(
    'localeEmulatorPath',
    ''
  )

  if (platform !== 'win32') {
    return null
  }

  return (
    <PathSelectionBox
      type="file"
      onPathChange={setLocaleEmulatorPath}
      path={localeEmulatorPath}
      pathDialogTitle={t(
        'box.locale-emulator-path',
        'Select Locale Emulator executable'
      )}
      pathDialogDefaultPath={localeEmulatorPath}
      pathDialogFilters={[
        {
          name: t('box.windows-executable', 'Windows executable'),
          extensions: ['exe']
        }
      ]}
      placeholder={t(
        'setting.locale-emulator-path-placeholder',
        'Select Locale Emulator executable...'
      )}
      label={t('setting.locale-emulator-path', 'Locale Emulator executable')}
      htmlId="locale_emulator_path"
    />
  )
}

export default LocaleEmulatorPath
