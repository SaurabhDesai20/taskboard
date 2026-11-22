import { describe, expect, it } from 'vitest'
import { deriveSlug, isValidSlug } from './slug'

describe('deriveSlug', () => {
  it.each([
    ['Acme', 'acme'],
    ['  Acme Inc.  ', 'acme-inc'],
    ['R&D -- Team 7', 'r-d-team-7'],
    ['Café Ünïcode', 'caf-n-code'],
    ['!!!', 'workspace'],
    ['', 'workspace'],
  ])('%j -> %j', (name, slug) => {
    expect(deriveSlug(name)).toBe(slug)
  })

  it('cuts at 48 characters without leaving a trailing hyphen', () => {
    const slug = deriveSlug(`${'a'.repeat(47)} b`)
    expect(slug).toBe('a'.repeat(47))
    expect(deriveSlug('x'.repeat(60))).toHaveLength(48)
  })
})

describe('isValidSlug', () => {
  it.each(['acme', 'acme-inc', 'a1-b2-c3', 'x'.repeat(48)])('accepts %j', (slug) => {
    expect(isValidSlug(slug)).toBe(true)
  })

  it.each(['', 'Acme', '-acme', 'acme-', 'ac--me', 'ac me', 'x'.repeat(49)])('rejects %j', (slug) => {
    expect(isValidSlug(slug)).toBe(false)
  })
})
