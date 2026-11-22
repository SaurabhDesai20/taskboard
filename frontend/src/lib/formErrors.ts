// Turns an API error into errors a form can show: per-field messages plus one form-level message.
import { ApiError } from '../api/client'
import type { ApiErrorReason, FieldError } from '../api/types'

export type FieldErrors<F extends string> = Partial<Record<F, string>>

export interface FormErrors<F extends string> {
  fields: FieldErrors<F>
  /** Shown above the form when the error does not belong to a single field. */
  form: string | null
}

export const GENERIC_ERROR_MESSAGE = 'Something went wrong. Please try again.'

/** "45 seconds", "1 minute", "3 minutes" (minutes rounded up). */
export function formatWait(seconds: number): string {
  if (seconds < 60) return seconds === 1 ? '1 second' : `${seconds} seconds`
  const minutes = Math.ceil(seconds / 60)
  return minutes === 1 ? '1 minute' : `${minutes} minutes`
}

/** What a 429 `rate_limited` (contract 1.5) tells the user, with the wait from `Retry-After`. */
export function rateLimitMessage(retryAfter: number | null): string {
  if (retryAfter === null || retryAfter <= 0) return 'Too many attempts. Please wait a moment and try again.'
  return `Too many attempts. Please wait ${formatWait(retryAfter)} and try again.`
}

interface FormErrorOptions<F extends string> {
  /** Field names the form renders; 422 entries for other fields go to the form-level message. */
  fields: readonly F[]
  /** `details.reason` values that belong to one field (e.g. `email_taken` -> `email`). */
  reasonFields?: Partial<Record<ApiErrorReason, F>>
}

function isFieldError(value: unknown): value is FieldError {
  return (
    typeof value === 'object' &&
    value !== null &&
    'field' in value &&
    typeof value.field === 'string' &&
    'message' in value &&
    typeof value.message === 'string'
  )
}

/** The `details.errors` list of a 422 response, or an empty list. */
export function validationErrorsOf(error: ApiError): FieldError[] {
  const errors = error.details.errors
  return Array.isArray(errors) ? errors.filter(isFieldError) : []
}

export function formErrorsFromError<F extends string>(
  error: unknown,
  { fields, reasonFields = {} }: FormErrorOptions<F>,
): FormErrors<F> {
  if (!(error instanceof ApiError)) {
    return { fields: {}, form: GENERIC_ERROR_MESSAGE }
  }

  if (error.status === 429) {
    return { fields: {}, form: rateLimitMessage(error.retryAfter) }
  }

  const reason = error.details.reason
  if (typeof reason === 'string' && reason in reasonFields) {
    const field = reasonFields[reason as ApiErrorReason]
    if (field) {
      return { fields: { [field]: error.message } as FieldErrors<F>, form: null }
    }
  }

  if (error.code === 'validation_error') {
    const known = new Set<string>(fields)
    const fieldErrors: FieldErrors<F> = {}
    const otherMessages: string[] = []
    for (const entry of validationErrorsOf(error)) {
      if (entry.location === 'body' && known.has(entry.field)) {
        const field = entry.field as F
        // Keep the first message per field; later ones usually repeat the same problem.
        fieldErrors[field] ??= entry.message
      } else {
        otherMessages.push(entry.message)
      }
    }
    const hasFieldErrors = Object.keys(fieldErrors).length > 0
    let form: string | null = null
    if (otherMessages.length > 0) {
      form = otherMessages.join(' ')
    } else if (!hasFieldErrors) {
      form = error.message
    }
    return { fields: fieldErrors, form }
  }

  return { fields: {}, form: error.message || GENERIC_ERROR_MESSAGE }
}
