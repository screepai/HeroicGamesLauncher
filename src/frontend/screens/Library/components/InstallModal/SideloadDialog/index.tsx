import './index.scss'
import short from 'short-uuid'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { InstallPlatform, WineInstallation, GameInfo } from 'common/types'
import { ModalContent, ModalFooter } from 'frontend/components/UI/Modal'
import Button from 'frontend/components/UI/Button'
import { getGameInfo, getGameSettings, writeConfig } from 'frontend/helpers'
import React, {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from 'react'
import { useTranslation } from 'react-i18next'
import { AvailablePlatforms } from '..'
import fallbackImage from 'frontend/assets/heroic_card.jpg'
import ContextProvider from 'frontend/state/ContextProvider'
import { Stepper, StepperStep } from 'frontend/components/UI'
import MetadataStep from './steps/MetadataStep'
import InstallationStep from './steps/InstallationStep'
import FinishStep from './steps/FinishStep'
import ImagesStep from './steps/ImagesStep'
import { FolderOpen, List } from 'lucide-react'
import { Icon, ToggleSwitch } from 'frontend/components/UI'
import VndbSyncButton from '../../LibraryHeader/VndbSyncButton'
import CategoriesManager from '../../CategoriesManager'
import useAppSetting from 'frontend/hooks/useAppSetting'

type Props = {
  availablePlatforms: AvailablePlatforms
  winePrefix: string
  crossoverBottle: string
  wineVersion: WineInstallation | undefined
  platformToInstall: InstallPlatform
  platformSelection: React.ReactNode
  wineSelector?: React.ReactNode
  backdropClick: () => void
  appName?: string
  title: string
  setTitle: (title: string) => void
  defaultPath?: string
}

function getParentDirectory(filePath: string): string {
  const separatorIndex = Math.max(
    filePath.lastIndexOf('/'),
    filePath.lastIndexOf('\\')
  )

  if (separatorIndex === -1) {
    return ''
  }

  if (separatorIndex === 0) {
    return filePath.slice(0, 1)
  }

  if (separatorIndex === 2 && /^[a-z]:/i.test(filePath)) {
    return filePath.slice(0, 3)
  }

  return filePath.slice(0, separatorIndex)
}

type SupportedSteps = 'meta' | 'images' | 'compat' | 'install' | 'finish'

export default function SideloadDialog({
  availablePlatforms,
  backdropClick,
  winePrefix,
  crossoverBottle,
  wineVersion,
  platformToInstall,
  platformSelection,
  wineSelector,
  appName,
  title,
  setTitle,
  defaultPath
}: Props) {
  const { t } = useTranslation('gamepage')
  const [activeStep, setActiveStep] = useState(0)
  const enableVndbIntegration = useAppSetting('enableVndbIntegration', true)
  const [selectedExe, setSelectedExe] = useState('')
  const [gameUrl, setGameUrl] = useState('')
  const [customUserAgent, setCustomUserAgent] = useState('')
  const [launchFullScreen, setLaunchFullScreen] = useState(false)
  const [isVisualNovel, setIsVisualNovel] = useState(false)
  const [jpLocale, setJpLocale] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [heroUrl, setHeroUrl] = useState('')
  const [app_name, setApp_name] = useState(appName ?? '')
  const [runningSetup, setRunningSetup] = useState(false)
  const [gameInfo, setGameInfo] = useState<Partial<GameInfo>>({})
  const [addingApp, setAddingApp] = useState(false)
  const [vndbSyncGame, setVndbSyncGame] = useState<GameInfo | null>(null)
  const [showCategories, setShowCategories] = useState(false)
  const [hasSgdbKey, setHasSgdbKey] = useState(false)
  const editMode = Boolean(appName)

  const { customCategories, refreshLibrary, platform } =
    useContext(ContextProvider)
  const appNameRef = useRef(app_name)
  const gameSavedRef = useRef(editMode)
  const customCategoriesRef = useRef(customCategories)
  appNameRef.current = app_name
  customCategoriesRef.current = customCategories

  useEffect(
    () => () => {
      if (gameSavedRef.current || !appNameRef.current) {
        return
      }

      const gameId = `${appNameRef.current}_sideload`
      for (const category of customCategoriesRef.current.listCategories()) {
        customCategoriesRef.current.removeFromGame(category, gameId)
      }
    },
    []
  )

  const appPlatform = gameInfo.install?.platform || platformToInstall

  useEffect(() => {
    window.api.steamgriddb.hasApiKey().then(setHasSgdbKey)

    if (appName) {
      void getGameInfo(appName, 'sideload').then((info) => {
        if (!info || info.runner !== 'sideload') {
          return
        }
        setGameInfo(info)
        const {
          art_cover,
          art_square,
          install: { executable, platform },
          title,
          browserUrl,
          customUserAgent,
          launchFullScreen,
          isVisualNovel
        } = info

        if (executable && platform) {
          setSelectedExe(executable)
        }

        if (browserUrl) {
          setGameUrl(browserUrl)
        }

        if (customUserAgent) {
          setCustomUserAgent(customUserAgent)
        }

        if (launchFullScreen !== undefined) {
          setLaunchFullScreen(launchFullScreen)
        }

        setIsVisualNovel(isVisualNovel ?? false)
        setTitle(title)
        setImageUrl(art_square || '')
        setHeroUrl(art_cover && art_cover !== art_square ? art_cover : '')
      })

      void getGameSettings(appName, 'sideload').then((settings) => {
        if (settings) {
          setJpLocale(settings.jpLocale)
        }
      })
    } else {
      setApp_name(short.generate().toString())
    }
  }, [])

  function getSideloadGameInfo(): GameInfo {
    return {
      runner: 'sideload',
      app_name,
      title,
      install: {
        executable: selectedExe,
        platform: gameInfo.install?.platform ?? platformToInstall
      },
      art_cover: heroUrl || imageUrl || fallbackImage,
      is_installed: true,
      art_square: imageUrl || heroUrl || fallbackImage,
      canRunOffline: true,
      browserUrl: gameUrl,
      customUserAgent,
      launchFullScreen,
      isVisualNovel
    }
  }

  async function handleInstall(): Promise<void> {
    setAddingApp(true)
    const newGame = getSideloadGameInfo()
    window.api.addNewApp(newGame)
    gameSavedRef.current = true

    window.api.setGameMetadataOverride({
      appName: app_name,
      title: gameInfo.overrides?.title,
      art_cover: gameInfo.overrides?.art_cover,
      art_square: gameInfo.overrides?.art_square,
      isVisualNovel
    })

    const gameSettings = await getGameSettings(app_name, 'sideload')
    if (gameSettings) {
      const selectedWineSettings =
        !editMode && appPlatform === 'Windows' && platform !== 'win32'
          ? {
              winePrefix,
              wineVersion: wineVersion ?? gameSettings.wineVersion,
              wineCrossoverBottle: crossoverBottle
            }
          : {}

      await writeConfig({
        appName: app_name,
        config: { ...gameSettings, ...selectedWineSettings, jpLocale }
      })
    }

    await refreshLibrary({
      library: 'sideload',
      runInBackground: true,
      checkForUpdates: true
    })
    setAddingApp(false)

    if (newGame.isVisualNovel) {
      const { autoVndbSyncNewGames, enableVndbIntegration } =
        await window.api.requestAppSettings()

      if (enableVndbIntegration && autoVndbSyncNewGames) {
        const existingVndbMatch = editMode
          ? await window.api.vndb.getGameMatch({
              appName: newGame.app_name,
              runner: newGame.runner
            })
          : null

        if (!existingVndbMatch) {
          setVndbSyncGame(newGame)
          return
        }
      }
    }

    return backdropClick()
  }

  const fileFilters = useCallback((platform: InstallPlatform) => {
    switch (platform) {
      case 'Windows':
      case 'windows':
      case 'Win32':
        return [
          { name: 'Executables', extensions: ['exe', 'msi'] },
          { name: 'Scripts', extensions: ['bat'] },
          { name: 'All', extensions: ['*'] }
        ]
      case 'linux':
        return [
          { name: 'AppImages', extensions: ['AppImage'] },
          { name: 'Other Binaries', extensions: ['sh', 'py', 'bin'] },
          { name: 'All', extensions: ['*'] }
        ]
      case 'osx':
      case 'Mac':
        return [
          { name: 'Apps', extensions: ['App'] },
          { name: 'Other Binaries', extensions: ['sh', 'py', 'bin'] },
          { name: 'All', extensions: ['*'] }
        ]
      // FIXME: Can these happen?
      case 'Android':
      case 'iOS':
      case 'Browser':
        return []
    }
  }, [])

  const handleRunExe = async () => {
    let exeToRun = ''
    const path = await window.api.openDialog({
      buttonLabel: t('box.select.button', 'Select'),
      properties: ['openFile'],
      defaultPath: directoryToOpen || winePrefix,
      title: t('box.runexe.title', 'Select EXE to Run'),
      filters: fileFilters(appPlatform)
    })
    if (path) {
      exeToRun = path
      try {
        setRunningSetup(true)
        const gameSettings = await getGameSettings(app_name, 'sideload')
        if (!gameSettings) {
          return
        }
        await writeConfig({
          appName: app_name,
          config: { ...gameSettings, winePrefix, wineVersion, jpLocale }
        })
        await window.api.runWineCommand({
          commandParts: [exeToRun],
          wait: true,
          protonVerb: 'run',
          gameSettings: {
            ...gameSettings,
            winePrefix,
            wineVersion: wineVersion || gameSettings.wineVersion,
            jpLocale
          },
          logToApp: { appName: app_name, runner: 'sideload' }
        })
        setActiveStep((step) =>
          flowSteps[step] === 'install' ? step + 1 : step
        )
      } catch (error) {
        console.error('Installer failed', error)
      } finally {
        setRunningSetup(false)
      }
    }
    return
  }

  function platformIcon() {
    const platformIcon = availablePlatforms.filter(
      (p) => p.name === appPlatform.replace('Mac', 'macOS')
    )[0]?.icon

    return (
      <FontAwesomeIcon
        className="InstallModal__platformIcon"
        icon={platformIcon}
      />
    )
  }

  const shouldShowRunExe = platform !== 'win32' && appPlatform === 'Windows'
  const executableDirectory = getParentDirectory(selectedExe)
  const directoryToOpen = executableDirectory || defaultPath || ''

  const stepInfo: Record<SupportedSteps, StepperStep> = {
    meta: {
      title: t('sideload.step.meta', 'Metadata'),
      description: t('sideload.step.meta-desc', 'Name and platform')
    },
    images: {
      title: t('sideload.step.images', 'Images'),
      description: t('sideload.step.images-desc', 'Cover and hero art')
    },
    compat: {
      title: t('sideload.step.compat', 'Compatibility'),
      description: t('sideload.step.compat-desc', 'Wine / Proton setup')
    },
    install: {
      title: t('sideload.step.install', 'Installation'),
      description: t('sideload.step.install-desc', 'Run the installer')
    },
    finish: {
      title: t('sideload.step.finish', 'Finish'),
      description: t('sideload.step.finish-desc', 'Executable and options')
    }
  }

  const flowSteps: SupportedSteps[] = useMemo(() => {
    const steps: SupportedSteps[] = ['meta', 'images']
    if (!editMode && shouldShowRunExe) {
      steps.push('compat', 'install')
    }
    steps.push('finish')
    return steps
  }, [editMode, shouldShowRunExe])

  const numberOfSteps = flowSteps.length
  const lastStepIndex = numberOfSteps - 1

  function handlePreviousStepClick() {
    setActiveStep(Math.max(activeStep - 1, 0))
  }

  function handleNextStepClick() {
    if (activeStep === lastStepIndex) {
      handleInstall()
      return
    }
    setActiveStep(Math.min(activeStep + 1, lastStepIndex))
  }

  function renderDialogContent(step: SupportedSteps) {
    switch (step) {
      case 'meta':
        return (
          <MetadataStep
            title={title}
            setTitle={setTitle}
            platformSelection={platformSelection}
          >
            <ToggleSwitch
              htmlId="is-visual-novel"
              value={isVisualNovel}
              handleChange={() => setIsVisualNovel(!isVisualNovel)}
              title={t('sideload.info.is-visual-novel', 'Is visual novel')}
              description={t(
                'sideload.info.is-visual-novel-description',
                'Identify this sideloaded game as a visual novel.'
              )}
            />
            {(platform === 'win32' || platform === 'linux') && (
              <ToggleSwitch
                htmlId="jp-locale"
                value={jpLocale}
                handleChange={() => setJpLocale(!jpLocale)}
                title={t('setting.jp-locale', 'JP locale')}
                description={t(
                  platform === 'win32'
                    ? 'setting.jp-locale-description'
                    : 'setting.jp-locale-linux-description',
                  platform === 'win32'
                    ? 'Launch this game through the configured Locale Emulator executable.'
                    : 'Set a Japanese locale and the Asia/Tokyo timezone when launching this game.'
                )}
              />
            )}
            <div className="sideloadActionButtons">
              <Button
                variant="secondary"
                icon={<Icon glyph={List} size="md" />}
                disabled={!app_name}
                onClick={() => setShowCategories(true)}
              >
                {t('submenu.categories', 'Categories')}
              </Button>
              <Button
                variant="secondary"
                icon={<Icon glyph={FolderOpen} size="md" />}
                disabled={!directoryToOpen}
                onClick={() => window.api.openFolder(directoryToOpen)}
              >
                {t('sideload.open-directory', 'Open directory')}
              </Button>
            </div>
          </MetadataStep>
        )
      case 'images':
        return (
          <ImagesStep
            title={title}
            backdropClick={backdropClick}
            imageUrl={imageUrl}
            setImageUrl={setImageUrl}
            heroUrl={heroUrl}
            setHeroUrl={setHeroUrl}
            hasSgdbKey={hasSgdbKey}
            includeVndb={enableVndbIntegration && isVisualNovel}
          />
        )
      case 'compat':
        return <div className="sideloadCompatForm">{wineSelector}</div>
      case 'install':
        return (
          <InstallationStep
            appName={app_name}
            title={title}
            runningSetup={runningSetup}
            handleRunExe={handleRunExe}
            onSkip={handleNextStepClick}
            onFinish={handleNextStepClick}
          />
        )
      case 'finish':
        return (
          <FinishStep
            appPlatform={appPlatform}
            gameUrl={gameUrl}
            setGameUrl={setGameUrl}
            customUserAgent={customUserAgent}
            setCustomUserAgent={setCustomUserAgent}
            launchFullScreen={launchFullScreen}
            setLaunchFullScreen={setLaunchFullScreen}
            winePrefix={winePrefix}
            defaultPath={defaultPath}
            wineVersion={wineVersion}
            selectedExe={selectedExe}
            setSelectedExe={setSelectedExe}
            fileFilters={fileFilters}
          />
        )
    }
  }

  const showNextButton = useMemo(() => {
    const step = flowSteps[activeStep]
    if (step === 'install') return false
    return true
  }, [flowSteps, activeStep])

  const noAppEntryPoint =
    (appPlatform !== 'Browser' && !selectedExe) ||
    (appPlatform === 'Browser' && !gameUrl)

  const lastStep = lastStepIndex === activeStep

  return (
    <>
      <ModalContent className="sideloadDialog">
        <Stepper
          className="sideloadStepper"
          activeStep={activeStep}
          steps={flowSteps.map((step) => stepInfo[step])}
        />
        <div className="stepContentRenderer">
          {renderDialogContent(flowSteps[activeStep])}
        </div>
      </ModalContent>
      <ModalFooter className="sideload">
        <div className="sideloadFooterMetadata">
          {title}
          {platformIcon()}
        </div>
        <div className="sideloadFooterButtons">
          <Button
            variant="ghost"
            onClick={handlePreviousStepClick}
            disabled={addingApp || runningSetup || activeStep === 0}
          >
            {t('button.back', 'Back')}
          </Button>
          {showNextButton && (
            <Button
              variant="primary"
              onClick={handleNextStepClick}
              disabled={
                (lastStep && noAppEntryPoint) || addingApp || runningSetup
              }
            >
              {lastStep
                ? t('button.finish', 'Finish')
                : t('button.next', 'Next')}
            </Button>
          )}
        </div>
      </ModalFooter>
      {enableVndbIntegration && vndbSyncGame && (
        <VndbSyncButton
          list={[vndbSyncGame]}
          autoOpen
          hideTrigger
          onClose={backdropClick}
        />
      )}
      {showCategories && (
        <CategoriesManager
          games={[getSideloadGameInfo()]}
          onClose={() => setShowCategories(false)}
        />
      )}
    </>
  )
}
