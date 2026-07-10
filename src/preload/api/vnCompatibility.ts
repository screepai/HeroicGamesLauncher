import { makeHandlerInvoker } from '../ipc'

export const vnCompatibility = {
  get: makeHandlerInvoker('vnCompatibility.get')
}
