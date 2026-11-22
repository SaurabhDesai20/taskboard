// In-memory data behind the MSW handlers. Module-level, so it lasts until a page reload in the
// browser; tests call resetMockDb() (via resetMockState) after each test.
//
// Seed (every user signs in with the password `correct-horse-battery`):
//
// | User | Acme (`acme`) | Globex (`globex`) |
// |---|---|---|
// | Asha Rao (DEMO_USER) | owner | member |
// | Dana Kim | admin | - |
// | Ben Okafor | member | owner |
// | Chen Wei | viewer | - |
// | Eve Santos | - | - |
//
// Projects: Acme has Website (WEB), Mobile App (APP) and the archived Legacy CRM (CRM);
// Globex has Operations (OPS).
import type { Project, Role, User, UUID, Workspace } from '../api/types'
import { ROLES } from '../lib/permissions'

export interface MockUserRecord extends User {
  /** Plain text: this is a mock. The real backend stores a hash. */
  password: string
}

export interface MockWorkspaceRecord {
  id: UUID
  name: string
  slug: string
  created_by: UUID
  created_at: string
}

export interface MockMembershipRecord {
  workspace_id: UUID
  user_id: UUID
  role: Role
  joined_at: string
}

const PASSWORD = 'correct-horse-battery'

function seedUser(n: number, email: string, name: string): Readonly<MockUserRecord> {
  return {
    id: `10000000-0000-4000-8000-00000000000${n}`,
    email,
    name,
    password: PASSWORD,
    created_at: '2026-11-22T09:00:00Z',
  }
}

/** Seeded accounts; the contract's example users plus an admin and a user with no workspace. */
export const MOCK_USERS = {
  asha: seedUser(1, 'asha@example.com', 'Asha Rao'),
  ben: seedUser(2, 'ben@example.com', 'Ben Okafor'),
  chen: seedUser(3, 'chen@example.com', 'Chen Wei'),
  dana: seedUser(4, 'dana@example.com', 'Dana Kim'),
  eve: seedUser(5, 'eve@example.com', 'Eve Santos'),
} as const

/** Seeded account, matching the contract's example user (sign in with it in mock mode). */
export const DEMO_USER: Readonly<MockUserRecord> = MOCK_USERS.asha

export const MOCK_WORKSPACES = {
  acme: {
    id: '20000000-0000-4000-8000-000000000001',
    name: 'Acme',
    slug: 'acme',
    created_by: MOCK_USERS.asha.id,
    created_at: '2026-11-22T09:05:00Z',
  },
  globex: {
    id: '20000000-0000-4000-8000-000000000002',
    name: 'Globex',
    slug: 'globex',
    created_by: MOCK_USERS.ben.id,
    created_at: '2026-11-22T09:06:00Z',
  },
} as const satisfies Record<string, MockWorkspaceRecord>

function seedMembers(): MockMembershipRecord[] {
  const { acme, globex } = MOCK_WORKSPACES
  const { asha, ben, chen, dana } = MOCK_USERS
  return [
    { workspace_id: acme.id, user_id: asha.id, role: 'owner', joined_at: '2026-11-22T09:05:00Z' },
    { workspace_id: acme.id, user_id: dana.id, role: 'admin', joined_at: '2026-11-22T09:07:00Z' },
    { workspace_id: acme.id, user_id: ben.id, role: 'member', joined_at: '2026-11-22T09:10:00Z' },
    { workspace_id: acme.id, user_id: chen.id, role: 'viewer', joined_at: '2026-11-22T09:12:00Z' },
    { workspace_id: globex.id, user_id: ben.id, role: 'owner', joined_at: '2026-11-22T09:06:00Z' },
    { workspace_id: globex.id, user_id: asha.id, role: 'member', joined_at: '2026-11-22T09:08:00Z' },
  ]
}

/** Stored exactly as the API returns it. */
export type MockProjectRecord = Project

export const MOCK_PROJECTS = {
  website: {
    id: '30000000-0000-4000-8000-000000000001',
    workspace_id: MOCK_WORKSPACES.acme.id,
    name: 'Website',
    key: 'WEB',
    description: 'Marketing site and signup flow',
    archived_at: null,
    created_by: MOCK_USERS.asha.id,
    created_at: '2026-11-22T09:15:00Z',
  },
  mobile: {
    id: '30000000-0000-4000-8000-000000000002',
    workspace_id: MOCK_WORKSPACES.acme.id,
    name: 'Mobile App',
    key: 'APP',
    description: null,
    archived_at: null,
    created_by: MOCK_USERS.dana.id,
    created_at: '2026-11-22T09:18:00Z',
  },
  legacy: {
    id: '30000000-0000-4000-8000-000000000003',
    workspace_id: MOCK_WORKSPACES.acme.id,
    name: 'Legacy CRM',
    key: 'CRM',
    description: 'The old customer database, kept for reference',
    archived_at: '2026-11-22T09:40:00Z',
    created_by: MOCK_USERS.asha.id,
    created_at: '2026-11-22T09:16:00Z',
  },
  operations: {
    id: '30000000-0000-4000-8000-000000000004',
    workspace_id: MOCK_WORKSPACES.globex.id,
    name: 'Operations',
    key: 'OPS',
    description: 'Internal tooling',
    archived_at: null,
    created_by: MOCK_USERS.ben.id,
    created_at: '2026-11-22T09:20:00Z',
  },
} as const satisfies Record<string, MockProjectRecord>

interface MockDb {
  users: MockUserRecord[]
  workspaces: MockWorkspaceRecord[]
  members: MockMembershipRecord[]
  projects: MockProjectRecord[]
  /** Stands in for the httpOnly session cookie: the id of the signed-in user, or null. */
  sessionUserId: string | null
}

export const db: MockDb = { users: [], workspaces: [], members: [], projects: [], sessionUserId: null }

export function resetMockDb(): void {
  db.users = Object.values(MOCK_USERS).map((user) => ({ ...user }))
  db.workspaces = Object.values(MOCK_WORKSPACES).map((workspace) => ({ ...workspace }))
  db.members = seedMembers()
  db.projects = Object.values(MOCK_PROJECTS).map((project) => ({ ...project }))
  db.sessionUserId = null
}

resetMockDb()

// ---------------------------------------------------------------------------------------------
// Users and session
// ---------------------------------------------------------------------------------------------

export function toUser({ id, email, name, created_at }: MockUserRecord): User {
  return { id, email, name, created_at }
}

export function findUserByEmail(email: string): MockUserRecord | undefined {
  const wanted = email.toLowerCase()
  return db.users.find((user) => user.email === wanted)
}

export function createUser(fields: { email: string; name: string; password: string }): MockUserRecord {
  const user: MockUserRecord = {
    id: crypto.randomUUID(),
    email: fields.email.toLowerCase(),
    name: fields.name,
    password: fields.password,
    created_at: new Date().toISOString(),
  }
  db.users.push(user)
  return user
}

export function sessionUser(): MockUserRecord | null {
  return db.users.find((user) => user.id === db.sessionUserId) ?? null
}

/** Sign a user in, as if the backend had set the cookie. Tests use it to start logged in. */
export function startMockSession(userId: string = DEMO_USER.id): void {
  db.sessionUserId = userId
}

/** Sign out, or simulate an expired cookie. */
export function endMockSession(): void {
  db.sessionUserId = null
}

// ---------------------------------------------------------------------------------------------
// Workspaces and memberships
// ---------------------------------------------------------------------------------------------

export function findWorkspace(id: UUID): MockWorkspaceRecord | undefined {
  return db.workspaces.find((workspace) => workspace.id === id)
}

export function findWorkspaceBySlug(slug: string): MockWorkspaceRecord | undefined {
  return db.workspaces.find((workspace) => workspace.slug === slug)
}

export function findMembership(workspaceId: UUID, userId: UUID): MockMembershipRecord | undefined {
  return db.members.find((member) => member.workspace_id === workspaceId && member.user_id === userId)
}

export function membershipsOf(workspaceId: UUID): MockMembershipRecord[] {
  return db.members.filter((member) => member.workspace_id === workspaceId)
}

export function toWorkspace(workspace: MockWorkspaceRecord, myRole: Role): Workspace {
  return { ...workspace, my_role: myRole }
}

export function createWorkspace(fields: { name: string; slug: string }, ownerId: UUID): MockWorkspaceRecord {
  const now = new Date().toISOString()
  const workspace: MockWorkspaceRecord = {
    id: crypto.randomUUID(),
    name: fields.name,
    slug: fields.slug,
    created_by: ownerId,
    created_at: now,
  }
  db.workspaces.push(workspace)
  db.members.push({ workspace_id: workspace.id, user_id: ownerId, role: 'owner', joined_at: now })
  return workspace
}

export function deleteWorkspace(id: UUID): void {
  db.workspaces = db.workspaces.filter((workspace) => workspace.id !== id)
  db.members = db.members.filter((member) => member.workspace_id !== id)
  db.projects = db.projects.filter((project) => project.workspace_id !== id)
}

export function removeMembership(workspaceId: UUID, userId: UUID): void {
  db.members = db.members.filter(
    (member) => !(member.workspace_id === workspaceId && member.user_id === userId),
  )
}

/** Test helper: put `userId` into `workspaceId` with `role` (or change their role). */
export function setMockMembership(workspaceId: UUID, userId: UUID, role: Role): void {
  const existing = findMembership(workspaceId, userId)
  if (existing) {
    existing.role = role
  } else {
    db.members.push({ workspace_id: workspaceId, user_id: userId, role, joined_at: new Date().toISOString() })
  }
}

export function roleRank(role: Role): number {
  return ROLES.indexOf(role)
}

// ---------------------------------------------------------------------------------------------
// Projects
// ---------------------------------------------------------------------------------------------

export function findProject(id: UUID): MockProjectRecord | undefined {
  return db.projects.find((project) => project.id === id)
}

/** Every project of a workspace, archived ones included. */
export function projectsOf(workspaceId: UUID): MockProjectRecord[] {
  return db.projects.filter((project) => project.workspace_id === workspaceId)
}

export function createProject(
  fields: { workspaceId: UUID; name: string; key: string; description: string | null },
  creatorId: UUID,
): MockProjectRecord {
  const project: MockProjectRecord = {
    id: crypto.randomUUID(),
    workspace_id: fields.workspaceId,
    name: fields.name,
    key: fields.key,
    description: fields.description,
    archived_at: null,
    created_by: creatorId,
    created_at: new Date().toISOString(),
  }
  db.projects.push(project)
  return project
}
