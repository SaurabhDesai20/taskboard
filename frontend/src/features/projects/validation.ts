// Client-side checks for the project forms (contract 1.8). Text is trimmed first; the server
// validates again and its errors are shown per field.
import type { Project, ProjectCreate, ProjectUpdate } from '../../api/types'
import type { FieldErrors } from '../../lib/formErrors'
import { isValidProjectKey, PROJECT_KEY_MAX_LENGTH, PROJECT_KEY_MIN_LENGTH } from '../../lib/projectKey'
import { charLength } from '../../lib/validation'

export const PROJECT_NAME_MAX_LENGTH = 100
export const PROJECT_DESCRIPTION_MAX_LENGTH = 2000

export type ProjectField = 'name' | 'key' | 'description'
export const PROJECT_CREATE_FIELDS: readonly ProjectField[] = ['name', 'key', 'description']

export type ProjectEditField = 'name' | 'description'
export const PROJECT_EDIT_FIELDS: readonly ProjectEditField[] = ['name', 'description']

function validateName(raw: string): string | undefined {
  const length = charLength(raw.trim())
  if (length === 0) return 'Enter a project name'
  if (length > PROJECT_NAME_MAX_LENGTH) return `Name must be at most ${PROJECT_NAME_MAX_LENGTH} characters`
  return undefined
}

function validateKey(raw: string): string | undefined {
  const key = raw.trim()
  if (!key) return 'Enter a project key'
  if (key.length < PROJECT_KEY_MIN_LENGTH || key.length > PROJECT_KEY_MAX_LENGTH) {
    return `Key must be ${PROJECT_KEY_MIN_LENGTH} to ${PROJECT_KEY_MAX_LENGTH} characters`
  }
  if (!isValidProjectKey(key)) return 'Use uppercase letters and digits, starting with a letter, like "WEB"'
  return undefined
}

function validateDescription(raw: string): string | undefined {
  if (charLength(raw.trim()) > PROJECT_DESCRIPTION_MAX_LENGTH) {
    return `Description must be at most ${PROJECT_DESCRIPTION_MAX_LENGTH} characters`
  }
  return undefined
}

function collect<F extends string>(checks: Record<F, string | undefined>): FieldErrors<F> {
  const errors: FieldErrors<F> = {}
  for (const field of Object.keys(checks) as F[]) {
    if (checks[field]) errors[field] = checks[field]
  }
  return errors
}

export function validateProjectCreate(values: Record<ProjectField, string>): FieldErrors<ProjectField> {
  return collect({
    name: validateName(values.name),
    key: validateKey(values.key),
    description: validateDescription(values.description),
  })
}

export function validateProjectEdit(values: Record<ProjectEditField, string>): FieldErrors<ProjectEditField> {
  return collect({ name: validateName(values.name), description: validateDescription(values.description) })
}

/** Trimmed values; an empty description is left out (the project gets none). */
export function normalizeProjectCreate(values: Record<ProjectField, string>): ProjectCreate {
  const body: ProjectCreate = { name: values.name.trim(), key: values.key.trim() }
  const description = values.description.trim()
  if (description) body.description = description
  return body
}

/**
 * The PATCH body for an edit: only the fields that changed (contract 1.7), with an emptied
 * description sent as `null` to clear it. `{}` means there is nothing to save.
 */
export function projectChanges(project: Project, values: Record<ProjectEditField, string>): ProjectUpdate {
  const body: ProjectUpdate = {}
  const name = values.name.trim()
  const description = values.description.trim() || null
  if (name !== project.name) body.name = name
  if (description !== project.description) body.description = description
  return body
}
