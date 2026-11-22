// Keeps the auth mocks honest: they must answer exactly like contract section 3.2.
import { describe, expect, it } from 'vitest'
import { DEMO_USER, sessionUser } from '../db'

const JSON_HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'taskboard' }

function call(path: string, init: RequestInit = {}) {
  return fetch(new URL(`/api${path}`, window.location.origin), init)
}

function post(path: string, body?: unknown, headers: Record<string, string> = JSON_HEADERS) {
  return call(path, {
    method: 'POST',
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

const asha = { email: DEMO_USER.email, password: DEMO_USER.password }

describe('auth mock handlers', () => {
  it('registers a user: 201, lowercase trimmed email, no password, session started', async () => {
    const response = await post('/auth/register', {
      email: '  Ben@Example.COM ',
      name: ' Ben Okafor ',
      password: 'correct-horse-battery',
    })

    expect(response.status).toBe(201)
    const user: unknown = await response.json()
    expect(user).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      email: 'ben@example.com',
      name: 'Ben Okafor',
      created_at: expect.stringMatching(/Z$/),
    })
    expect(sessionUser()?.email).toBe('ben@example.com')
    expect(await (await call('/auth/me')).json()).toEqual(user)
  })

  it('rejects a duplicate email (any case) with 409 email_taken', async () => {
    const response = await post('/auth/register', {
      email: 'ASHA@example.com',
      name: 'Asha',
      password: 'correct-horse-battery',
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({
      error: {
        code: 'conflict',
        message: 'An account with this email already exists',
        details: { reason: 'email_taken' },
      },
    })
  })

  it('lists every invalid register field in a 422', async () => {
    const response = await post('/auth/register', { email: 'nope', name: '  ', password: 'short' })

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({
      error: {
        code: 'validation_error',
        message: 'Request validation failed',
        details: {
          errors: [
            { field: 'email', location: 'body', message: 'value is not a valid email address' },
            { field: 'name', location: 'body', message: 'String should have at least 1 character' },
            {
              field: 'password',
              location: 'body',
              message: 'String should have at least 8 characters',
            },
          ],
        },
      },
    })
  })

  it('reports missing fields and a non-object body', async () => {
    const missing = await post('/auth/register', {})
    expect(missing.status).toBe(422)
    const body = (await missing.json()) as { error: { details: { errors: { field: string }[] } } }
    expect(body.error.details.errors.map((e) => e.field)).toEqual(['email', 'name', 'password'])

    const notObject = await post('/auth/register', ['x'])
    expect(notObject.status).toBe(422)
  })

  it('logs in case-insensitively and answers 401 for a wrong password or unknown email', async () => {
    const ok = await post('/auth/login', { ...asha, email: 'Asha@Example.com' })
    expect(ok.status).toBe(200)
    expect(await ok.json()).toEqual({
      id: DEMO_USER.id,
      email: DEMO_USER.email,
      name: DEMO_USER.name,
      created_at: DEMO_USER.created_at,
    })

    for (const credentials of [
      { ...asha, password: 'wrong-password' },
      { email: 'nobody@example.com', password: 'whatever-password' },
    ]) {
      const response = await post('/auth/login', credentials)
      expect(response.status).toBe(401)
      expect(await response.json()).toEqual({
        error: { code: 'unauthorized', message: 'Invalid email or password', details: {} },
      })
    }
  })

  it('uses passwords exactly as sent and answers a too-short login password with 401', async () => {
    await post('/auth/register', {
      email: 'ben@example.com',
      name: 'Ben',
      password: ' spaced password ',
    })

    expect((await post('/auth/login', { email: 'ben@example.com', password: 'spaced password' })).status).toBe(401)
    expect((await post('/auth/login', { email: 'ben@example.com', password: 'short' })).status).toBe(401)
    expect((await post('/auth/login', { email: 'ben@example.com', password: '' })).status).toBe(422)
    expect(
      (await post('/auth/login', { email: 'ben@example.com', password: ' spaced password ' })).status,
    ).toBe(200)
  })

  it('answers /auth/me with 401 when logged out and the user when logged in', async () => {
    expect((await call('/auth/me')).status).toBe(401)

    await post('/auth/login', asha)
    const response = await call('/auth/me')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ id: DEMO_USER.id })
  })

  it('logs out with 204 and an empty body, then answers 401', async () => {
    await post('/auth/login', asha)

    const response = await post('/auth/logout')
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    expect(sessionUser()).toBeNull()

    expect((await post('/auth/logout')).status).toBe(401)
    expect((await call('/auth/me')).status).toBe(401)
  })

  it('rejects mutating requests without the CSRF header with 403 csrf, before auth', async () => {
    const response = await post('/auth/login', asha, { 'Content-Type': 'application/json' })

    expect(response.status).toBe(403)
    expect(await response.json()).toEqual({
      error: {
        code: 'forbidden',
        message: 'Missing or invalid X-Requested-With header',
        details: { reason: 'csrf' },
      },
    })
    expect(sessionUser()).toBeNull()

    // Checked before authentication: logged out, a header-less logout is still 403, not 401.
    const logout = await post('/auth/logout', undefined, { 'X-Requested-With': 'other' })
    expect(logout.status).toBe(403)
  })

  it('answers malformed JSON with 400 bad_request', async () => {
    const response = await call('/auth/login', {
      method: 'POST',
      headers: JSON_HEADERS,
      body: '{not json',
    })

    expect(response.status).toBe(400)
    expect(await response.json()).toMatchObject({ error: { code: 'bad_request' } })
  })
})
