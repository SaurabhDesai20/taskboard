import { describe, expect, it } from 'vitest'
import type { Role } from '../api/types'
import {
  ACTIONS,
  can,
  canChangeRole,
  canLeaveWorkspace,
  canRemoveMember,
  countOwners,
  grantableRoles,
  roleOptionsFor,
  ROLES,
  type Action,
} from './permissions'

// PLAN.md section 4, written out by hand (Y = allowed) so a typo in PERMISSIONS shows up here.
//                                     owner  admin  member viewer
const EXPECTED: Record<Action, [boolean, boolean, boolean, boolean]> = {
  'workspace.view': /*             */ [true, true, true, true],
  'task.write': /*                 */ [true, true, true, false],
  'comment.create': /*             */ [true, true, true, false],
  'comment.edit_own': /*           */ [true, true, true, false],
  'comment.delete_any': /*         */ [true, true, false, false],
  'task.delete': /*                */ [true, true, false, false],
  'project.manage': /*             */ [true, true, false, false],
  'member.manage': /*              */ [true, true, false, false],
  'member.promote': /*             */ [true, false, false, false],
  'workspace.manage': /*           */ [true, false, false, false],
}

const ROLE_COLUMNS: Role[] = ['owner', 'admin', 'member', 'viewer']

const MATRIX = ACTIONS.flatMap((action) =>
  ROLE_COLUMNS.map((role, column) => ({ role, action, allowed: EXPECTED[action][column] })),
)

describe('can(role, action)', () => {
  it('covers exactly the actions shared with the backend', () => {
    expect([...ACTIONS].sort()).toEqual(Object.keys(EXPECTED).sort())
    expect(MATRIX).toHaveLength(40)
  })

  it.each(MATRIX)('$role / $action -> $allowed', ({ role, action, allowed }) => {
    expect(can(role, action)).toBe(allowed)
  })

  it('allows nothing without a role', () => {
    for (const action of ACTIONS) {
      expect(can(undefined, action)).toBe(false)
      expect(can(null, action)).toBe(false)
    }
  })

  it('lists the roles highest first', () => {
    expect(ROLES).toEqual(['owner', 'admin', 'member', 'viewer'])
  })
})

describe('grantableRoles', () => {
  it.each([
    ['owner', ['owner', 'admin', 'member', 'viewer']],
    ['admin', ['member', 'viewer']],
    ['member', []],
    ['viewer', []],
  ] as const)('%s may grant %j', (role, expected) => {
    expect(grantableRoles(role)).toEqual(expected)
  })

  it('grants nothing without a role', () => {
    expect(grantableRoles(undefined)).toEqual([])
  })
})

const ME = 'me'
const OTHER = 'other'

describe('changing and removing other members', () => {
  // actor role -> target roles the actor may change or remove (never themselves)
  const MANAGEABLE: Record<Role, Role[]> = {
    owner: ['owner', 'admin', 'member', 'viewer'],
    admin: ['member', 'viewer'],
    member: [],
    viewer: [],
  }

  const cases = ROLE_COLUMNS.flatMap((actorRole) =>
    ROLE_COLUMNS.map((targetRole) => ({
      actorRole,
      targetRole,
      allowed: MANAGEABLE[actorRole].includes(targetRole),
    })),
  )

  it.each(cases)('$actorRole acting on a $targetRole -> $allowed', ({ actorRole, targetRole, allowed }) => {
    const actor = { userId: ME, role: actorRole }
    const target = { user_id: OTHER, role: targetRole }

    expect(canChangeRole(actor, target)).toBe(allowed)
    expect(canRemoveMember(actor, target)).toBe(allowed)
    expect(roleOptionsFor(actor, target)).toEqual(allowed ? grantableRoles(actorRole) : [])
  })

  it.each(ROLE_COLUMNS)('a %s cannot change their own role or "remove" themselves', (role) => {
    const actor = { userId: ME, role }
    const self = { user_id: ME, role }

    expect(canChangeRole(actor, self)).toBe(false)
    expect(roleOptionsFor(actor, self)).toEqual([])
    expect(canRemoveMember(actor, self)).toBe(false)
  })
})

describe('leaving', () => {
  it('lets every role leave, except the last owner', () => {
    expect(canLeaveWorkspace('owner', 1)).toBe(false)
    expect(canLeaveWorkspace('owner', 2)).toBe(true)
    for (const role of ['admin', 'member', 'viewer'] as const) {
      expect(canLeaveWorkspace(role, 1)).toBe(true)
    }
  })

  it('counts owners', () => {
    expect(
      countOwners([
        { user_id: 'a', role: 'owner' },
        { user_id: 'b', role: 'admin' },
        { user_id: 'c', role: 'owner' },
      ]),
    ).toBe(2)
  })
})
