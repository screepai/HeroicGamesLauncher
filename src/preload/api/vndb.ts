import { makeHandlerInvoker } from '../ipc'

export const vndb = {
  hasApiToken: makeHandlerInvoker('vndb.hasApiToken'),
  setApiToken: makeHandlerInvoker('vndb.setApiToken'),
  searchVisualNovels: makeHandlerInvoker('vndb.searchVisualNovels'),
  matchGames: makeHandlerInvoker('vndb.matchGames'),
  syncGameMatches: makeHandlerInvoker('vndb.syncGameMatches'),
  getGameMatch: makeHandlerInvoker('vndb.getGameMatch'),
  getAllGameMatches: makeHandlerInvoker('vndb.getAllGameMatches'),
  getUserOptions: makeHandlerInvoker('vndb.getUserOptions'),
  updateUserOptions: makeHandlerInvoker('vndb.updateUserOptions'),
  updateUserRelease: makeHandlerInvoker('vndb.updateUserRelease'),
  syncUserData: makeHandlerInvoker('vndb.syncUserData')
}
