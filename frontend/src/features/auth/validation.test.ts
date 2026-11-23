import { describe, expect, it } from 'vitest'
import { normalizeRegister, validateLogin, validateRegister } from './validation'

const valid = { name: 'Asha Rao', email: 'asha@example.com', password: 'correct-horse-battery' }

describe('validateRegister (contract 1.8)', () => {
  it('accepts valid values', () => {
    expect(validateRegister(valid)).toEqual({})
  })

  it.each([
    ['', 'Enter your name'],
    ['   ', 'Enter your name'],
    ['n'.repeat(101), 'Name must be at most 100 characters'],
  ])('rejects the name %j', (name, message) => {
    expect(validateRegister({ ...valid, name })).toEqual({ name: message })
  })

  it('accepts names of 1 and 100 characters (after trimming)', () => {
    expect(validateRegister({ ...valid, name: ' A ' })).toEqual({})
    expect(validateRegister({ ...valid, name: `${'n'.repeat(100)}  ` })).toEqual({})
  })

  it.each([
    ['', 'Enter your email address'],
    ['asha', 'Enter a valid email address'],
    ['asha@example', 'Enter a valid email address'],
    ['asha rao@example.com', 'Enter a valid email address'],
    [`${'a'.repeat(243)}@example.com`, 'Email must be at most 254 characters'],
  ])('rejects the email %j', (email, message) => {
    expect(validateRegister({ ...valid, email })).toEqual({ email: message })
  })

  it.each([
    ['', 'Enter a password'],
    ['1234567', 'Password must be at least 8 characters'],
    ['p'.repeat(129), 'Password must be at most 128 characters'],
  ])('rejects the password %j', (password, message) => {
    expect(validateRegister({ ...valid, password })).toEqual({ password: message })
  })

  it('accepts passwords of 8 and 128 characters, counting spaces (passwords are not trimmed)', () => {
    expect(validateRegister({ ...valid, password: '12345678' })).toEqual({})
    expect(validateRegister({ ...valid, password: ' 123456 ' })).toEqual({})
    expect(validateRegister({ ...valid, password: 'p'.repeat(128) })).toEqual({})
  })

  it('trims name and email but sends the password as typed', () => {
    expect(
      normalizeRegister({ name: ' Asha ', email: ' asha@example.com ', password: ' secret pw ' }),
    ).toEqual({ name: 'Asha', email: 'asha@example.com', password: ' secret pw ' })
  })
})

describe('validateLogin', () => {
  it('requires a valid email and a password, without the length rule', () => {
    expect(validateLogin({ email: 'asha@example.com', password: 'short' })).toEqual({})
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'Enter your email address',
      password: 'Enter your password',
    })
    expect(validateLogin({ email: 'nope', password: 'x' })).toEqual({
      email: 'Enter a valid email address',
    })
  })
})
