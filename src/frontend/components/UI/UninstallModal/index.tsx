import './index.scss'
import React, { useContext, useEffect, useState } from 'react'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader
} from 'frontend/components/UI/Dialog'
import { useTranslation } from 'react-i18next'
import { Runner } from 'common/types'
import ToggleSwitch from '../ToggleSwitch'
import { useNavigate, useLocation } from 'react-router-dom'
import ContextProvider from 'frontend/state/ContextProvider'

interface UninstallModalProps {
  appName: string
  runner: Runner
  onClose: () => void
  isDlc: boolean
  initialAction?: UninstallAction
}

export type UninstallAction = 'heroicOnly' | 'entirely'

const UninstallModal: React.FC<UninstallModalProps> = function ({
  appName,
  runner,
  onClose,
  isDlc,
  initialAction
}) {
  const [isNative, setIsNative] = useState(true)
  const [winePrefix, setWinePrefix] = useState('')
  const [deletePrefixChecked, setDeletePrefixChecked] = useState(false)
  const [deleteSettingsChecked, setDeleteSettingsChecked] = useState(false)
  const [disableDeleteWine, setDisableDeleteWine] = useState(false)
  const { t } = useTranslation('gamepage')
  const [showUninstallModal, setShowUninstallModal] = useState(false)
  const navigate = useNavigate()
  const location = useLocation()
  const { installingEpicGame, libraryStatus } = useContext(ContextProvider)
  const [gameTitle, setGameTitle] = useState('')

  const isGameRunning = libraryStatus.find(
    (st) =>
      st.appName === appName && st.runner === runner && st.status === 'playing'
  )

  const checkIfIsNative = async () => {
    // This assumes native games are installed should be changed in the future
    // if we add option to install windows games even if native is available

    setShowUninstallModal(true)

    const gameInfo = await window.api.getGameInfo(appName, runner)

    const isNative = await window.api.isNative({
      runner,
      appName
    })
    setIsNative(isNative)

    if (isDlc) {
      return
    }

    if (!gameInfo) {
      return
    }

    setGameTitle(gameInfo.overrides?.title || gameInfo.title)

    const { install } = gameInfo
    if (install.platform?.toLowerCase() !== 'windows') {
      return
    }

    const gameSettings = await window.api.getGameSettings(appName, runner)
    if (!gameSettings) {
      return
    }

    const defaultSettings = await window.api.requestGameSettings('default')

    setWinePrefix(gameSettings.winePrefix)
    setDisableDeleteWine(gameSettings.winePrefix === defaultSettings.winePrefix)
  }

  useEffect(() => {
    checkIfIsNative()
  }, [])

  const storage: Storage = window.localStorage
  const closeAfterUninstall = () => {
    if (runner === 'sideload' && location.pathname.match(/gamepage/)) {
      navigate('/#library')
    }
    storage.removeItem(appName)
  }

  const uninstallGame = async () => {
    onClose()

    await window.api.uninstall(
      appName,
      runner,
      deletePrefixChecked,
      deleteSettingsChecked,
      true
    )
    closeAfterUninstall()
  }

  const removeGameFromHeroic = async () => {
    onClose()

    await window.api.removeGameFromHeroic(
      appName,
      runner,
      deletePrefixChecked,
      deleteSettingsChecked
    )
    closeAfterUninstall()
  }

  const showWineCheckbox = !isNative && !isDlc
  const showActionChoice = !isDlc && initialAction === undefined
  const showHeroicOnlyAction =
    !isDlc && (initialAction === undefined || initialAction === 'heroicOnly')
  const showEntirelyAction =
    isDlc || initialAction === undefined || initialAction === 'entirely'

  const getUninstallMessage = () => {
    if (isDlc) {
      return t('gamepage:box.uninstall.dlc', {
        defaultValue: 'Do you want to uninstall "{{title}}" (DLC)?',
        title: gameTitle
      })
    }

    if (initialAction === 'heroicOnly') {
      return t('gamepage:box.uninstall.heroicOnlyMessage', {
        defaultValue: 'Remove "{{title}}" from Heroic and keep the game files?',
        title: gameTitle
      })
    }

    if (initialAction === 'entirely') {
      return t('gamepage:box.uninstall.entirelyMessage', {
        defaultValue:
          'Uninstall "{{title}}" entirely and delete the game files from disk?',
        title: gameTitle
      })
    }

    return t('gamepage:box.uninstall.message', {
      defaultValue: 'How do you want to uninstall "{{title}}"?',
      title: gameTitle
    })
  }

  // disallow uninstalling epic games if an epic game is being installed
  if (installingEpicGame && runner === 'legendary') {
    return (
      <>
        {showUninstallModal && (
          <Dialog onClose={onClose} showCloseButton className="uninstall-modal">
            <DialogHeader onClose={onClose}>
              {t('gamepage:box.uninstall.title')}
            </DialogHeader>
            <DialogContent>
              {t(
                'gamepage:box.uninstall.cannotUninstallEpic',
                'Epic games cannot be uninstalled while another Epic game is being installed.'
              )}
            </DialogContent>
            <DialogFooter>
              <button onClick={onClose} className={`button outline`}>
                {t('box.close', 'Close')}
              </button>
            </DialogFooter>
          </Dialog>
        )}
      </>
    )
  }

  if (isGameRunning) {
    return (
      <>
        {showUninstallModal && (
          <Dialog onClose={onClose} showCloseButton className="uninstall-modal">
            <DialogHeader onClose={onClose}>
              {t('gamepage:box.uninstall.title')}
            </DialogHeader>
            <DialogContent>
              {t('gamepage:box.uninstall.gameIsRunning', {
                defaultValue:
                  '{{title}} is running. Close the game to uninstall it.',
                title: gameTitle
              })}
            </DialogContent>
            <DialogFooter>
              <button onClick={onClose} className={`button outline`}>
                {t('box.close', 'Close')}
              </button>
            </DialogFooter>
          </Dialog>
        )}
      </>
    )
  }

  // normal dialog to uninstall a game
  return (
    <>
      {showUninstallModal && (
        <Dialog onClose={onClose} showCloseButton className="uninstall-modal">
          <DialogHeader onClose={onClose}>
            {t('gamepage:box.uninstall.title')}
          </DialogHeader>
          <DialogContent>
            <div className="uninstallModalMessage">{getUninstallMessage()}</div>
            {showActionChoice && (
              <p className="uninstallModalMessage">
                {t(
                  'gamepage:box.uninstall.keepFilesHint',
                  'Uninstall in Heroic removes it from the installed list and keeps the game files. Uninstall entirely deletes the game files from disk.'
                )}
              </p>
            )}
            {showWineCheckbox && (
              <ToggleSwitch
                htmlId="uninstallCheckbox"
                value={deletePrefixChecked}
                title={t('gamepage:box.uninstall.checkbox', {
                  defaultValue:
                    "Remove prefix: {{prefix}}{{newLine}}Note: This can't be undone and will also remove not backed up save files.",
                  prefix: winePrefix,
                  newLine: '\n'
                })}
                disabled={disableDeleteWine}
                handleChange={() => {
                  setDeletePrefixChecked(!deletePrefixChecked)
                }}
              />
            )}
            {disableDeleteWine && (
              <p className="default-wine-warning">
                {t(
                  'gamepage:box.uninstall.prefix_warning',
                  'The Wine prefix for this game is the default prefix. If you really want to delete it, you have to do it manually.'
                )}
              </p>
            )}
            {!isDlc && (
              <ToggleSwitch
                htmlId="uninstallsettingCheckbox"
                value={deleteSettingsChecked}
                title={t('gamepage:box.uninstall.settingcheckbox', {
                  defaultValue:
                    "Erase settings and remove log{{newLine}}Note: This can't be undone. Any modified settings will be forgotten and log will be deleted.",
                  newLine: '\n'
                })}
                handleChange={() => {
                  setDeleteSettingsChecked(!deleteSettingsChecked)
                }}
              />
            )}
          </DialogContent>
          <DialogFooter>
            {showHeroicOnlyAction && (
              <button
                onClick={removeGameFromHeroic}
                className={`button is-secondary outline`}
              >
                {t('gamepage:box.uninstall.heroicOnly', 'Uninstall in Heroic')}
              </button>
            )}
            {showEntirelyAction && (
              <button
                onClick={uninstallGame}
                className={`button is-secondary outline`}
              >
                {isDlc
                  ? t('box.yes')
                  : t('gamepage:box.uninstall.entirely', 'Uninstall entirely')}
              </button>
            )}
            <button onClick={onClose} className={`button is-secondary outline`}>
              {t('box.no')}
            </button>
          </DialogFooter>
        </Dialog>
      )}
    </>
  )
}

export default UninstallModal
