import { frontendListenerSlot, makeHandlerInvoker } from '../ipc'

export const vndb = {
  hasApiToken: makeHandlerInvoker('vndb.hasApiToken'),
  setApiToken: makeHandlerInvoker('vndb.setApiToken'),
  searchVisualNovels: makeHandlerInvoker('vndb.searchVisualNovels'),
  matchGames: makeHandlerInvoker('vndb.matchGames'),
  cancelMatchGames: makeHandlerInvoker('vndb.cancelMatchGames'),
  onMatchGamesProgress: frontendListenerSlot('vndbMatchGamesProgress'),
  syncGameMatches: makeHandlerInvoker('vndb.syncGameMatches'),
  getGameMatch: makeHandlerInvoker('vndb.getGameMatch'),
  hydrateMatch: makeHandlerInvoker('vndb.hydrateMatch'),
  getAllGameMatches: makeHandlerInvoker('vndb.getAllGameMatches'),
  getUserOptions: makeHandlerInvoker('vndb.getUserOptions'),
  updateUserOptions: makeHandlerInvoker('vndb.updateUserOptions'),
  updateUserRelease: makeHandlerInvoker('vndb.updateUserRelease'),
  syncUserData: makeHandlerInvoker('vndb.syncUserData'),
  cancelSyncUserData: makeHandlerInvoker('vndb.cancelSyncUserData'),
  onSyncUserDataProgress: frontendListenerSlot('vndbSyncUserDataProgress'),
  onMatchesChanged: frontendListenerSlot('vndbMatchesChanged')
}
