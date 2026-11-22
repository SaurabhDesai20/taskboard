// API types. Generated where the backend has published them (src/api/schema.d.ts, built from
// docs/openapi.json with `npm run gen:api`); hand-written from docs/api-contract.md otherwise.
// Hand-written types are named after the backend's Pydantic schemas so each one can later
// become a one-line alias of the generated type, e.g.
//   export type UserRead = components['schemas']['UserRead']
import type { components } from './schema'

type Schemas = components['schemas']

/** UUID v4 string (contract 1.2). */
export type UUID = string
/** ISO 8601 UTC timestamp with a `Z` suffix (contract 1.2). Parse with `new Date()`. */
export type Timestamp = string

// ---------------------------------------------------------------------------------------------
// Errors (contract 1.5)
// ---------------------------------------------------------------------------------------------

/** Error codes the backend sends in the error envelope. */
export type ApiErrorCode =
  | 'validation_error'
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'conflict'
  | 'rate_limited'
  | 'bad_request'
  | 'method_not_allowed'
  | 'internal_error'
  | 'service_unavailable'

/** Codes produced by the client itself when no envelope is available. */
export type ClientErrorCode = 'network_error' | 'unknown_error' | 'invalid_response'

/** Machine-readable `details.reason` values. */
export type ApiErrorReason =
  | 'csrf'
  | 'insufficient_role'
  | 'own_role'
  | 'protected_member'
  | 'not_author'
  | 'email_taken'
  | 'slug_taken'
  | 'project_key_taken'
  | 'already_member'
  | 'last_owner'
  | 'project_archived'
  | 'already_archived'

/** One entry of `details.errors` on a 422 (contract 1.5.1). */
export interface FieldError {
  field: string
  location: 'body' | 'query' | 'path' | 'header' | 'cookie'
  message: string
}

export interface ApiErrorEnvelope {
  error: {
    code: ApiErrorCode
    message: string
    details: Record<string, unknown>
  }
}

export interface Paginated<T> {
  items: T[]
  next_cursor: string | null
}

// ---------------------------------------------------------------------------------------------
// Health (contract 3.1): generated
// ---------------------------------------------------------------------------------------------

export type HealthResponse = Schemas['HealthRead']

// ---------------------------------------------------------------------------------------------
// Auth (contract 3.2): generated
// ---------------------------------------------------------------------------------------------

/** Backend `UserRead`: the contract's `User`. Never includes the password. */
export type UserRead = Schemas['UserRead']

/** Backend `RegisterRequest`: body of `POST /auth/register`. */
export type RegisterRequest = Schemas['RegisterRequest']

/** Backend `LoginRequest`: body of `POST /auth/login`. */
export type LoginRequest = Schemas['LoginRequest']

/** The signed-in user (contract 2.1 `User`). */
export type User = UserRead

// ---------------------------------------------------------------------------------------------
// Workspaces and members (contract 3.3, 3.4): generated
// ---------------------------------------------------------------------------------------------

/** Workspace role (contract 1.9), highest first. */
export type Role = Schemas['Role']

/** Backend `WorkspaceRead`: the contract's `Workspace`, with the caller's own role. */
export type WorkspaceRead = Schemas['WorkspaceRead']

/** Backend `WorkspaceCreate`: body of `POST /workspaces`. Omit `slug` to let the server derive it. */
export type WorkspaceCreate = Schemas['WorkspaceCreate']

/** Backend `WorkspaceUpdate`: body of `PATCH /workspaces/{wid}`. Only the name can change. */
export type WorkspaceUpdate = Schemas['WorkspaceUpdate']

/** Backend `MemberRead`: the contract's `Member`. */
export type MemberRead = Schemas['MemberRead']

/** Backend `MemberCreate`: body of `POST /workspaces/{wid}/members` (an existing user's email). */
export type MemberCreate = Schemas['MemberCreate']

/** Backend `MemberUpdate`: body of `PATCH /workspaces/{wid}/members/{uid}` (`{}` changes nothing). */
export type MemberUpdate = Schemas['MemberUpdate']

export type Workspace = WorkspaceRead
export type Member = MemberRead

// ---------------------------------------------------------------------------------------------
// Projects (contract 3.5): generated
// ---------------------------------------------------------------------------------------------

/** Backend `ProjectRead`: the contract's `Project`. `archived_at` is null while active. */
export type ProjectRead = Schemas['ProjectRead']

/** Backend `ProjectCreate`: body of `POST /workspaces/{wid}/projects`. */
export type ProjectCreate = Schemas['ProjectCreate']

/** Backend `ProjectUpdate`: body of `PATCH /projects/{pid}`. The key cannot change; `null` clears the description. */
export type ProjectUpdate = Schemas['ProjectUpdate']

export type Project = ProjectRead

// ---------------------------------------------------------------------------------------------
// Tasks (contract 3.6): generated
// ---------------------------------------------------------------------------------------------

/** Calendar date `YYYY-MM-DD`, no time or zone (contract 1.2): `due_date`, `due_before`. */
export type DateOnly = string

/** Task column (contract 1.9), in board order. */
export type TaskStatus = Schemas['TaskStatus']

/** Task priority (contract 1.9), lowest first. */
export type TaskPriority = Schemas['TaskPriority']

/** A user as embedded in other objects (`Task.assignee`, activity actors). */
export type UserRef = Schemas['UserRef']

/** A project summary (`MyTask.project`, activity metadata). */
export type ProjectRef = Schemas['ProjectRef']

/** A workspace summary (`MyTask.workspace`). */
export type WorkspaceRef = Schemas['WorkspaceRef']

/** Backend `TaskRead`: the contract's `Task`. `position` orders tasks within a status column. */
export type TaskRead = Schemas['TaskRead']

/** Backend `TaskCreate`: body of `POST /projects/{pid}/tasks`. Only `title` is required. */
export type TaskCreate = Schemas['TaskCreate']

/** Backend `TaskUpdate`: body of `PATCH /tasks/{tid}`. Partial; `null` clears a nullable field. */
export type TaskUpdate = Schemas['TaskUpdate']

/**
 * Backend `TaskMoveRequest`: body of `POST /tasks/{tid}/move`. The neighbours the task should
 * have after the drop, in the target column: placed after `after_task_id`, before `before_task_id`.
 */
export type TaskMoveRequest = Schemas['TaskMoveRequest']

/** Backend `MyTaskRead`: an item of `GET /me/tasks`, a task plus its project and workspace. */
export type MyTaskRead = Schemas['MyTaskRead']

export type Task = TaskRead
export type MyTask = MyTaskRead
