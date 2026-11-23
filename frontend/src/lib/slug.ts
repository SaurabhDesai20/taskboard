// Workspace slugs (contract 1.8 and 3.3). Shared by the create form and the MSW mock.

export const SLUG_MAX_LENGTH = 48
export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/
export const DEFAULT_SLUG = 'workspace'

function trimHyphens(value: string): string {
  return value.replace(/^-+|-+$/g, '')
}

/**
 * The slug the server derives from a name when none is given: lowercase, every run of
 * characters other than a-z and 0-9 becomes one `-`, trimmed, at most 48 characters,
 * `"workspace"` if nothing is left. (The server may append `-2`, `-3`, ... when it is taken.)
 */
export function deriveSlug(name: string): string {
  const slug = trimHyphens(trimHyphens(name.toLowerCase().replace(/[^a-z0-9]+/g, '-')).slice(0, SLUG_MAX_LENGTH))
  return slug || DEFAULT_SLUG
}

export function isValidSlug(value: string): boolean {
  return value.length <= SLUG_MAX_LENGTH && SLUG_PATTERN.test(value)
}
