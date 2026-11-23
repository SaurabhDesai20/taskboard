// Client-side checks for the auth forms, mirroring contract 1.8: text fields are trimmed first,
// passwords are used exactly as typed (spaces count).
// The server validates again and its 422 details are shown per field.
import type { LoginRequest, RegisterRequest } from '../../api/types'
import type { FieldErrors } from '../../lib/formErrors'
import { charLength, isValidEmail } from '../../lib/validation'

export const EMAIL_MAX_LENGTH = 254
export const NAME_MAX_LENGTH = 100
export const PASSWORD_MIN_LENGTH = 8
export const PASSWORD_MAX_LENGTH = 128

export type LoginField = keyof LoginRequest
export type RegisterField = keyof RegisterRequest

export const LOGIN_FIELDS: readonly LoginField[] = ['email', 'password']
export const REGISTER_FIELDS: readonly RegisterField[] = ['name', 'email', 'password']

function validateEmail(raw: string): string | undefined {
  const email = raw.trim()
  if (!email) return 'Enter your email address'
  if (charLength(email) > EMAIL_MAX_LENGTH) {
    return `Email must be at most ${EMAIL_MAX_LENGTH} characters`
  }
  if (!isValidEmail(email)) return 'Enter a valid email address'
  return undefined
}

function validateNewPassword(password: string): string | undefined {
  const length = charLength(password)
  if (length === 0) return 'Enter a password'
  if (length < PASSWORD_MIN_LENGTH) {
    return `Password must be at least ${PASSWORD_MIN_LENGTH} characters`
  }
  if (length > PASSWORD_MAX_LENGTH) {
    return `Password must be at most ${PASSWORD_MAX_LENGTH} characters`
  }
  return undefined
}

function validateName(raw: string): string | undefined {
  const length = charLength(raw.trim())
  if (length === 0) return 'Enter your name'
  if (length > NAME_MAX_LENGTH) return `Name must be at most ${NAME_MAX_LENGTH} characters`
  return undefined
}

function compact<F extends string>(errors: Record<F, string | undefined>): FieldErrors<F> {
  const result: FieldErrors<F> = {}
  for (const [field, message] of Object.entries(errors) as [F, string | undefined][]) {
    if (message) result[field] = message
  }
  return result
}

/**
 * Login only checks that both fields are filled in. Like the server (password 1 to 128 chars on
 * login), it does not apply the register length rule: a too-short password is just a wrong one.
 */
export function validateLogin(values: LoginRequest): FieldErrors<LoginField> {
  return compact<LoginField>({
    email: validateEmail(values.email),
    password: values.password ? undefined : 'Enter your password',
  })
}

export function validateRegister(values: RegisterRequest): FieldErrors<RegisterField> {
  return compact<RegisterField>({
    name: validateName(values.name),
    email: validateEmail(values.email),
    password: validateNewPassword(values.password),
  })
}

/** Trimmed copies of the text fields; the password is sent exactly as typed. */
export function normalizeLogin(values: LoginRequest): LoginRequest {
  return { email: values.email.trim(), password: values.password }
}

export function normalizeRegister(values: RegisterRequest): RegisterRequest {
  return { name: values.name.trim(), email: values.email.trim(), password: values.password }
}
