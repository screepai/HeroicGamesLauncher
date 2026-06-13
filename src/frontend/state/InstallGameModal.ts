import { GameInfo, Runner } from 'common/types'
import { create } from 'zustand'

interface InstallGameModalState {
  isOpen: boolean
  appName?: string
  runner?: Runner
  gameInfo: GameInfo | null
  action?: 'install' | 'import'
  sideloadTitle?: string
}

export const useInstallGameModal = create<InstallGameModalState>()(() => ({
  isOpen: false,
  gameInfo: null,
  action: 'install'
}))

interface OpenInstallGameModalParams {
  appName: string
  runner: Runner
  gameInfo: GameInfo | null
  action?: 'install' | 'import'
  sideloadTitle?: string
}
export const openInstallGameModal = ({
  appName,
  runner,
  gameInfo,
  action = 'install',
  sideloadTitle
}: OpenInstallGameModalParams) => {
  useInstallGameModal.setState({
    isOpen: true,
    appName,
    runner,
    gameInfo,
    action,
    sideloadTitle
  })
}

export const closeInstallGameModal = () => {
  useInstallGameModal.setState({
    isOpen: false,
    sideloadTitle: undefined
  })
}
