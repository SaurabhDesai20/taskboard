// Small, framework-free validation helpers shared by the feature forms.

/**
 * A deliberately loose email check: one `@`, no spaces, a dot in the domain. The server's
 * validator is stricter and remains the authority; this only catches obvious typos early.
 */
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export function isValidEmail(value: string): boolean {
  return EMAIL_PATTERN.test(value)
}

/** Length in user-perceived characters, matching how the server counts string length. */
export function charLength(value: string): number {
  return [...value].length
}
