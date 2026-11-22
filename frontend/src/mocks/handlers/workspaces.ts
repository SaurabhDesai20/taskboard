// Contract section 3.3 (Workspaces).
import { http, HttpResponse } from 'msw'
import type { FieldError, Workspace } from '../../api/types'
import { can } from '../../lib/permissions'
import { deriveSlug, SLUG_MAX_LENGTH, SLUG_PATTERN } from '../../lib/slug'
import {
  createWorkspace,
  db,
  deleteWorkspace,
  findWorkspace,
  findWorkspaceBySlug,
  toWorkspace,
} from '../db'
import {
  API,
  compareText,
  readJsonObject,
  reasonError,
  requireUser,
  requireWorkspaceMember,
  validateStrings,
  validationErrorResponse,
} from '../http'

const NAME_RULE = { min: 1, max: 100 }

/** By name, case-insensitive (contract 3.3). */
const byName = (a: Workspace, b: Workspace) => compareText(a.name, b.name) || compareText(a.id, b.id)

/** Explicit slug from a create body: `undefined`/`null` mean "derive it", anything else is checked. */
function readSlug(raw: unknown): { slug: string | null; error?: FieldError } {
  if (raw === undefined || raw === null) return { slug: null }
  const fail = (message: string) => ({ slug: null, error: { field: 'slug', location: 'body' as const, message } })
  if (typeof raw !== 'string') return fail('Input should be a valid string')
  const slug = raw.trim()
  if (slug.length < 1) return fail('String should have at least 1 character')
  if (slug.length > SLUG_MAX_LENGTH) return fail(`String should have at most ${SLUG_MAX_LENGTH} characters`)
  if (!SLUG_PATTERN.test(slug)) return fail(`String should match pattern '${SLUG_PATTERN.source}'`)
  return { slug }
}

/** The derived slug, made unique with `-2`, `-3`, ... (kept within 48 characters). */
function uniqueSlug(name: string): string {
  const base = deriveSlug(name)
  if (!findWorkspaceBySlug(base)) return base
  for (let n = 2; ; n += 1) {
    const suffix = `-${n}`
    const candidate = `${base.slice(0, SLUG_MAX_LENGTH - suffix.length).replace(/-+$/, '')}${suffix}`
    if (!findWorkspaceBySlug(candidate)) return candidate
  }
}

export const workspaceHandlers = [
  http.get(`${API}/workspaces`, () => {
    const user = requireUser()
    if (user instanceof Response) return user
    const workspaces = db.members
      .filter((member) => member.user_id === user.id)
      .flatMap((member) => {
        const workspace = findWorkspace(member.workspace_id)
        return workspace ? [toWorkspace(workspace, member.role)] : []
      })
      .sort(byName)
    return HttpResponse.json<Workspace[]>(workspaces)
  }),

  http.post(`${API}/workspaces`, async ({ request }) => {
    const user = requireUser()
    if (user instanceof Response) return user
    const body = await readJsonObject(request)
    if (body instanceof Response) return body
    const { values, errors } = validateStrings(body, { name: NAME_RULE })
    const { slug, error: slugError } = readSlug(body.slug)
    if (slugError) errors.push(slugError)
    if (errors.length > 0) return validationErrorResponse(errors)
    if (slug && findWorkspaceBySlug(slug)) {
      return reasonError('conflict', 'slug_taken', 'This workspace URL is already taken')
    }
    const workspace = createWorkspace({ name: values.name, slug: slug ?? uniqueSlug(values.name) }, user.id)
    return HttpResponse.json<Workspace>(toWorkspace(workspace, 'owner'), { status: 201 })
  }),

  http.get(`${API}/workspaces/:wid`, ({ params }) => {
    const access = requireWorkspaceMember(params.wid)
    if (access instanceof Response) return access
    return HttpResponse.json<Workspace>(toWorkspace(access.workspace, access.membership.role))
  }),

  http.patch(`${API}/workspaces/:wid`, async ({ params, request }) => {
    const access = requireWorkspaceMember(params.wid)
    if (access instanceof Response) return access
    const { workspace, membership } = access
    if (!can(membership.role, 'workspace.manage')) {
      return reasonError('forbidden', 'insufficient_role', 'Only owners can rename the workspace')
    }
    const body = await readJsonObject(request)
    if (body instanceof Response) return body
    // Only `name` can change; other keys (the slug included) are ignored.
    if (body.name !== undefined) {
      const { values, errors } = validateStrings({ name: body.name }, { name: NAME_RULE })
      if (errors.length > 0) return validationErrorResponse(errors)
      workspace.name = values.name
    }
    return HttpResponse.json<Workspace>(toWorkspace(workspace, membership.role))
  }),

  http.delete(`${API}/workspaces/:wid`, ({ params }) => {
    const access = requireWorkspaceMember(params.wid)
    if (access instanceof Response) return access
    if (!can(access.membership.role, 'workspace.manage')) {
      return reasonError('forbidden', 'insufficient_role', 'Only owners can delete the workspace')
    }
    deleteWorkspace(access.workspace.id)
    return new HttpResponse(null, { status: 204 })
  }),
]
