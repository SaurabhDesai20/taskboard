import { describe, expect, it } from 'vitest'
import { redirectTargetFrom } from './redirect'

describe('redirectTargetFrom', () => {
  it('returns the remembered path with its query and hash', () => {
    expect(
      redirectTargetFrom({ from: { pathname: '/w/acme', search: '?tab=board', hash: '#t-1' } }),
    ).toBe('/w/acme?tab=board#t-1')
  })

  it.each([
    ['no state', null],
    ['no from', {}],
    ['a non-string path', { from: { pathname: 42 } }],
    ['a relative path', { from: { pathname: 'w/acme' } }],
    ['a protocol-relative URL', { from: { pathname: '//evil.example.com' } }],
    ['the login page', { from: { pathname: '/login' } }],
    ['the register page', { from: { pathname: '/register' } }],
  ])('falls back to / for %s', (_label, state) => {
    expect(redirectTargetFrom(state)).toBe('/')
  })
})
