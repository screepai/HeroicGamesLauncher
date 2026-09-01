const offlineDefaults = {
  // UMU still performs an HTTP probe before honoring the update flag, so the
  // retry and timeout limits are needed when a network route exists but the
  // internet or DNS is unavailable.
  UMU_RUNTIME_UPDATE: '0',
  UMU_HTTP_RETRIES: '0',
  UMU_HTTP_TIMEOUT: '1'
}

export function getUmuEnvironment(
  offline: boolean,
  currentEnvironment: NodeJS.ProcessEnv = process.env
): Record<string, string> {
  if (!offline) {
    return {}
  }

  return Object.fromEntries(
    Object.entries(offlineDefaults).map(([key, defaultValue]) => [
      key,
      currentEnvironment[key] ?? defaultValue
    ])
  )
}
