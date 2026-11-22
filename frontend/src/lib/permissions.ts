// Mirror of the backend's role matrix (PLAN.md section 4, contract 1.10) and its membership rules.
// The UI uses it only to hide or disable actions; the backend stays the authority.
import type { Role, UUID } from '../api/types'

/** Every role, highest first (contract 1.9 display order). */
export const ROLES: readonly Role[] = ['owner', 'admin', 'member', 'viewer']

export const ROLE_LABELS: Readonly<Record<Role, string>> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  viewer: 'Viewer',
}

/**
 * Who may do what. The action identifiers are shared with the backend's `can()`, so this table
 * can be compared with `backend/app/services/permissions.py` line by line.
 */
export const PERMISSIONS = {
  /** View the workspace, its projects, tasks, comments and activity. */
  'workspace.view': ['owner', 'admin', 'member', 'viewer'],
  /** Create, edit and move tasks; assign them and set due dates. */
  'task.write': ['owner', 'admin', 'member'],
  'comment.create': ['owner', 'admin', 'member'],
  'comment.edit_own': ['owner', 'admin', 'member'],
  'comment.delete_any': ['owner', 'admin'],
  'task.delete': ['owner', 'admin'],
  /** Create, edit and archive projects. */
  'project.manage': ['owner', 'admin'],
  /** Add and remove members, change roles (member and viewer only for admins). */
  'member.manage': ['owner', 'admin'],
  /** Grant admin or owner, and act on other admins and owners. */
  'member.promote': ['owner'],
  /** Rename and delete the workspace. */
  'workspace.manage': ['owner'],
} as const satisfies Record<string, readonly Role[]>

export type Action = keyof typeof PERMISSIONS

export const ACTIONS = Object.keys(PERMISSIONS) as Action[]

/** Whether `role` allows `action`. No role (not a member, or still loading) allows nothing. */
export function can(role: Role | null | undefined, action: Action): boolean {
  if (!role) return false
  return (PERMISSIONS[action] as readonly Role[]).includes(role)
}

// ---------------------------------------------------------------------------------------------
// Membership rules (contract 1.10)
// ---------------------------------------------------------------------------------------------

/** The signed-in user as seen by the membership rules. */
export interface MemberActor {
  userId: UUID
  role: Role
}

/** The member being acted on (a `MemberRead` fits). */
export interface MemberTarget {
  user_id: UUID
  role: Role
}

/** Roles that admins may grant and act on; owners and admins are protected from admins. */
const ROLES_BELOW_ADMIN: readonly Role[] = ['member', 'viewer']

/** Roles `actorRole` may give when adding a member or changing a role. */
export function grantableRoles(actorRole: Role | null | undefined): Role[] {
  if (can(actorRole, 'member.promote')) return [...ROLES]
  if (can(actorRole, 'member.manage')) return [...ROLES_BELOW_ADMIN]
  return []
}

/** Whether the actor may manage this other member at all (`403 protected_member` otherwise). */
function mayActOn(actor: MemberActor, target: MemberTarget): boolean {
  if (!can(actor.role, 'member.manage')) return false
  return can(actor.role, 'member.promote') || ROLES_BELOW_ADMIN.includes(target.role)
}

/** Nobody may change their own role (`403 own_role`). */
export function isSelf(actor: MemberActor, target: MemberTarget): boolean {
  return actor.userId === target.user_id
}

export function canChangeRole(actor: MemberActor, target: MemberTarget): boolean {
  return !isSelf(actor, target) && mayActOn(actor, target)
}

/** The choices for a member's role dropdown; empty when the role cannot be changed. */
export function roleOptionsFor(actor: MemberActor, target: MemberTarget): Role[] {
  return canChangeRole(actor, target) ? grantableRoles(actor.role) : []
}

/** Removing someone else. Removing yourself is leaving: see `canLeaveWorkspace`. */
export function canRemoveMember(actor: MemberActor, target: MemberTarget): boolean {
  return !isSelf(actor, target) && mayActOn(actor, target)
}

export function countOwners(members: readonly MemberTarget[]): number {
  return members.filter((member) => member.role === 'owner').length
}

/** Any member may leave, except the last owner (`409 last_owner`). */
export function canLeaveWorkspace(role: Role, ownerCount: number): boolean {
  return role !== 'owner' || ownerCount > 1
}
