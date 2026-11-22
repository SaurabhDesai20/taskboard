// Client-side checks for the workspace forms (contract 1.8). Text is trimmed first; the server
// validates again and its errors are shown per field.
import type { WorkspaceCreate } from '../../api/types'
import type { FieldErrors } from '../../lib/formErrors'
import { SLUG_MAX_LENGTH, SLUG_PATTERN } from '../../lib/slug'
import { charLength } from '../../lib/validation'

export const WORKSPACE_NAME_MAX_LENGTH = 100

export type WorkspaceField = 'name' | 'slug'
export const WORKSPACE_FIELDS: readonly WorkspaceField[] = ['name', 'slug']

export function validateWorkspaceName(raw: string): string | undefined {
  const length = charLength(raw.trim())
  if (length === 0) return 'Enter a workspace name'
  if (length > WORKSPACE_NAME_MAX_LENGTH) {
    return `Name must be at most ${WORKSPACE_NAME_MAX_LENGTH} characters`
  }
  return undefined
}

/** The slug is optional: empty means "let the server derive it from the name". */
function validateSlug(raw: string): string | undefined {
  const slug = raw.trim()
  if (!slug) return undefined
  if (slug.length > SLUG_MAX_LENGTH) return `URL slug must be at most ${SLUG_MAX_LENGTH} characters`
  if (!SLUG_PATTERN.test(slug)) {
    return 'Use lowercase letters, numbers and single hyphens, like "acme-inc"'
  }
  return undefined
}

export function validateWorkspaceCreate(values: Record<WorkspaceField, string>): FieldErrors<WorkspaceField> {
  const errors: FieldErrors<WorkspaceField> = {}
  const name = validateWorkspaceName(values.name)
  const slug = validateSlug(values.slug)
  if (name) errors.name = name
  if (slug) errors.slug = slug
  return errors
}

/** Trimmed values; an empty slug is left out so the server derives one. */
export function normalizeWorkspaceCreate(values: Record<WorkspaceField, string>): WorkspaceCreate {
  const slug = values.slug.trim()
  return slug ? { name: values.name.trim(), slug } : { name: values.name.trim() }
}
