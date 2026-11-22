// Contract section 3.5 (Projects) with the access rules of 1.10.
import { http, HttpResponse } from 'msw'
import type { FieldError, Project } from '../../api/types'
import { can } from '../../lib/permissions'
import {
  isValidProjectKey,
  PROJECT_KEY_MAX_LENGTH,
  PROJECT_KEY_MIN_LENGTH,
  PROJECT_KEY_PATTERN,
} from '../../lib/projectKey'
import { createProject, projectRef, projectsOf } from '../db'
import {
  API,
  compareText,
  readBooleanQuery,
  readJsonObject,
  reasonError,
  requireProjectMember,
  requireWorkspaceMember,
  validateStrings,
  validationErrorResponse,
} from '../http'
import { logProjectActivity } from './activity'

// Wording from contract 3.5.
const MESSAGES = {
  insufficientRole: 'Only owners and admins can create, edit or archive projects',
  keyTaken: 'This project key is already used in this workspace',
  alreadyArchived: 'This project is already archived',
}

const NAME_RULE = { min: 1, max: 100 }
const DESCRIPTION_MAX_LENGTH = 2000

/** By name (case-insensitive), then key (contract 3.5). */
const byName = (a: Project, b: Project) => compareText(a.name, b.name) || compareText(a.key, b.key)

/** An optional, nullable description: trimmed, at most 2000 characters. */
function readDescription(raw: unknown): { value: string | null; error?: FieldError } {
  if (raw === undefined || raw === null) return { value: null }
  const fail = (message: string) => ({ value: null, error: { field: 'description', location: 'body' as const, message } })
  if (typeof raw !== 'string') return fail('Input should be a valid string')
  const value = raw.trim()
  if ([...value].length > DESCRIPTION_MAX_LENGTH) {
    return fail(`String should have at most ${DESCRIPTION_MAX_LENGTH} characters`)
  }
  return { value }
}

export const projectHandlers = [
  http.get(`${API}/workspaces/:wid/projects`, ({ params, request }) => {
    const access = requireWorkspaceMember(params.wid)
    if (access instanceof Response) return access
    const includeArchived = readBooleanQuery(new URL(request.url), 'include_archived', false)
    if (typeof includeArchived !== 'boolean') return validationErrorResponse([includeArchived])
    const projects = projectsOf(access.workspace.id)
      .filter((project) => includeArchived || project.archived_at === null)
      .sort(byName)
    return HttpResponse.json<Project[]>(projects)
  }),

  http.post(`${API}/workspaces/:wid/projects`, async ({ params, request }) => {
    const access = requireWorkspaceMember(params.wid)
    if (access instanceof Response) return access
    const { user, workspace, membership } = access
    if (!can(membership.role, 'project.manage')) {
      return reasonError('forbidden', 'insufficient_role', MESSAGES.insufficientRole)
    }
    const body = await readJsonObject(request)
    if (body instanceof Response) return body
    const { values, errors } = validateStrings(body, {
      name: NAME_RULE,
      key: {
        min: PROJECT_KEY_MIN_LENGTH,
        max: PROJECT_KEY_MAX_LENGTH,
        check: (value) =>
          isValidProjectKey(value) ? undefined : `String should match pattern '${PROJECT_KEY_PATTERN.source}'`,
      },
    })
    const description = readDescription(body.description)
    if (description.error) errors.push(description.error)
    if (errors.length > 0) return validationErrorResponse(errors)
    // Keys are unique per workspace, archived projects included.
    if (projectsOf(workspace.id).some((project) => project.key === values.key)) {
      return reasonError('conflict', 'project_key_taken', MESSAGES.keyTaken)
    }
    const project = createProject(
      { workspaceId: workspace.id, name: values.name, key: values.key, description: description.value },
      user.id,
    )
    logProjectActivity(project, user.id, 'project.created', { project: projectRef(project) })
    return HttpResponse.json<Project>(project, { status: 201 })
  }),

  http.get(`${API}/projects/:pid`, ({ params }) => {
    const access = requireProjectMember(params.pid)
    if (access instanceof Response) return access
    return HttpResponse.json<Project>(access.project)
  }),

  http.patch(`${API}/projects/:pid`, async ({ params, request }) => {
    const access = requireProjectMember(params.pid)
    if (access instanceof Response) return access
    const { project, membership } = access
    if (!can(membership.role, 'project.manage')) {
      return reasonError('forbidden', 'insufficient_role', MESSAGES.insufficientRole)
    }
    const body = await readJsonObject(request)
    if (body instanceof Response) return body
    // Only `name` and `description` can change; the key is immutable (a `key` is ignored).
    const errors: FieldError[] = []
    let name: string | undefined
    if (body.name !== undefined) {
      const checked = validateStrings({ name: body.name }, { name: NAME_RULE })
      errors.push(...checked.errors)
      name = checked.values.name
    }
    const description = body.description === undefined ? undefined : readDescription(body.description)
    if (description?.error) errors.push(description.error)
    if (errors.length > 0) return validationErrorResponse(errors)

    // One project.updated entry naming every changed field; the description's values are left
    // out (contract 3.8). Nothing changed, nothing recorded.
    const changedFields: string[] = []
    const before: Record<string, unknown> = {}
    const after: Record<string, unknown> = {}
    if (name !== undefined && name !== project.name) {
      changedFields.push('name')
      before.name = project.name
      after.name = name
      project.name = name
    }
    if (description && description.value !== project.description) {
      changedFields.push('description')
      project.description = description.value
    }
    if (changedFields.length > 0) {
      logProjectActivity(project, membership.user_id, 'project.updated', {
        project: projectRef(project),
        changed_fields: changedFields,
        before,
        after,
      })
    }
    return HttpResponse.json<Project>(project)
  }),

  http.post(`${API}/projects/:pid/archive`, ({ params }) => {
    const access = requireProjectMember(params.pid)
    if (access instanceof Response) return access
    const { project, membership } = access
    if (!can(membership.role, 'project.manage')) {
      return reasonError('forbidden', 'insufficient_role', MESSAGES.insufficientRole)
    }
    if (project.archived_at !== null) {
      return reasonError('conflict', 'already_archived', MESSAGES.alreadyArchived)
    }
    project.archived_at = new Date().toISOString()
    logProjectActivity(project, membership.user_id, 'project.archived', { project: projectRef(project) })
    return HttpResponse.json<Project>(project)
  }),
]
