// Contract section 3.2 (Auth). The session lives in mocks/db.ts instead of a cookie.
import { http, HttpResponse } from 'msw'
import type { User } from '../../api/types'
import { isValidEmail } from '../../lib/validation'
import { createUser, db, findUserByEmail, toUser } from '../db'
import {
  API,
  errorResponse,
  readJsonObject,
  reasonError,
  requireUser,
  validateStrings,
  validationErrorResponse,
} from '../http'

const checkEmail = (value: string) =>
  isValidEmail(value) ? undefined : 'value is not a valid email address'

export const authHandlers = [
  http.post(`${API}/auth/register`, async ({ request }) => {
    const body = await readJsonObject(request)
    if (body instanceof Response) return body
    const { values, errors } = validateStrings(body, {
      email: { max: 254, check: checkEmail },
      name: { min: 1, max: 100 },
      password: { trim: false, min: 8, max: 128 },
    })
    if (errors.length > 0) return validationErrorResponse(errors)
    if (findUserByEmail(values.email)) {
      return reasonError('conflict', 'email_taken', 'An account with this email already exists')
    }
    const user = createUser(values)
    db.sessionUserId = user.id
    return HttpResponse.json<User>(toUser(user), { status: 201 })
  }),

  http.post(`${API}/auth/login`, async ({ request }) => {
    const body = await readJsonObject(request)
    if (body instanceof Response) return body
    // Login password is 1 to 128 chars: a too-short password gets the same 401 as a wrong one.
    const { values, errors } = validateStrings(body, {
      email: { max: 254, check: checkEmail },
      password: { trim: false, min: 1, max: 128 },
    })
    if (errors.length > 0) return validationErrorResponse(errors)
    const user = findUserByEmail(values.email)
    if (!user || user.password !== values.password) {
      // Same answer for an unknown email and a wrong password.
      return errorResponse('unauthorized', 'Invalid email or password')
    }
    db.sessionUserId = user.id
    return HttpResponse.json<User>(toUser(user))
  }),

  http.post(`${API}/auth/logout`, () => {
    const user = requireUser()
    if (user instanceof Response) return user
    db.sessionUserId = null
    return new HttpResponse(null, { status: 204 })
  }),

  http.get(`${API}/auth/me`, () => {
    const user = requireUser()
    if (user instanceof Response) return user
    return HttpResponse.json<User>(toUser(user))
  }),
]
