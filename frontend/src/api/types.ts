// Hand-written from docs/api-contract.md. Once the backend publishes docs/openapi.json,
// generate src/api/schema.d.ts with openapi-typescript and derive these from it.

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

export interface HealthResponse {
  status: 'ok'
  database: 'ok'
}
