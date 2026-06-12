import { addHandler } from 'backend/ipc'
import { hasStoredApiToken, setStoredApiToken } from './client'
import {
  getAllVndbGameMatches,
  getVndbUserOptions,
  getVndbGameMatch,
  matchVndbGames,
  searchVndbVisualNovels,
  syncVndbGameMatches,
  updateVndbUserRelease,
  updateVndbUserOptions
} from '.'

addHandler('vndb.hasApiToken', () => hasStoredApiToken())

addHandler('vndb.setApiToken', (_event, token) => {
  setStoredApiToken(token)
})

addHandler('vndb.searchVisualNovels', async (_event, args) =>
  searchVndbVisualNovels(args.query, args.limit)
)

addHandler('vndb.matchGames', async (_event, games) => matchVndbGames(games))

addHandler('vndb.syncGameMatches', (_event, updates) =>
  syncVndbGameMatches(updates)
)

addHandler('vndb.getGameMatch', (_event, args) =>
  getVndbGameMatch(args.appName, args.runner)
)

addHandler('vndb.getAllGameMatches', () => getAllVndbGameMatches())

addHandler('vndb.getUserOptions', (_event, args) =>
  getVndbUserOptions(args.vnId)
)

addHandler('vndb.updateUserOptions', (_event, args) =>
  updateVndbUserOptions(args.vnId, args.update)
)

addHandler('vndb.updateUserRelease', (_event, args) =>
  updateVndbUserRelease(args.releaseId, args.selected)
)
