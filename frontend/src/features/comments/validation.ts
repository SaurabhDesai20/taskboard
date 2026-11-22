// Client-side check for comment bodies (contract 1.8: trimmed, then 1 to 5000 characters). The
// server validates again; its 422 is shown on the same field.
import { charLength } from '../../lib/validation'

export const COMMENT_BODY_MAX_LENGTH = 5000

/** Form field name, matching the API field so 422 entries map onto it. */
export const COMMENT_FIELDS = ['body'] as const

export function validateCommentBody(raw: string): string | undefined {
  const length = charLength(raw.trim())
  if (length === 0) return 'Enter a comment'
  if (length > COMMENT_BODY_MAX_LENGTH) {
    return `Comment must be at most ${COMMENT_BODY_MAX_LENGTH} characters (it has ${length})`
  }
  return undefined
}
