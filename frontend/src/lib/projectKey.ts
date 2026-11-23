// Project keys (contract 1.8): 2 to 10 uppercase letters and digits, starting with a letter.
// Shared by the create form and the MSW mock.

export const PROJECT_KEY_MIN_LENGTH = 2
export const PROJECT_KEY_MAX_LENGTH = 10
export const PROJECT_KEY_PATTERN = /^[A-Z][A-Z0-9]{1,9}$/

/** Letters of a single-word name used for its key ("Website" -> "WEB"). */
const SINGLE_WORD_KEY_LENGTH = 3

export function isValidProjectKey(value: string): boolean {
  return PROJECT_KEY_PATTERN.test(value)
}

/** Uppercase A-Z/0-9 words of a name, with accents dropped ("Café app" -> ["CAFE", "APP"]). */
function wordsOf(name: string): string[] {
  return name
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toUpperCase()
    .split(/[^A-Z0-9]+/)
    .filter(Boolean)
}

function startingWithLetter(value: string): string {
  return value.replace(/^[0-9]+/, '')
}

/**
 * A key suggested for a new project's name: the initials of a multi-word name ("Mobile App" ->
 * "MA"), or the first three letters of a single word ("Website" -> "WEB"). Leading digits are
 * dropped so the key starts with a letter. Returns "" when the name gives no valid key; the
 * user then types one. Only a suggestion: the server checks the key and its uniqueness.
 */
export function suggestProjectKey(name: string): string {
  const words = wordsOf(name)
  if (words.length === 0) return ''
  const initials = startingWithLetter(words.length > 1 ? words.map((word) => word[0]).join('') : '')
  if (initials.length >= PROJECT_KEY_MIN_LENGTH) return initials.slice(0, PROJECT_KEY_MAX_LENGTH)
  const letters = startingWithLetter(words.join('')).slice(0, SINGLE_WORD_KEY_LENGTH)
  return letters.length >= PROJECT_KEY_MIN_LENGTH ? letters : ''
}
