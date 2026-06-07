import { addHandler } from 'backend/ipc'
import {
  getAllVndbGameMatches,
  getVndbGameMatch,
  matchVndbGames,
  searchVndbVisualNovels,
  syncVndbGameMatches
} from '.'

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
