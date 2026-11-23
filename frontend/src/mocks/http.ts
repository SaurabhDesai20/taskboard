// Helpers that make MSW handlers answer exactly like the backend (contract section 1).
import { http, HttpResponse } from 'msw'
import { CSRF_HEADER, CSRF_HEADER_VALUE } from '../api/client'
import type { ApiErrorCode, ApiErrorEnvelope, ApiErrorReason, FieldError, Role } from '../api/types'
import { ROLES } from '../lib/permissions'
import {
  findMembership,
  findProject,
  findWorkspace,
  sessionUser,
  type MockMembershipRecord,
  type MockProjectRecord,
  type MockUserRecord,
  type MockWorkspaceRecord,
} from './db'

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

/** Case-insensitive ordering, like the backend's `ORDER BY lower(name)`. */
export function compareText(a: string, b: string): number {
  const left = a.toLowerCase()
  const right = b.toLowerCase()
  if (left === right) return 0
  return left < right ? -1 : 1
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A 422 for path parameters that are not UUIDs (FastAPI validates them before anything else). */
export function invalidUuidParams(params: Record<string, string | readonly string[] | undefined>) {
  const errors: FieldError[] = []
  for (const [field, value] of Object.entries(params)) {
    if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
      errors.push({ field, location: 'path', message: 'Input should be a valid UUID' })
    }
  }
  return errors.length > 0 ? validationErrorResponse(errors) : null
}

export interface WorkspaceAccess {
  user: MockUserRecord
  workspace: MockWorkspaceRecord
  membership: MockMembershipRecord
}

/**
 * Contract 1.10, steps 1 and 2: the signed-in user and their membership of workspace `wid`.
 * 401 when logged out, 422 for a malformed id, 404 when the workspace does not exist **or** the
 * user is not a member (never 403, so existence does not leak).
 */
export function requireWorkspaceMember(wid: string | readonly string[] | undefined): WorkspaceAccess | Response {
  const invalid = invalidUuidParams({ wid })
  if (invalid) return invalid
  const user = requireUser()
  if (user instanceof Response) return user
  const workspace = findWorkspace(wid as string)
  const membership = workspace ? findMembership(workspace.id, user.id) : undefined
  if (!workspace || !membership) return errorResponse('not_found', 'Workspace not found')
  return { user, workspace, membership }
}

export interface ProjectAccess {
  project: MockProjectRecord
  membership: MockMembershipRecord
}

/**
 * Contract 1.10 for `/projects/{pid}`: resolve the project to its workspace, then 404 when the
 * project does not exist **or** the user is not a member of its workspace.
 */
export function requireProjectMember(pid: string | readonly string[] | undefined): ProjectAccess | Response {
  const invalid = invalidUuidParams({ pid })
  if (invalid) return invalid
  const user = requireUser()
  if (user instanceof Response) return user
  const project = findProject(pid as string)
  const membership = project ? findMembership(project.workspace_id, user.id) : undefined
  if (!project || !membership) return errorResponse('not_found', 'Project not found')
  return { project, membership }
}

/** Reads a required `role` body field. Returns the role, or the 422 entry to report. */
export function readRole(body: Record<string, unknown>): Role | FieldError {
  const value = body.role
  if (value === undefined) return { field: 'role', location: 'body', message: 'Field required' }
  if (typeof value !== 'string' || !(ROLES as readonly string[]).includes(value)) {
    return {
      field: 'role',
      location: 'body',
      message: "Input should be 'owner', 'admin', 'member' or 'viewer'",
    }
  }
  return value as Role
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

const TRUE_VALUES = new Set(['1', 'true', 'on', 'yes', 't', 'y'])
const FALSE_VALUES = new Set(['0', 'false', 'off', 'no', 'f', 'n'])

/**
 * Reads an optional boolean query parameter the way FastAPI does (`true`/`false`, `1`/`0`,
 * `yes`/`no`, ... in any case). Returns the value, or the 422 entry to report.
 */
export function readBooleanQuery(url: URL, name: string, fallback: boolean): boolean | FieldError {
  const raw = url.searchParams.get(name)
  if (raw === null) return fallback
  const value = raw.toLowerCase()
  if (TRUE_VALUES.has(value)) return true
  if (FALSE_VALUES.has(value)) return false
  return { field: name, location: 'query', message: 'Input should be a valid boolean, unable to interpret input' }
}
