import { describe, expect, it } from 'vitest'
import { ApiError } from '../api/client'
import { formErrorsFromError, GENERIC_ERROR_MESSAGE } from './formErrors'

const fields = ['email', 'password'] as const

function validationError(errors: unknown[]): ApiError {
  return new ApiError(422, 'validation_error', 'Request validation failed', { errors })
}

describe('formErrorsFromError', () => {
  it('maps 422 body errors to known fields, keeping the first message per field', () => {
    const error = validationError([
      { field: 'email', location: 'body', message: 'value is not a valid email address' },
      { field: 'email', location: 'body', message: 'second message' },
      { field: 'password', location: 'body', message: 'String should have at least 8 characters' },
    ])

    expect(formErrorsFromError(error, { fields })).toEqual({
      fields: {
        email: 'value is not a valid email address',
        password: 'String should have at least 8 characters',
      },
      form: null,
    })
  })

  it('puts unknown fields, whole-body and non-body errors in the form-level message', () => {
    const error = validationError([
      { field: 'email', location: 'body', message: 'Bad email' },
      { field: '', location: 'body', message: 'Input should be a valid dictionary' },
      { field: 'limit', location: 'query', message: 'Too big' },
    ])

    expect(formErrorsFromError(error, { fields })).toEqual({
      fields: { email: 'Bad email' },
      form: 'Input should be a valid dictionary Too big',
    })
  })

  it('falls back to the envelope message when a 422 has no usable details', () => {
    expect(formErrorsFromError(validationError([]), { fields })).toEqual({
      fields: {},
      form: 'Request validation failed',
    })
  })

  it('maps a details.reason to its field', () => {
    const error = new ApiError(409, 'conflict', 'An account with this email already exists', {
      reason: 'email_taken',
    })

    expect(formErrorsFromError(error, { fields, reasonFields: { email_taken: 'email' } })).toEqual({
      fields: { email: 'An account with this email already exists' },
      form: null,
    })
  })

  it('shows other API errors as a form-level message', () => {
    const error = new ApiError(401, 'unauthorized', 'Invalid email or password')

    expect(formErrorsFromError(error, { fields })).toEqual({
      fields: {},
      form: 'Invalid email or password',
    })
  })

  it('uses a generic message for unexpected errors', () => {
    expect(formErrorsFromError(new TypeError('boom'), { fields })).toEqual({
      fields: {},
      form: GENERIC_ERROR_MESSAGE,
    })
  })
})
