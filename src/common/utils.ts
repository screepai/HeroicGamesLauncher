import { Runner } from './types'

export const storeMap = {
  legendary: 'epic',
  gog: 'gog',
  nile: 'amazon',
  sideload: undefined,
  zoom: 'zoom',
  itchio: 'itchio',
  steam: 'steam'
} as const satisfies Record<Runner, string | undefined>

export function isWindowsPlatform(platform?: string): boolean {
  return ['windows', 'win32'].includes(platform?.toLocaleLowerCase() ?? '')
}

// Sentinel `Reqs.title` values for rows that aren't a Minimum/Recommended spec
export const REQS_OTHER_TITLE = '__other__'
export const REQS_NOTES_TITLE = '__notes__'
