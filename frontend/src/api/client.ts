// The single HTTP entry point for the app. Every request to the backend goes through here.
import type { ApiErrorCode, ApiErrorEnvelope, ClientErrorCode } from './types'

export const API_BASE_PATH = '/api'
export const CSRF_HEADER = 'X-Requested-With'
export const CSRF_HEADER_VALUE = 'taskboard'

type HttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'
type QueryValue = string | number | boolean | null | undefined
export type QueryParams = Record<string, QueryValue | QueryValue[]>

export interface RequestOptions {
  method?: HttpMethod
  body?: unknown
  /** null/undefined values are skipped; arrays become repeated keys (?status=a&status=b). */
  query?: QueryParams
  signal?: AbortSignal
  /** Set for calls where 401 is an expected answer (e.g. GET /auth/me on app start). */
  skipAuthRedirect?: boolean
}

export class ApiError extends Error {
  readonly status: number
  readonly code: ApiErrorCode | ClientErrorCode
  readonly details: Record<string, unknown>
  /** Seconds to wait before retrying, from the `Retry-After` header (429 `rate_limited`); null without one. */
  readonly retryAfter: number | null

  constructor(
    status: number,
    code: ApiErrorCode | ClientErrorCode,
    message: string,
    details: Record<string, unknown> = {},
    retryAfter: number | null = null,
  ) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.retryAfter = retryAfter
  }
}

/**
 * A `Retry-After` header as whole seconds from now: either delay-seconds ("120") or an HTTP date.
 * Null when it is missing or unreadable.
 */
export function parseRetryAfter(value: string | null, now: number = Date.now()): number | null {
  const text = value?.trim()
  if (!text) return null
  if (/^\d+$/.test(text)) return Number(text)
  // HTTP dates start with the day's name ("Sun, 22 Nov 2026 10:00:00 GMT"); Date.parse alone
  // would also accept things like "-5".
  if (!/^[A-Za-z]{3}/.test(text)) return null
  const date = Date.parse(text)
  if (Number.isNaN(date)) return null
  return Math.max(0, Math.ceil((date - now) / 1000))
}

type UnauthorizedHandler = () => void

const redirectToLogin: UnauthorizedHandler = () => {
  if (window.location.pathname !== '/login') {
    window.location.assign('/login')
  }
}

let unauthorizedHandler: UnauthorizedHandler = redirectToLogin

/** Replace what happens on a 401. Returns the previous handler so callers can restore it. */
export function setUnauthorizedHandler(handler: UnauthorizedHandler): UnauthorizedHandler {
  const previous = unauthorizedHandler
  unauthorizedHandler = handler
  return previous
}

function buildUrl(path: string, query?: QueryParams): URL {
  // An absolute URL keeps fetch working in tests (Node) as well as in the browser.
  const url = new URL(`${API_BASE_PATH}${path}`, window.location.origin)
  for (const [key, value] of Object.entries(query ?? {})) {
    const values = Array.isArray(value) ? value : [value]
    for (const item of values) {
      if (item !== null && item !== undefined) {
        url.searchParams.append(key, String(item))
      }
    }
  }
  return url
}

function isErrorEnvelope(value: unknown): value is ApiErrorEnvelope {
  if (typeof value !== 'object' || value === null || !('error' in value)) {
    return false
  }
  const { error } = value
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    typeof error.code === 'string' &&
    'message' in error &&
    typeof error.message === 'string'
  )
}

async function readBody(response: Response): Promise<{ ok: true; value: unknown } | { ok: false }> {
  const text = await response.text()
  if (!text) {
    return { ok: true, value: undefined }
  }
  try {
    return { ok: true, value: JSON.parse(text) as unknown }
  } catch {
    return { ok: false }
  }
}

export async function apiRequest<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const method = options.method ?? 'GET'
  const headers = new Headers({ Accept: 'application/json' })
  if (method !== 'GET') {
    headers.set(CSRF_HEADER, CSRF_HEADER_VALUE)
  }
  let body: string | undefined
  if (options.body !== undefined) {
    headers.set('Content-Type', 'application/json')
    body = JSON.stringify(options.body)
  }

  let response: Response
  try {
    response = await fetch(buildUrl(path, options.query), {
      method,
      headers,
      body,
      credentials: 'include',
      signal: options.signal,
    })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    throw new ApiError(0, 'network_error', 'Could not reach the server. Check your connection.')
  }

  const parsed = await readBody(response)

  if (!response.ok) {
    if (response.status === 401 && !options.skipAuthRedirect) {
      unauthorizedHandler()
    }
    const retryAfter = parseRetryAfter(response.headers.get('Retry-After'))
    if (parsed.ok && isErrorEnvelope(parsed.value)) {
      const { code, message, details } = parsed.value.error
      throw new ApiError(response.status, code, message, details, retryAfter)
    }
    throw new ApiError(
      response.status,
      response.status === 429 ? 'rate_limited' : 'unknown_error',
      response.statusText || `Request failed with status ${response.status}`,
      {},
      retryAfter,
    )
  }

  if (!parsed.ok) {
    throw new ApiError(response.status, 'invalid_response', 'The server sent an unreadable response.')
  }
  return parsed.value as T
}

type ReadOptions = Omit<RequestOptions, 'method' | 'body'>

export const api = {
  get: <T>(path: string, options?: ReadOptions) =>
    apiRequest<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: ReadOptions) =>
    apiRequest<T>(path, { ...options, method: 'POST', body }),
  put: <T>(path: string, body?: unknown, options?: ReadOptions) =>
    apiRequest<T>(path, { ...options, method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown, options?: ReadOptions) =>
    apiRequest<T>(path, { ...options, method: 'PATCH', body }),
  delete: <T = void>(path: string, options?: ReadOptions) =>
    apiRequest<T>(path, { ...options, method: 'DELETE' }),
}
