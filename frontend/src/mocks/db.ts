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
//
// Tasks (due dates relative to the day the mock is reset, so "overdue" always means something):
//
// | Task | Column | Priority | Assignee | Due |
// |---|---|---|---|---|
// | WEB-2 Write onboarding copy | To Do | Medium | - | - |
// | WEB-3 Design pricing page | To Do | High | Asha | today - 2 (overdue) |
// | WEB-4 Set up analytics | To Do | Low | Dana | today + 3 |
// | WEB-1 Fix login redirect | In Progress | High | Ben | today + 9 |
// | WEB-7 Accessibility audit | In Progress | Medium | Asha | today + 20 |
// | WEB-5 Review signup form | In Review | Urgent | Asha | today |
// | WEB-6 Launch announcement | Done | Medium | Ben | today - 5 (done, so not overdue) |
// | APP-1 Push notifications | To Do | Medium | Asha | - |
// | APP-2 Offline mode | In Progress | High | Ben | today + 5 |
// | CRM-1 Export customer data | To Do | Low | Asha | today - 10 (archived project) |
// | OPS-1 Rotate API keys | To Do | Urgent | Asha | today - 1 (overdue) |
// | OPS-2 Update runbook | In Review | Low | Ben | - |
//
// Comments (times relative to the reset, so they read "3 hours ago"). Tasks' `comment_count` is
// always counted from these:
//
// | Task | Comments, oldest first |
// |---|---|
// | WEB-1 | Ben (3 hours ago), Asha (2 hours ago, edited, two lines) |
// | WEB-5 | Dana (2 days ago), Ben (yesterday), Asha (30 minutes ago) |
import type {
  CommentRead,
  DateOnly,
  Project,
  Role,
  Task,
  TaskPriority,
  TaskStatus,
  User,
  UUID,
  Workspace,
} from '../api/types'
import { addDays, todayDateOnly } from '../lib/dates'
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

/** A task as stored: the assignee by id (the API embeds `{ id, name }`), the key derived. */
export interface MockTaskRecord {
  id: UUID
  project_id: UUID
  workspace_id: UUID
  number: number
  title: string
  description: string | null
  status: TaskStatus
  priority: TaskPriority
  position: number
  assignee_id: UUID | null
  due_date: DateOnly | null
  created_by: UUID
  created_at: string
  updated_at: string
}

const taskId = (n: number) => `40000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Ids of the seeded tasks (see the table at the top). */
export const MOCK_TASK_IDS = {
  web1: taskId(1),
  web2: taskId(2),
  web3: taskId(3),
  web4: taskId(4),
  web5: taskId(5),
  web6: taskId(6),
  web7: taskId(7),
  app1: taskId(8),
  app2: taskId(9),
  crm1: taskId(10),
  ops1: taskId(11),
  ops2: taskId(12),
} as const

interface SeedTask {
  id: UUID
  project: MockProjectRecord
  number: number
  title: string
  description?: string
  status: TaskStatus
  priority: TaskPriority
  position: number
  assignee?: MockUserRecord
  /** Days from today; no due date when left out. */
  dueInDays?: number
  createdAt: string
}

function seedTasks(): MockTaskRecord[] {
  const { website, mobile, legacy, operations } = MOCK_PROJECTS
  const { asha, ben, dana } = MOCK_USERS
  const ids = MOCK_TASK_IDS
  const today = todayDateOnly()
  const seeds: SeedTask[] = [
    {
      id: ids.web1,
      project: website,
      number: 1,
      title: 'Fix login redirect',
      description: 'After login users land on /404 instead of the dashboard.',
      status: 'in_progress',
      priority: 'high',
      position: 1024,
      assignee: ben,
      dueInDays: 9,
      createdAt: '2026-11-22T09:20:00Z',
    },
    {
      id: ids.web2,
      project: website,
      number: 2,
      title: 'Write onboarding copy',
      status: 'todo',
      priority: 'medium',
      position: 1024,
      createdAt: '2026-11-22T09:21:00Z',
    },
    {
      id: ids.web3,
      project: website,
      number: 3,
      title: 'Design pricing page',
      status: 'todo',
      priority: 'high',
      position: 2048,
      assignee: asha,
      dueInDays: -2,
      createdAt: '2026-11-22T09:22:00Z',
    },
    {
      id: ids.web4,
      project: website,
      number: 4,
      title: 'Set up analytics',
      status: 'todo',
      priority: 'low',
      position: 3072,
      assignee: dana,
      dueInDays: 3,
      createdAt: '2026-11-22T09:23:00Z',
    },
    {
      id: ids.web5,
      project: website,
      number: 5,
      title: 'Review signup form',
      status: 'in_review',
      priority: 'urgent',
      position: 1024,
      assignee: asha,
      dueInDays: 0,
      createdAt: '2026-11-22T09:24:00Z',
    },
    {
      id: ids.web6,
      project: website,
      number: 6,
      title: 'Launch announcement',
      status: 'done',
      priority: 'medium',
      position: 1024,
      assignee: ben,
      dueInDays: -5,
      createdAt: '2026-11-22T09:25:00Z',
    },
    {
      id: ids.web7,
      project: website,
      number: 7,
      title: 'Accessibility audit',
      description: 'Keyboard and screen reader pass over the signup flow.',
      status: 'in_progress',
      priority: 'medium',
      position: 2048,
      assignee: asha,
      dueInDays: 20,
      createdAt: '2026-11-22T09:26:00Z',
    },
    {
      id: ids.app1,
      project: mobile,
      number: 1,
      title: 'Push notifications',
      status: 'todo',
      priority: 'medium',
      position: 1024,
      assignee: asha,
      createdAt: '2026-11-22T09:30:00Z',
    },
    {
      id: ids.app2,
      project: mobile,
      number: 2,
      title: 'Offline mode',
      status: 'in_progress',
      priority: 'high',
      position: 1024,
      assignee: ben,
      dueInDays: 5,
      createdAt: '2026-11-22T09:31:00Z',
    },
    {
      id: ids.crm1,
      project: legacy,
      number: 1,
      title: 'Export customer data',
      status: 'todo',
      priority: 'low',
      position: 1024,
      assignee: asha,
      dueInDays: -10,
      createdAt: '2026-11-22T09:32:00Z',
    },
    {
      id: ids.ops1,
      project: operations,
      number: 1,
      title: 'Rotate API keys',
      status: 'todo',
      priority: 'urgent',
      position: 1024,
      assignee: asha,
      dueInDays: -1,
      createdAt: '2026-11-22T09:33:00Z',
    },
    {
      id: ids.ops2,
      project: operations,
      number: 2,
      title: 'Update runbook',
      status: 'in_review',
      priority: 'low',
      position: 1024,
      assignee: ben,
      createdAt: '2026-11-22T09:34:00Z',
    },
  ]
  return seeds.map((seed) => ({
    id: seed.id,
    project_id: seed.project.id,
    workspace_id: seed.project.workspace_id,
    number: seed.number,
    title: seed.title,
    description: seed.description ?? null,
    status: seed.status,
    priority: seed.priority,
    position: seed.position,
    assignee_id: seed.assignee?.id ?? null,
    due_date: seed.dueInDays === undefined ? null : addDays(today, seed.dueInDays),
    created_by: seed.project.created_by,
    created_at: seed.createdAt,
    updated_at: seed.createdAt,
  }))
}

/** A comment as stored: the author by id (the API embeds `{ id, name }`). */
export interface MockCommentRecord {
  id: UUID
  task_id: UUID
  workspace_id: UUID
  author_id: UUID
  body: string
  created_at: string
  edited_at: string | null
}

const commentId = (n: number) => `50000000-0000-4000-8000-${String(n).padStart(12, '0')}`

/** Ids of the seeded comments (see the table at the top). */
export const MOCK_COMMENT_IDS = {
  web1Ben: commentId(1),
  web1Asha: commentId(2),
  web5Dana: commentId(3),
  web5Ben: commentId(4),
  web5Asha: commentId(5),
} as const

const MINUTE_MS = 60_000

function seedComments(now: number): MockCommentRecord[] {
  const { asha, ben, dana } = MOCK_USERS
  const ids = MOCK_COMMENT_IDS
  const minutesAgo = (minutes: number) => new Date(now - minutes * MINUTE_MS).toISOString()
  const comment = (
    id: UUID,
    taskId: UUID,
    author: MockUserRecord,
    body: string,
    createdMinutesAgo: number,
    editedMinutesAgo?: number,
  ): MockCommentRecord => ({
    id,
    task_id: taskId,
    workspace_id: MOCK_WORKSPACES.acme.id,
    author_id: author.id,
    body,
    created_at: minutesAgo(createdMinutesAgo),
    edited_at: editedMinutesAgo === undefined ? null : minutesAgo(editedMinutesAgo),
  })
  return [
    comment(ids.web1Ben, MOCK_TASK_IDS.web1, ben, 'Reproduced on Chrome and Firefox.', 180),
    comment(
      ids.web1Asha,
      MOCK_TASK_IDS.web1,
      asha,
      'Thanks! Can you check Safari too?\nIt may be the same cookie issue.',
      120,
      60,
    ),
    comment(ids.web5Dana, MOCK_TASK_IDS.web5, dana, 'The password rules only show up after the first error.', 2 * 24 * 60),
    comment(ids.web5Ben, MOCK_TASK_IDS.web5, ben, 'Agreed. I will move the hint above the field.', 24 * 60 + 30),
    comment(ids.web5Asha, MOCK_TASK_IDS.web5, asha, 'Looks good to me once the hint moves.', 30),
  ]
}

interface MockDb {
  users: MockUserRecord[]
  workspaces: MockWorkspaceRecord[]
  members: MockMembershipRecord[]
  projects: MockProjectRecord[]
  tasks: MockTaskRecord[]
  comments: MockCommentRecord[]
  /** The last comment time handed out (ms), so a new comment always sorts after older ones. */
  lastCommentAt: number
  /** The last task number used per project id (numbers are never reused). */
  taskNumbers: Record<UUID, number>
  /** Stands in for the httpOnly session cookie: the id of the signed-in user, or null. */
  sessionUserId: string | null
}

export const db: MockDb = {
  users: [],
  workspaces: [],
  members: [],
  projects: [],
  tasks: [],
  comments: [],
  lastCommentAt: 0,
  taskNumbers: {},
  sessionUserId: null,
}

export function resetMockDb(): void {
  db.users = Object.values(MOCK_USERS).map((user) => ({ ...user }))
  db.workspaces = Object.values(MOCK_WORKSPACES).map((workspace) => ({ ...workspace }))
  db.members = seedMembers()
  db.projects = Object.values(MOCK_PROJECTS).map((project) => ({ ...project }))
  db.tasks = seedTasks()
  db.comments = seedComments(Date.now())
  db.lastCommentAt = 0
  db.taskNumbers = {}
  for (const task of db.tasks) {
    db.taskNumbers[task.project_id] = Math.max(db.taskNumbers[task.project_id] ?? 0, task.number)
  }
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
  db.tasks = db.tasks.filter((task) => task.workspace_id !== id)
  db.comments = db.comments.filter((comment) => comment.workspace_id !== id)
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

// ---------------------------------------------------------------------------------------------
// Tasks
// ---------------------------------------------------------------------------------------------

export function findTask(id: UUID): MockTaskRecord | undefined {
  return db.tasks.find((task) => task.id === id)
}

/** Every task of a project, in no particular order. */
export function tasksOf(projectId: UUID): MockTaskRecord[] {
  return db.tasks.filter((task) => task.project_id === projectId)
}

/** The API shape: the assignee as `{ id, name }` and the key built from the project's key. */
export function toTask(record: MockTaskRecord): Task {
  const { assignee_id: assigneeId, ...fields } = record
  const assignee = assigneeId ? db.users.find((user) => user.id === assigneeId) : undefined
  const projectKey = findProject(record.project_id)?.key ?? '?'
  return {
    ...fields,
    key: `${projectKey}-${record.number}`,
    assignee: assignee ? { id: assignee.id, name: assignee.name } : null,
    // Counted, never stored, so it always matches the mock comments.
    comment_count: db.comments.filter((comment) => comment.task_id === record.id).length,
  }
}

type NewTaskFields = Omit<MockTaskRecord, 'id' | 'number' | 'created_at' | 'updated_at'>

/** Adds a task with the project's next number (numbers are never reused, even after deletes). */
export function createTask(fields: NewTaskFields): MockTaskRecord {
  const number = (db.taskNumbers[fields.project_id] ?? 0) + 1
  db.taskNumbers[fields.project_id] = number
  const now = new Date().toISOString()
  const task: MockTaskRecord = { ...fields, id: crypto.randomUUID(), number, created_at: now, updated_at: now }
  db.tasks.push(task)
  return task
}

/** Deletes the task and its comments (contract 3.6). */
export function deleteTask(id: UUID): void {
  db.tasks = db.tasks.filter((task) => task.id !== id)
  db.comments = db.comments.filter((comment) => comment.task_id !== id)
}

/** Test helper: the task keys of each column of a project, in position order. */
export function columnKeys(projectId: UUID): Record<TaskStatus, string[]> {
  const columns: Record<TaskStatus, string[]> = { todo: [], in_progress: [], in_review: [], done: [] }
  for (const task of [...tasksOf(projectId)].sort((a, b) => a.position - b.position || a.number - b.number)) {
    columns[task.status].push(toTask(task).key)
  }
  return columns
}

// ---------------------------------------------------------------------------------------------
// Comments
// ---------------------------------------------------------------------------------------------

export function findComment(id: UUID): MockCommentRecord | undefined {
  return db.comments.find((comment) => comment.id === id)
}

/** Server order (contract 3.7): oldest first, then by id. */
export function compareComments(a: MockCommentRecord, b: MockCommentRecord): number {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? -1 : 1
  if (a.id === b.id) return 0
  return a.id < b.id ? -1 : 1
}

/** A task's comments, oldest first. */
export function commentsOf(taskId: UUID): MockCommentRecord[] {
  return db.comments.filter((comment) => comment.task_id === taskId).sort(compareComments)
}

export function toComment(record: MockCommentRecord): CommentRead {
  const author = db.users.find((user) => user.id === record.author_id)
  return {
    id: record.id,
    task_id: record.task_id,
    author: { id: record.author_id, name: author?.name ?? 'Unknown user' },
    body: record.body,
    created_at: record.created_at,
    edited_at: record.edited_at,
  }
}

/** Now, but always after the previous one, so comments made in one millisecond keep their order. */
export function nextCommentTimestamp(): string {
  db.lastCommentAt = Math.max(Date.now(), db.lastCommentAt + 1)
  return new Date(db.lastCommentAt).toISOString()
}

/**
 * Adds a comment to a task. `POST /tasks/{tid}/comments` uses it; tests use it to set up a thread
 * (`createdAt` defaults to now).
 */
export function createComment(fields: {
  taskId: UUID
  authorId: UUID
  body: string
  createdAt?: string
  editedAt?: string | null
}): MockCommentRecord {
  const task = findTask(fields.taskId)
  if (!task) throw new Error(`No mock task ${fields.taskId}`)
  const comment: MockCommentRecord = {
    id: crypto.randomUUID(),
    task_id: task.id,
    workspace_id: task.workspace_id,
    author_id: fields.authorId,
    body: fields.body,
    created_at: fields.createdAt ?? nextCommentTimestamp(),
    edited_at: fields.editedAt ?? null,
  }
  db.comments.push(comment)
  return comment
}

export function deleteComment(id: UUID): void {
  db.comments = db.comments.filter((comment) => comment.id !== id)
}
