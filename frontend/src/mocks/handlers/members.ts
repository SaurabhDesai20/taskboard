// Contract section 3.4 (Members) and the membership rules of 1.10.
import { http, HttpResponse } from 'msw'
import type { FieldError, Member, Role } from '../../api/types'
import { can } from '../../lib/permissions'
import { isValidEmail } from '../../lib/validation'
import {
  db,
  findMembership,
  findUserByEmail,
  membershipsOf,
  removeMembership,
  roleRank,
  type MockMembershipRecord,
} from '../db'
import {
  API,
  compareText,
  errorResponse,
  invalidUuidParams,
  readJsonObject,
  readRole,
  reasonError,
  requireWorkspaceMember,
  validateStrings,
  validationErrorResponse,
} from '../http'

// Wording from contract 3.4 where it gives one.
const MESSAGES = {
  insufficientRole: 'Only owners and admins can add, remove or change members',
  ownRole: 'You cannot change your own role',
  protectedTarget: 'Only owners can change or remove owners and admins',
  protectedGrant: 'Only owners can grant the admin or owner role',
  lastOwner: 'A workspace must keep at least one owner',
  lastOwnerLeaving: 'You are the only owner. Make another member an owner before leaving the workspace',
  alreadyMember: 'This user is already a member of the workspace',
  noUser: 'No user with this email',
  memberNotFound: 'Member not found',
}

/** Roles admins may grant and act on (owners and admins are protected from admins). */
const BELOW_ADMIN: readonly Role[] = ['member', 'viewer']

function toMember(record: MockMembershipRecord): Member {
  const user = db.users.find((candidate) => candidate.id === record.user_id)
  return {
    user_id: record.user_id,
    email: user?.email ?? '',
    name: user?.name ?? '',
    role: record.role,
    joined_at: record.joined_at,
  }
}

/** Owner first, then admin, member, viewer; by name (case-insensitive) within a role. */
function byRoleThenName(a: Member, b: Member): number {
  return roleRank(a.role) - roleRank(b.role) || compareText(a.name, b.name)
}

function ownerCount(workspaceId: string): number {
  return membershipsOf(workspaceId).filter((member) => member.role === 'owner').length
}

/** Whether an actor with `actorRole` may act on a member holding (or getting) `role`. */
function mayTouch(actorRole: Role, role: Role): boolean {
  return can(actorRole, 'member.promote') || BELOW_ADMIN.includes(role)
}

export const memberHandlers = [
  http.get(`${API}/workspaces/:wid/members`, ({ params }) => {
    const access = requireWorkspaceMember(params.wid)
    if (access instanceof Response) return access
    const members = membershipsOf(access.workspace.id).map(toMember).sort(byRoleThenName)
    return HttpResponse.json<Member[]>(members)
  }),

  http.post(`${API}/workspaces/:wid/members`, async ({ params, request }) => {
    const access = requireWorkspaceMember(params.wid)
    if (access instanceof Response) return access
    const { workspace, membership } = access
    if (!can(membership.role, 'member.manage')) {
      return reasonError('forbidden', 'insufficient_role', MESSAGES.insufficientRole)
    }
    const body = await readJsonObject(request)
    if (body instanceof Response) return body
    const { values, errors } = validateStrings(body, {
      email: { max: 254, check: (value) => (isValidEmail(value) ? undefined : 'value is not a valid email address') },
    })
    const role = readRole(body)
    if (typeof role !== 'string') errors.push(role)
    if (errors.length > 0 || typeof role !== 'string') return validationErrorResponse(errors)

    if (!mayTouch(membership.role, role)) {
      return reasonError('forbidden', 'protected_member', MESSAGES.protectedGrant)
    }
    const user = findUserByEmail(values.email)
    if (!user) {
      const error: FieldError = { field: 'email', location: 'body', message: MESSAGES.noUser }
      return validationErrorResponse([error])
    }
    if (findMembership(workspace.id, user.id)) {
      return reasonError('conflict', 'already_member', MESSAGES.alreadyMember)
    }
    const record: MockMembershipRecord = {
      workspace_id: workspace.id,
      user_id: user.id,
      role,
      joined_at: new Date().toISOString(),
    }
    db.members.push(record)
    return HttpResponse.json<Member>(toMember(record), { status: 201 })
  }),

  http.patch(`${API}/workspaces/:wid/members/:uid`, async ({ params, request }) => {
    const invalid = invalidUuidParams({ wid: params.wid, uid: params.uid })
    if (invalid) return invalid
    const access = requireWorkspaceMember(params.wid)
    if (access instanceof Response) return access
    const { user, workspace, membership } = access
    if (!can(membership.role, 'member.manage')) {
      return reasonError('forbidden', 'insufficient_role', MESSAGES.insufficientRole)
    }
    const body = await readJsonObject(request)
    if (body instanceof Response) return body
    // `role` is optional: `{}` returns the member unchanged after the checks below.
    const role = body.role === undefined ? undefined : readRole(body)
    if (typeof role === 'object') return validationErrorResponse([role])

    if (params.uid === user.id) {
      return reasonError('forbidden', 'own_role', MESSAGES.ownRole)
    }
    const target = findMembership(workspace.id, params.uid as string)
    if (!target) return errorResponse('not_found', MESSAGES.memberNotFound)
    if (!mayTouch(membership.role, target.role)) {
      return reasonError('forbidden', 'protected_member', MESSAGES.protectedTarget)
    }
    if (role && !mayTouch(membership.role, role)) {
      return reasonError('forbidden', 'protected_member', MESSAGES.protectedGrant)
    }
    if (role && target.role === 'owner' && role !== 'owner' && ownerCount(workspace.id) === 1) {
      return reasonError('conflict', 'last_owner', MESSAGES.lastOwner)
    }
    if (role) target.role = role
    return HttpResponse.json<Member>(toMember(target))
  }),

  http.delete(`${API}/workspaces/:wid/members/:uid`, ({ params }) => {
    const invalid = invalidUuidParams({ wid: params.wid, uid: params.uid })
    if (invalid) return invalid
    const access = requireWorkspaceMember(params.wid)
    if (access instanceof Response) return access
    const { user, workspace, membership } = access
    const leaving = params.uid === user.id

    if (!leaving) {
      if (!can(membership.role, 'member.manage')) {
        return reasonError('forbidden', 'insufficient_role', MESSAGES.insufficientRole)
      }
    }
    const target = leaving ? membership : findMembership(workspace.id, params.uid as string)
    if (!target) return errorResponse('not_found', MESSAGES.memberNotFound)
    if (!leaving && !mayTouch(membership.role, target.role)) {
      return reasonError('forbidden', 'protected_member', MESSAGES.protectedTarget)
    }
    if (target.role === 'owner' && ownerCount(workspace.id) === 1) {
      return reasonError('conflict', 'last_owner', leaving ? MESSAGES.lastOwnerLeaving : MESSAGES.lastOwner)
    }
    removeMembership(workspace.id, target.user_id)
    return new HttpResponse(null, { status: 204 })
  }),
]
