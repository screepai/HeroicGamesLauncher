import { Runner } from './types'

export const storeMap: { [key in Runner]: string | undefined } = {
  legendary: 'epic',
  gog: 'gog',
  nile: 'amazon',
  sideload: undefined,
  zoom: 'zoom'
}

export function isWindowsPlatform(platform?: string): boolean {
  return ['windows', 'win32'].includes(platform?.toLocaleLowerCase() ?? '')
}
