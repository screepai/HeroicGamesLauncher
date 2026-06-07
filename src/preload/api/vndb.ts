import { makeHandlerInvoker } from '../ipc'

export const vndb = {
  searchVisualNovels: makeHandlerInvoker('vndb.searchVisualNovels'),
  matchGames: makeHandlerInvoker('vndb.matchGames'),
  syncGameMatches: makeHandlerInvoker('vndb.syncGameMatches'),
  getGameMatch: makeHandlerInvoker('vndb.getGameMatch'),
  getAllGameMatches: makeHandlerInvoker('vndb.getAllGameMatches')
}
