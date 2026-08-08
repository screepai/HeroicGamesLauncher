import { frontendListenerSlot, makeHandlerInvoker } from '../ipc'

export const vnCompatibility = {
  get: makeHandlerInvoker('vnCompatibility.get'),
  installCodecs: makeHandlerInvoker('vnCompatibility.installCodecs'),
  createDedicatedPrefix: makeHandlerInvoker('vnCompatibility.createDedicatedPrefix'),
  onCodecProgress: frontendListenerSlot('vnCompatibility.codecProgress')
}
