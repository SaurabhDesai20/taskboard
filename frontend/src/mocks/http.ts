// Helpers that make MSW handlers answer exactly like the backend (contract section 1).
import { http, HttpResponse } from 'msw'
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../api/client'
import type { ApiErrorCode, ApiErrorEnvelope, ApiErrorReason, FieldError } from '../api/types'
import { sessionUser, type MockUserRecord } from './db'

export const API = '/api'

const STATUS_BY_CODE: Record<ApiErrorCode, number> = {
  bad_request: 400,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  method_not_allowed: 405,
  conflict: 409,
  validation_error: 422,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
}

export function errorResponse(
  code: ApiErrorCode,
  message: string,
  details: Record<string, unknown> = {},
) {
  return HttpResponse.json<ApiErrorEnvelope>(
    { error: { code, message, details } },
    { status: STATUS_BY_CODE[code] },
  )
}

export function reasonError(code: ApiErrorCode, reason: ApiErrorReason, message: string) {
  return errorResponse(code, message, { reason })
}

export function validationErrorResponse(errors: FieldError[]) {
  return errorResponse('validation_error', 'Request validation failed', { errors })
}

export function unauthorizedResponse() {
  return errorResponse('unauthorized', 'Authentication required')
}

const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE'])

/**
 * Mirrors the backend's CSRF middleware (contract 1.4): a mutating request without the exact
 * `X-Requested-With: taskboard` header gets 403 `csrf`, before authentication. Placed first in
 * the handler list; for every other request it returns nothing, so MSW moves on.
 */
export const csrfGuard = http.all(`${API}/*`, ({ request }) => {
  if (MUTATING_METHODS.has(request.method) && request.headers.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    return reasonError('forbidden', 'csrf', 'Missing or invalid X-Requested-With header')
  }
  return undefined
})

/** The signed-in user, or a 401 response to return as is. */
export function requireUser(): MockUserRecord | Response {
  return sessionUser() ?? unauthorizedResponse()
}

type JsonObject = Record<string, unknown>

/** Parses a JSON object body: 400 for malformed JSON, 422 (field "") for a non-object. */
export async function readJsonObject(request: Request): Promise<JsonObject | Response> {
  let body: unknown
  try {
    body = await request.json()
  } catch {
    return errorResponse('bad_request', 'Malformed JSON body')
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) {
    return validationErrorResponse([
      { field: '', location: 'body', message: 'Input should be a valid dictionary' },
    ])
  }
  return body as JsonObject
}

interface StringRule {
  /** Trim before validating (default). Passwords set this to false: they are used as sent. */
  trim?: boolean
  min?: number
  max?: number
  /** Extra check on the (trimmed) value; returns an error message or undefined. */
  check?: (value: string) => string | undefined
}

/**
 * Validates body string fields like Pydantic does for the backend: trimmed (unless the rule says
 * otherwise), then length-checked (contract 1.8). Returns the values plus every failing field.
 */
export function validateStrings<F extends string>(
  body: JsonObject,
  rules: Record<F, StringRule>,
): { values: Record<F, string>; errors: FieldError[] } {
  const values = {} as Record<F, string>
  const errors: FieldError[] = []
  for (const field of Object.keys(rules) as F[]) {
    const rule = rules[field]
    const raw = body[field]
    const fail = (message: string) => errors.push({ field, location: 'body', message })
    if (raw === undefined) {
      fail('Field required')
      continue
    }
    if (typeof raw !== 'string') {
      fail('Input should be a valid string')
      continue
    }
    const value = rule.trim === false ? raw : raw.trim()
    const length = [...value].length
    values[field] = value
    if (rule.min !== undefined && length < rule.min) {
      fail(`String should have at least ${rule.min} character${rule.min === 1 ? '' : 's'}`)
    } else if (rule.max !== undefined && length > rule.max) {
      fail(`String should have at most ${rule.max} characters`)
    } else {
      const message = rule.check?.(value)
      if (message) fail(message)
    }
  }
  return { values, errors }
}
