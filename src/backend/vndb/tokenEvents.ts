type TokenListener = () => void

const listeners = new Set<TokenListener>()

/** Subscribe to VNDB API token changes. Returns an unsubscribe function. */
export function onVndbApiTokenChanged(listener: TokenListener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function notifyVndbApiTokenChanged(): void {
  for (const listener of listeners) {
    listener()
  }
}
