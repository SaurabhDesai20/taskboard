import { describe, expect, it } from 'vitest'
import { COMMENT_BODY_MAX_LENGTH, validateCommentBody } from './validation'

describe('validateCommentBody (1 to 5000 characters after trimming)', () => {
  it('needs some text', () => {
    expect(validateCommentBody('')).toBe('Enter a comment')
    expect(validateCommentBody(' \n\t ')).toBe('Enter a comment')
  })

  it('accepts 1 to 5000 characters, counting the trimmed text', () => {
    expect(validateCommentBody('x')).toBeUndefined()
    expect(validateCommentBody(`  ${'x'.repeat(COMMENT_BODY_MAX_LENGTH)}  `)).toBeUndefined()
    expect(validateCommentBody('Line one\nLine two')).toBeUndefined()
  })

  it('counts characters, not UTF-16 units, like the server', () => {
    expect(validateCommentBody('\u{1F600}'.repeat(COMMENT_BODY_MAX_LENGTH))).toBeUndefined()
  })

  it('refuses more than 5000 characters and says how many there are', () => {
    expect(validateCommentBody('x'.repeat(COMMENT_BODY_MAX_LENGTH + 1))).toBe(
      'Comment must be at most 5000 characters (it has 5001)',
    )
  })
})
