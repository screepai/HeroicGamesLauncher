import './index.scss'
import short from 'short-uuid'
import { faSpinner, faSearch } from '@fortawesome/free-solid-svg-icons'
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome'
import { InstallPlatform, WineInstallation, GameInfo } from 'common/types'
import {
  CachedImage,
  TextInputField,
  PathSelectionBox,
  ToggleSwitch,
  InfoBox,
  SteamGridDBPicker,
  WarningMessage
} from 'frontend/components/UI'
import { DialogContent, DialogFooter } from 'frontend/components/UI/Dialog'
import {
  getGameInfo,
  getGameSettings,
  removeSpecialcharacters,
  writeConfig
} from 'frontend/helpers'
import React, {
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState
} from 'react'
import { Trans, useTranslation } from 'react-i18next'
import { AvailablePlatforms } from '..'
import fallbackImage from 'frontend/assets/heroic_card.jpg'
import ContextProvider from 'frontend/state/ContextProvider'
import classNames from 'classnames'
import axios from 'axios'
import { NavLink, useNavigate } from 'react-router-dom'
import TextInputWithIconField from 'frontend/components/UI/TextInputWithIconField'
import Folder from '@mui/icons-material/Folder'
import FolderOpen from '@mui/icons-material/FolderOpen'
import List from '@mui/icons-material/List'
import VndbSyncButton from '../../LibraryHeader/VndbSyncButton'
import CategoriesManager from '../../CategoriesManager'
import useAppSetting from 'frontend/hooks/useAppSetting'

type Props = {
  availablePlatforms: AvailablePlatforms
  winePrefix: string
  wineVersion: WineInstallation | undefined
  children: React.ReactNode
  platformToInstall: InstallPlatform
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

export default function SideloadDialog({
  availablePlatforms,
  backdropClick,
  winePrefix,
  wineVersion,
  platformToInstall,
  children,
  appName,
  title,
  setTitle,
  defaultPath
}: Props) {
  const { t, i18n } = useTranslation('gamepage')
  const enableVndbIntegration = useAppSetting('enableVndbIntegration', true)
  const [selectedExe, setSelectedExe] = useState('')
  const [gameUrl, setGameUrl] = useState('')
  const [customUserAgent, setCustomUserAgent] = useState('')
  const [launchFullScreen, setLaunchFullScreen] = useState(false)
  const [isVisualNovel, setIsVisualNovel] = useState(false)
  const [jpLocale, setJpLocale] = useState(false)
  const [imageUrl, setImageUrl] = useState('')
  const [heroUrl, setHeroUrl] = useState('')
  const [searching, setSearching] = useState(false)
  const [imageLoading, setImageLoading] = useState(false)
  const [app_name, setApp_name] = useState(appName ?? '')
  const [runningSetup, setRunningSetup] = useState(false)
  const [gameInfo, setGameInfo] = useState<Partial<GameInfo>>({})
  const [addingApp, setAddingApp] = useState(false)
  const [vndbSyncGame, setVndbSyncGame] = useState<GameInfo | null>(null)
  const [showCategories, setShowCategories] = useState(false)
  const [sgdbTarget, setSgdbTarget] = useState<'cover' | 'square' | null>(null)
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

  const navigate = useNavigate()
  const goToAdvancedSettings = () => {
    backdropClick()
    navigate('/settings/advanced')
  }

  function handleTitle(value: string) {
    value = removeSpecialcharacters(value)
    setTitle(value)
  }

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

        console.log(launchFullScreen)
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

  async function searchImage() {
    if (hasSgdbKey || !title.trim()) {
      return
    }

    setSearching(true)

    try {
      if (enableVndbIntegration && isVisualNovel) {
        try {
          const vndbResults = await window.api.vndb.searchVisualNovels({
            query: title,
            limit: 5
          })
          const vndbImage = vndbResults.find(
            (result) => result.imageUrl
          )?.imageUrl

          if (vndbImage) {
            setImageLoading(true)
            setImageUrl(vndbImage)
            return
          }
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error)
          window.api.logError(`VNDB cover search failed: ${message}`)
        }
      }

      try {
        const response = await axios.get(
          `https://steamgrid.usebottles.com/api/search/${title}`,
          { timeout: 3500 }
        )

        if (response.status === 200) {
          const steamGridImage = response.data as string

          if (steamGridImage && steamGridImage.startsWith('http')) {
            setImageUrl(steamGridImage)
          }
        } else {
          throw new Error('Fetch failed')
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        window.api.logError(message)
      }
    } finally {
      setSearching(false)
    }
  }

  async function handleSelectLocalImage(target: 'cover' | 'square') {
    const path = await window.api.openDialog({
      buttonLabel: t('box.select.button', 'Select'),
      properties: ['openFile'],
      title: t('box.select.image', 'Select Image'),
      filters: [
        {
          name: 'Images',
          extensions: ['jpg', 'jpeg', 'png', 'webp', 'gif', 'avif']
        },
        { name: 'All', extensions: ['*'] }
      ]
    })

    if (!path) return
    if (target === 'cover') setHeroUrl(`file://${path}`)
    else setImageUrl(`file://${path}`)
  }

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
      await writeConfig({
        appName: app_name,
        config: { ...gameSettings, jpLocale }
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
          config: { ...gameSettings, winePrefix, wineVersion }
        })
        await window.api.runWineCommand({
          commandParts: [exeToRun],
          wait: true,
          protonVerb: 'runinprefix',
          gameSettings: {
            ...gameSettings,
            winePrefix,
            wineVersion: wineVersion || gameSettings.wineVersion
          }
        })
        setRunningSetup(false)
      } catch (error) {
        console.log('finished with error', error)
        setRunningSetup(false)
      }
    }
    return
  }

  function handleGameUrl(url: string) {
    if (!url.startsWith('https://')) {
      return setGameUrl(`https://${url}`)
    }

    setGameUrl(url)
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

  const showSideloadExe = appPlatform !== 'Browser'
  const executableDirectory = getParentDirectory(selectedExe)
  const directoryToOpen = executableDirectory || defaultPath || ''

  const shouldShowRunExe =
    platform !== 'win32' &&
    appPlatform !== 'Mac' &&
    appPlatform !== 'linux' &&
    appPlatform !== 'Browser'

  return (
    <>
      <DialogContent>
        <div className="sideloadGrid">
          <div className="imageIcons">
            <div
              className={classNames('appImageContainer', {
                hasSgdbKey:
                  hasSgdbKey || (enableVndbIntegration && isVisualNovel),
                searching,
                loading: imageLoading
              })}
              onClick={() =>
                (hasSgdbKey || (enableVndbIntegration && isVisualNovel)) &&
                setSgdbTarget('square')
              }
            >
              <CachedImage
                className={classNames('appImage', {
                  blackWhiteImage: searching
                })}
                src={imageUrl ? imageUrl : fallbackImage}
                onLoad={() => setImageLoading(false)}
                onError={() => setImageLoading(false)}
              />
              {(searching || imageLoading) && (
                <div className="imageLoadingOverlay">
                  <FontAwesomeIcon icon={faSpinner} spin size="3x" />
                </div>
              )}
              {(hasSgdbKey || (enableVndbIntegration && isVisualNovel)) &&
                !searching &&
                !imageLoading && (
                  <div className="imageHoverOverlay">
                    <FontAwesomeIcon icon={faSearch} size="3x" />
                  </div>
                )}
            </div>
            <div
              className={classNames('appImageContainer heroImageContainer', {
                hasSgdbKey
              })}
              onClick={() => hasSgdbKey && setSgdbTarget('cover')}
            >
              <CachedImage
                className="appImage heroImage"
                src={heroUrl || imageUrl || fallbackImage}
              />
              {hasSgdbKey && (
                <div className="imageHoverOverlay">
                  <FontAwesomeIcon icon={faSearch} size="3x" />
                </div>
              )}
            </div>
            <span className="titleIcon">
              {title}
              {platformIcon()}
            </span>
          </div>
          <div className="sideloadForm">
            {sgdbTarget ? (
              <SteamGridDBPicker
                initialTitle={title}
                mode={sgdbTarget === 'cover' ? 'heroes' : 'grids'}
                includeVndb={
                  enableVndbIntegration &&
                  isVisualNovel &&
                  sgdbTarget === 'square'
                }
                enableSteamGridDb={hasSgdbKey}
                onClose={() => setSgdbTarget(null)}
                onSelect={(url: string) => {
                  if (sgdbTarget === 'cover') {
                    setHeroUrl(url)
                  } else if (url !== imageUrl) {
                    setImageLoading(true)
                    setImageUrl(url)
                  }
                  setSgdbTarget(null)
                }}
              />
            ) : (
              <>
                <InfoBox
                  text={t(
                    'sideload.import-hint.title',
                    'Important! Are you adding a game from Epic/GOG/Amazon? Click here!'
                  )}
                >
                  <div className="sideloadImportHint">
                    <Trans i18n={i18n} key="sideload.import-hint.content">
                      Do NOT use this feature for that.
                      <br />
                      Instead, <NavLink to={'/login'}>log into</NavLink> the
                      store, look for the game in your library, open the
                      installation dialog, and click the &quot;Import Game&quot;
                      button
                    </Trans>
                  </div>
                </InfoBox>
                <TextInputField
                  label={t('sideload.info.title', 'Game/App Title')}
                  placeholder={t(
                    'sideload.placeholder.title',
                    'Add a title to your Game/App'
                  )}
                  onChange={(newValue) => handleTitle(newValue)}
                  onBlur={async () => searchImage()}
                  htmlId="sideload-title"
                  value={title}
                  maxLength={40}
                />
                <ToggleSwitch
                  htmlId="is-visual-novel"
                  value={isVisualNovel}
                  handleChange={() => setIsVisualNovel(!isVisualNovel)}
                  title={t('sideload.info.is-visual-novel', 'Is Visual Novel')}
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
                  <button
                    type="button"
                    className="button is-secondary sideloadActionButton"
                    disabled={!app_name}
                    onClick={() => setShowCategories(true)}
                  >
                    <List />
                    {t('submenu.categories', 'Categories')}
                  </button>
                  <button
                    type="button"
                    className="button is-secondary sideloadActionButton"
                    disabled={!directoryToOpen}
                    onClick={() => window.api.openFolder(directoryToOpen)}
                  >
                    <FolderOpen />
                    {t('sideload.open-directory', 'Open Directory')}
                  </button>
                </div>
                <details className="advancedFields">
                  <summary>{t('sideload.images.summary', 'Images')}</summary>
                  <TextInputWithIconField
                    label={t(
                      'sideload.info.image-hint',
                      isVisualNovel
                        ? 'Square Art (click on the image to search covers)'
                        : 'Square Art (click on the image to search on SteamGridDB)'
                    )}
                    placeholder={t(
                      'sideload.placeholder.image',
                      'Paste an URL of an Image or select one from your computer'
                    )}
                    onChange={(newValue: string) => setImageUrl(newValue)}
                    htmlId="sideload-image"
                    value={imageUrl}
                    icon={<Folder />}
                    onIconClick={() => handleSelectLocalImage('square')}
                  />
                  <div className="imageSearchActions">
                    <button
                      type="button"
                      className="button is-secondary is-small"
                      disabled={
                        (!hasSgdbKey &&
                          !(enableVndbIntegration && isVisualNovel)) ||
                        !title.trim()
                      }
                      onClick={() => {
                        setSgdbTarget('square')
                      }}
                    >
                      {enableVndbIntegration && isVisualNovel
                        ? t('sideload.images.search-covers', 'Search Covers')
                        : t(
                            'sideload.images.search-steamgriddb',
                            'Search SteamGridDB'
                          )}
                    </button>
                  </div>
                  <TextInputWithIconField
                    label={t(
                      'sideload.info.cover-hint',
                      'Cover/Hero Art (click on the image to search on SteamGridDB)'
                    )}
                    placeholder={t(
                      'sideload.placeholder.image',
                      'Paste an URL of an Image or select one from your computer'
                    )}
                    onChange={(newValue: string) => setHeroUrl(newValue)}
                    htmlId="sideload-cover"
                    value={heroUrl}
                    icon={<Folder />}
                    onIconClick={() => handleSelectLocalImage('cover')}
                  />
                </details>
                {!hasSgdbKey && (
                  <WarningMessage>
                    {t(
                      'edit-game.sgdb.no-key-prefix',
                      'To search SteamGridDB for cover art, add an API key in'
                    )}{' '}
                    <a
                      role="button"
                      tabIndex={0}
                      onClick={goToAdvancedSettings}
                      className="sgdbWarningLink"
                    >
                      {t('edit-game.sgdb.no-key-link', 'Settings → Advanced')}
                    </a>
                    .
                  </WarningMessage>
                )}
                {!editMode && children}
                {showSideloadExe && (
                  <PathSelectionBox
                    type="file"
                    onPathChange={setSelectedExe}
                    path={selectedExe}
                    placeholder={t('sideload.info.exe', 'Select Executable')}
                    pathDialogTitle={t('box.sideload.exe', 'Select Executable')}
                    pathDialogDefaultPath={
                      selectedExe || defaultPath || winePrefix
                    }
                    pathDialogFilters={fileFilters(platformToInstall)}
                    htmlId="sideload-exe"
                    label={t('sideload.info.exe', 'Select Executable')}
                    noDeleteButton
                  />
                )}
                {!showSideloadExe && (
                  <>
                    <TextInputField
                      label={t('sideload.info.broser', 'BrowserURL')}
                      placeholder={t(
                        'sideload.placeholder.url',
                        'Paste the Game URL here'
                      )}
                      onChange={(newValue: string) => handleGameUrl(newValue)}
                      htmlId="sideload-game-url"
                      value={gameUrl}
                    />
                    <TextInputField
                      label={t('sideload.info.useragent', 'Custom User Agent')}
                      placeholder={t(
                        'sideload.placeholder.useragent',
                        'Write a custom user agent here to be used on this browser app/game'
                      )}
                      onChange={(newValue: string) =>
                        setCustomUserAgent(newValue)
                      }
                      htmlId="sideload-user-agent"
                      value={customUserAgent}
                    />
                    <ToggleSwitch
                      htmlId="launch-fullscreen"
                      value={launchFullScreen}
                      handleChange={() =>
                        setLaunchFullScreen(!launchFullScreen)
                      }
                      title={t(
                        'sideload.info.fullscreen',
                        'Launch Fullscreen (F11 to exit)'
                      )}
                    />
                  </>
                )}
              </>
            )}
          </div>
        </div>
      </DialogContent>
      <DialogFooter>
        {shouldShowRunExe && (
          <button
            onClick={async () => handleRunExe()}
            className={`button is-secondary`}
            disabled={runningSetup || !title.length}
          >
            {runningSetup
              ? t('button.running-setup', 'Running Setup')
              : t('button.run-exe-first', 'Run Installer First')}
          </button>
        )}
        <button
          onClick={async () => handleInstall()}
          className={`button is-success`}
          disabled={(!selectedExe.length && !gameUrl) || addingApp || searching}
        >
          {addingApp && <FontAwesomeIcon icon={faSpinner} spin />}
          {!addingApp && t('button.finish', 'Finish')}
        </button>
      </DialogFooter>
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
