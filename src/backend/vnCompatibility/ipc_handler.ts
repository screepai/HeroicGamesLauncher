import { app } from 'electron'

import { addHandler } from 'backend/ipc'
import { getVnCompatibility } from '.'
import { installSpecialCodecs, stopSpecialCodecsInstall } from './codecs'
import { createDedicatedPrefix } from './prefixes'

addHandler('vnCompatibility.get', (_event, args) =>
  getVnCompatibility(args.titles, args.engine)
)

addHandler('vnCompatibility.installCodecs', (_event, args) =>
  installSpecialCodecs(args)
)

// Do not leave the codec helper (and wine) running after the app quits
app.on('before-quit', stopSpecialCodecsInstall)

addHandler('vnCompatibility.createDedicatedPrefix', (_event, args) =>
  createDedicatedPrefix(args)
)
