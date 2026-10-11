import { Runner } from './types'

export const storeMap = {
  legendary: 'epic',
  gog: 'gog',
  nile: 'amazon',
  sideload: undefined,
  zoom: 'zoom'
} as const satisfies Record<Runner, string | undefined>

export function isWindowsPlatform(platform?: string): boolean {
  return ['windows', 'win32'].includes(platform?.toLocaleLowerCase() ?? '')
}
