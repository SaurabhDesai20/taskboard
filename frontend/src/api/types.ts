// API types. Generated where the backend has published them (src/api/schema.d.ts, built from
// docs/openapi.json with `npm run gen:api`); hand-written from docs/api-contract.md otherwise.
// Hand-written types are named after the backend's Pydantic schemas so each one can later
// become a one-line alias of the generated type, e.g.
//   export type UserRead = components['schemas']['UserRead']
import type { components } from './schema'

type Schemas = components['schemas']

/** UUID v4 string (contract 1.2). */
export type UUID = string
/** ISO 8601 UTC timestamp with a `Z` suffix (contract 1.2). Parse with `new Date()`. */
export type Timestamp = string

// ---------------------------------------------------------------------------------------------
// Errors (contract 1.5)
// ---------------------------------------------------------------------------------------------

/** Error codes the backend sends in the error envelope. */
export type ApiErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'bad_request'
  | 'method_not_allowed'
  | 'internal_error'
  | 'service_unavailable'

/** Codes produced by the client itself when no envelope is available. */
export type ClientErrorCode = 'network_error' | 'unknown_error' | 'invalid_response'

/** Machine-readable `details.reason` values. */
export type ApiErrorReason =
  | 'csrf'
  | 'insufficient_role'
  | 'own_role'
  | 'protected_member'
  | 'not_author'
  | 'email_taken'
  | 'slug_taken'
  | 'project_key_taken'
  | 'already_member'
  | 'last_owner'
  | 'project_archived'
  | 'already_archived'

/** One entry of `details.errors` on a 422 (contract 1.5.1). */
export interface FieldError {
  field: string
  location: 'body' | 'query' | 'path' | 'header' | 'cookie'
  message: string
}

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode
    message: string
    details: Record<string, unknown>
  }
}

export interface Paginated<T> {
  items: T[]
  next_cursor: string | null
}

// ---------------------------------------------------------------------------------------------
// Health (contract 3.1): generated
// ---------------------------------------------------------------------------------------------

export type HealthResponse = Schemas['HealthRead']

// ---------------------------------------------------------------------------------------------
// Auth (contract 3.2): generated
// ---------------------------------------------------------------------------------------------

/** Backend `UserRead`: the contract's `User`. Never includes the password. */
export type UserRead = Schemas['UserRead']

/** Backend `RegisterRequest`: body of `POST /auth/register`. */
export type RegisterRequest = Schemas['RegisterRequest']

/** Backend `LoginRequest`: body of `POST /auth/login`. */
export type LoginRequest = Schemas['LoginRequest']

/** The signed-in user (contract 2.1 `User`). */
export type User = UserRead
