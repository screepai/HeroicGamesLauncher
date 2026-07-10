import { addHandler } from 'backend/ipc'
import { getVnCompatibility } from '.'

addHandler('vnCompatibility.get', (_event, args) =>
  getVnCompatibility(args.titles, args.engine)
)
