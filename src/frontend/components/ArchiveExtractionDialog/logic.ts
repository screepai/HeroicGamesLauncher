const PASSWORD_ERROR_MESSAGE = 'Archive password is required or incorrect'
const INCOMPLETE_ARCHIVE_ERROR_MESSAGE =
  'The archive is incomplete. Add the remaining parts and try again.'
const MISSING_ARCHIVE_PARTS_ERROR_MESSAGE = 'Archive parts are missing:'

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : ''
}

export function isPasswordError(error: unknown): boolean {
  return getErrorMessage(error).includes(PASSWORD_ERROR_MESSAGE)
}

export function isIncompleteArchiveError(error: unknown): boolean {
  return getErrorMessage(error).includes(INCOMPLETE_ARCHIVE_ERROR_MESSAGE)
}

export function isArchivePartsError(error: unknown): boolean {
  return (
    isIncompleteArchiveError(error) ||
    getErrorMessage(error).includes(MISSING_ARCHIVE_PARTS_ERROR_MESSAGE)
  )
}

export function isValidFolderName(folderName: string): boolean {
  const normalizedName = folderName.trim()
  const hasControlCharacter = [...normalizedName].some(
    (character) => character.charCodeAt(0) < 32
  )

  return (
    normalizedName.length > 0 &&
    normalizedName !== '.' &&
    normalizedName !== '..' &&
    !hasControlCharacter &&
    !/[<>:"/\\|?*]/.test(normalizedName) &&
    !/[. ]$/.test(normalizedName)
  )
}
