import { app } from 'electron'
import { VndbClient } from 'vndb-kana-api'

export const vndbClient = new VndbClient({
  userAgent: `HeroicGamesLauncher/${app.getVersion()}`
})
