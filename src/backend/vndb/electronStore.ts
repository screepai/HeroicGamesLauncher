import { TypeCheckedStoreBackend } from 'backend/electron_store'
import { userDataPath } from 'backend/constants/paths'
import { join } from 'node:path'

export const vndbMatchesStore = new TypeCheckedStoreBackend(
  'vndbMatchesStore',
  {
    cwd: join(userDataPath, 'store'),
    name: 'vndb-matches',
    clearInvalidConfig: true
  }
)
