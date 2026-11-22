import { describe, expect, it } from 'vitest'
import { isValidProjectKey, suggestProjectKey } from './projectKey'

describe('suggestProjectKey', () => {
  it.each([
    ['Website', 'WEB'],
    ['  website  ', 'WEB'],
    ['Mobile App', 'MA'],
    ['Marketing site and signup flow', 'MSASF'],
    ['R&D', 'RD'],
    ['Café Ünïcode', 'CU'],
    ['Q4', 'Q4'],
    ['Web 2', 'W2'],
    ['2026 Roadmap', 'ROA'],
    ['a b c d e f g h i j k l', 'ABCDEFGHIJ'],
    ['X', ''],
    ['42', ''],
    ['!!!', ''],
    ['', ''],
  ])('%j -> %j', (name, key) => {
    expect(suggestProjectKey(name)).toBe(key)
  })

  it('always suggests a valid key or nothing', () => {
    for (const name of ['Website', 'Mobile App', '2026 Roadmap', 'a1 b2', 'Ops', 'x y']) {
      const key = suggestProjectKey(name)
      expect(key === '' || isValidProjectKey(key)).toBe(true)
    }
  })
})

describe('isValidProjectKey', () => {
  it.each(['WEB', 'AB', 'A1', 'ABCDEFGHIJ', 'Q4X9'])('accepts %j', (key) => {
    expect(isValidProjectKey(key)).toBe(true)
  })

  it.each(['', 'A', 'web', 'Web', '1AB', 'AB-1', 'A B', 'ABCDEFGHIJK'])('rejects %j', (key) => {
    expect(isValidProjectKey(key)).toBe(false)
  })
})
