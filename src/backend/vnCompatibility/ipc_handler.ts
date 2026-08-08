import { addHandler } from 'backend/ipc'
import { getVnCompatibility } from '.'
import { installSpecialCodecs } from './codecs'
import { createDedicatedPrefix } from './prefixes'

addHandler('vnCompatibility.get', (_event, args) =>
  getVnCompatibility(args.titles, args.engine)
)

addHandler('vnCompatibility.installCodecs', (_event, args) =>
  installSpecialCodecs(args)
)

addHandler('vnCompatibility.createDedicatedPrefix', (_event, args) =>
  createDedicatedPrefix(args)
)
