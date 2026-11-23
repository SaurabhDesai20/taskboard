import { http, HttpResponse } from 'msw'
import { describe, expect, it, vi } from 'vitest'
import { server } from '../mocks/server'
import { api, ApiError, parseRetryAfter, setUnauthorizedHandler } from './client'

describe('api client', () => {
  it('returns parsed JSON and always sends cookies', async () => {
    // Node's fetch drops `credentials` from the Request MSW sees, so check what we pass in.
    const fetchSpy = vi.spyOn(globalThis, 'fetch')
    server.use(http.get('/api/things', () => HttpResponse.json({ ok: true })))

    try {
      await expect(api.get('/things')).resolves.toEqual({ ok: true })
      expect(fetchSpy).toHaveBeenCalledWith(
        expect.any(URL),
        expect.objectContaining({ credentials: 'include' }),
      )
    } finally {
      fetchSpy.mockRestore()
    }
  })

  it('serializes query params and skips null or undefined values', async () => {
    let url: URL | undefined
    server.use(
      http.get('/api/things', ({ request }) => {
        url = new URL(request.url)
        return HttpResponse.json([])
      }),
    )

    await api.get('/things', {
      query: { status: ['todo', 'done'], q: 'login', assignee_id: undefined, cursor: null },
    })

    expect(url?.searchParams.getAll('status')).toEqual(['todo', 'done'])
    expect(url?.searchParams.get('q')).toBe('login')
    expect(url?.searchParams.has('assignee_id')).toBe(false)
    expect(url?.searchParams.has('cursor')).toBe(false)
  })

  it('sends a JSON body and the CSRF header on mutating requests', async () => {
    let headers: Headers | undefined
    let body: unknown
    server.use(
      http.post('/api/things', async ({ request }) => {
        headers = request.headers
        body = await request.json()
        return HttpResponse.json({ id: '1' }, { status: 201 })
      }),
    )

    await expect(api.post('/things', { name: 'Fix login' })).resolves.toEqual({ id: '1' })
    expect(headers?.get('X-Requested-With')).toBe('taskboard')
    expect(headers?.get('Content-Type')).toBe('application/json')
    expect(body).toEqual({ name: 'Fix login' })
  })

  it('leaves the CSRF header off GET requests', async () => {
    let headers: Headers | undefined
    server.use(
      http.get('/api/things', ({ request }) => {
        headers = request.headers
        return HttpResponse.json([])
      }),
    )

    await api.get('/things')

    expect(headers?.has('X-Requested-With')).toBe(false)
  })

  it('resolves to undefined for 204 No Content', async () => {
    server.use(http.delete('/api/things/1', () => new HttpResponse(null, { status: 204 })))

    await expect(api.delete('/things/1')).resolves.toBeUndefined()
  })

  it('throws an ApiError built from the error envelope', async () => {
    server.use(
      http.get('/api/things', () =>
        HttpResponse.json(
          { error: { code: 'forbidden', message: 'Viewers cannot edit', details: { role: 'viewer' } } },
          { status: 403 },
        ),
      ),
    )

    const error: unknown = await api.get('/things').catch((e: unknown) => e)

    expect(error).toBeInstanceOf(ApiError)
    expect(error).toMatchObject({
      status: 403,
      code: 'forbidden',
      message: 'Viewers cannot edit',
      details: { role: 'viewer' },
    })
  })

  it('throws unknown_error when an error response has no envelope', async () => {
    server.use(http.get('/api/things', () => new HttpResponse('Bad gateway', { status: 502 })))

    await expect(api.get('/things')).rejects.toMatchObject({ status: 502, code: 'unknown_error' })
  })

  it('maps network failures to a network_error ApiError', async () => {
    server.use(http.get('/api/things', () => HttpResponse.error()))

    await expect(api.get('/things')).rejects.toMatchObject({ status: 0, code: 'network_error' })
  })

  it('calls the unauthorized handler on 401', async () => {
    const onUnauthorized = vi.fn()
    const previous = setUnauthorizedHandler(onUnauthorized)
    server.use(
      http.get('/api/things', () =>
        HttpResponse.json(
          { error: { code: 'unauthorized', message: 'Authentication required', details: {} } },
          { status: 401 },
        ),
      ),
    )

    try {
      await expect(api.get('/things')).rejects.toMatchObject({ status: 401, code: 'unauthorized' })
      expect(onUnauthorized).toHaveBeenCalledTimes(1)

      await expect(api.get('/things', { skipAuthRedirect: true })).rejects.toBeInstanceOf(ApiError)
      expect(onUnauthorized).toHaveBeenCalledTimes(1)
    } finally {
      setUnauthorizedHandler(previous)
    }
  })

  it('reads Retry-After (seconds) into the error of a 429 rate_limited answer', async () => {
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          { error: { code: 'rate_limited', message: 'Too many attempts', details: {} } },
          { status: 429, headers: { 'Retry-After': '42' } },
        ),
      ),
    )

    await expect(api.post('/auth/login', {})).rejects.toMatchObject({
      status: 429,
      code: 'rate_limited',
      retryAfter: 42,
    })
  })

  it('treats a 429 without the envelope as rate_limited, and no Retry-After as null', async () => {
    server.use(http.post('/api/auth/login', () => new HttpResponse('slow down', { status: 429 })))

    await expect(api.post('/auth/login', {})).rejects.toMatchObject({ code: 'rate_limited', retryAfter: null })
  })
})

describe('parseRetryAfter', () => {
  const now = Date.parse('2026-11-22T10:00:00Z')

  it.each([
    ['120', 120],
    [' 5 ', 5],
    ['0', 0],
    ['Sun, 22 Nov 2026 10:01:30 GMT', 90],
    // A date in the past means "now".
    ['Sun, 22 Nov 2026 09:00:00 GMT', 0],
  ])('reads %j as %i seconds', (value, seconds) => {
    expect(parseRetryAfter(value, now)).toBe(seconds)
  })

  it.each([null, '', 'soon', '-5', '1.5'])('gives null for %j', (value) => {
    expect(parseRetryAfter(value, now)).toBeNull()
  })
})
