import './WinePrefix.css'

import { useContext } from 'react'
import { useTranslation } from 'react-i18next'
import ContextProvider from 'frontend/state/ContextProvider'
import useSetting from 'frontend/hooks/useSetting'
import useAppSetting from 'frontend/hooks/useAppSetting'
import { PathSelectionBox } from 'frontend/components/UI'
import { isWindowsPlatform } from 'common/utils'
import { isDefaultWinePrefix } from 'frontend/helpers/winePrefix'
import SettingsContext from '../SettingsContext'
import { defaultWineVersion } from '../util'
import DedicatedWinePrefixSetup from './DedicatedWinePrefixSetup'

const WinePrefix = () => {
  const { t } = useTranslation()
  const { platform } = useContext(ContextProvider)
  const { appName, gameInfo, getSetting, isDefault, runner } =
    useContext(SettingsContext)
  const wineVersion = getSetting('wineVersion', defaultWineVersion)
  const sharedWinePrefix = useAppSetting('sharedWinePrefix', '')
  const defaultWinePrefix = useAppSetting('winePrefix', '')
  const isWin = platform === 'win32'

  const [winePrefix, setWinePrefix] = useSetting('winePrefix', sharedWinePrefix)
  const usesSharedPrefix = isDefaultWinePrefix(winePrefix, [
    sharedWinePrefix,
    defaultWinePrefix
  ])
  const isInstalledWindowsGame = Boolean(
    !isDefault &&
    gameInfo?.is_installed &&
    isWindowsPlatform(gameInfo.install.platform)
  )
  const showPrefixCreation = platform === 'linux' && isInstalledWindowsGame

  if (isWin || wineVersion.type === 'crossover') {
    return null
  }

  return (
    <>
      <PathSelectionBox
        htmlId="selectWinePrefix"
        label={t('setting.wineprefix')}
        path={winePrefix}
        onPathChange={setWinePrefix}
        type="directory"
        pathDialogTitle={t('box.wineprefix')}
        pathDialogDefaultPath={winePrefix}
        noDeleteButton
        info={
          <>
            {t(
              'infobox.wine-repfix.message',
              'Wine uses what is called a WINEPREFIX to encapsulate windows applications. This prefix contains the Wine configuration files and a reproduction of the file hierarchy of C: (the main disk on a windows OS). In this reproduction of the C: drive, your game save files and dependencies installed via winetricks are stored.'
            )}{' '}
            <span
              className="link"
              onClick={() => window.api.openWinePrefixFAQ()}
            >
              WinePrefix FAQ
            </span>
          </>
        }
      />
      {showPrefixCreation && runner && gameInfo && (
        <DedicatedWinePrefixSetup
          appName={appName}
          runner={runner}
          title={gameInfo.title}
          overrideTitle={gameInfo.overrides?.title}
          winePrefix={winePrefix}
          usesSharedPrefix={usesSharedPrefix}
          onCreated={setWinePrefix}
        />
      )}
    </>
  )
}

export default WinePrefix
