# TaskBoard API Contract (v1)

This document is the contract between the Backend Agent and the UI Agent.

- The **Backend Agent** implements it exactly and is the only one who edits this file.
- The **UI Agent** builds against it (MSW mocks in `frontend/src/mocks`, types in `frontend/src/api`).
- Anyone who needs a change writes it in `docs/CONTRACT_CHANGES.md` (what, why, affected endpoints) and keeps building against the current version until the change is applied at a Sync Point.

Each endpoint section names the phase that implements it.

---

## 1. Conventions

### 1.1 Base URL and format

- All endpoints live under `/api`. Paths below omit the prefix: `GET /workspaces` means `GET /api/workspaces`.
- Request and response bodies are JSON (`Content-Type: application/json`, UTF-8).
- Success codes: `200` (read or update), `201` (created, body is the new resource), `204` (no body).
- Responses always include every documented field. Optional values are `null`; fields are never omitted.

### 1.2 IDs, timestamps, dates

| Kind | Format | Example |
|---|---|---|
| IDs (every entity) | UUID v4 string | `"10000000-0000-4000-8000-000000000001"` |
| Timestamps | ISO 8601, UTC, `Z` suffix. Fractional seconds may appear; parse with `new Date()`. | `"2026-11-22T09:30:00Z"` |
| Dates (`due_date`, `due_before`) | `YYYY-MM-DD`, no time or zone | `"2026-12-01"` |

The API identifies workspaces by `id`. The UI's `/w/:slug` routes resolve a slug to an id from `GET /workspaces`.

### 1.3 Authentication

- `POST /auth/register` and `POST /auth/login` set the session cookie:
  `Set-Cookie: access_token=<JWT>; HttpOnly; Max-Age=<JWT_EXPIRE_MINUTES * 60>; Path=/; SameSite=lax`, plus `; Secure` when `COOKIE_SECURE=true` (production).
- The token is an HS256 JWT that expires after `JWT_EXPIRE_MINUTES` (default 10080, 7 days). There is no refresh: after expiry the user logs in again.
- The browser sends the cookie automatically. The UI never reads the token, and nothing auth-related goes in `localStorage` or `sessionStorage`.
- Every endpoint except `GET /health`, `POST /auth/register` and `POST /auth/login` requires the cookie. A missing, invalid, tampered or expired cookie, or one whose account no longer exists, returns:

```json
{ "error": { "code": "unauthorized", "message": "Authentication required", "details": {} } }
```

### 1.4 CSRF header

Every `POST`, `PUT`, `PATCH` and `DELETE` must send:

```
X-Requested-With: taskboard
```

A mutating request without that exact header (the value is case-sensitive) gets `403 forbidden` with `details.reason = "csrf"`. The check runs before routing, validation and authentication, so it applies to every mutating `/api` path, including `/auth/register` and `/auth/login`. `frontend/src/api/client.ts` adds the header automatically.

```json
{
  "error": {
    "code": "forbidden",
    "message": "Missing or invalid X-Requested-With header",
    "details": { "reason": "csrf" }
  }
}
```

### 1.5 Errors

Every non-2xx response uses this envelope:

```json
{
  "error": {
    "code": "forbidden",
    "message": "Only admins and owners can create projects",
    "details": { "reason": "insufficient_role" }
  }
}
```

- `message` is human readable and safe to show in the UI.
- `details` is always an object (often `{}`). `details.reason`, when present, is a machine-readable hint from the list below.

| HTTP | `code` | When |
|---|---|---|
| 400 | `bad_request` | Malformed request the framework cannot parse (e.g. invalid JSON) |
| 401 | `unauthorized` | Not logged in, bad/expired cookie, wrong email or password on login |
| 403 | `forbidden` | Logged in and a member, but the role does not allow the action; missing CSRF header |
| 404 | `not_found` | Resource does not exist **or** the user is not a member of its workspace |
| 405 | `method_not_allowed` | Wrong HTTP method for an existing path |
| 409 | `conflict` | Duplicate or state conflict (see `details.reason`) |
| 422 | `validation_error` | Body, query or path values fail validation (see 1.5.1) |
| 429 | `rate_limited` | Too many register or login attempts (see 1.5.2). Response has a `Retry-After` header (seconds). |
| 500 | `internal_error` | Unexpected server error |
| 503 | `service_unavailable` | Health check: database unreachable. Also a non-API page when the UI is not built (1.11) |

`details.reason` values:

| Status | `reason` | Meaning |
|---|---|---|
| 403 | `csrf` | Missing or wrong `X-Requested-With` header |
| 403 | `insufficient_role` | Role is below the action's minimum role |
| 403 | `own_role` | Users cannot change their own role |
| 403 | `protected_member` | Admins cannot change or remove owners or other admins, or grant admin/owner |
| 403 | `not_author` | Only the comment's author may do this (edit); only the author, owners and admins (delete) |
| 409 | `email_taken` | Email already registered |
| 409 | `slug_taken` | Workspace slug already used |
| 409 | `project_key_taken` | Project key already used in this workspace |
| 409 | `already_member` | User is already a member of the workspace |
| 409 | `last_owner` | The action would leave the workspace without an owner |
| 409 | `project_archived` | Tasks and comments of an archived project are read-only |
| 409 | `already_archived` | Project is already archived |

#### 1.5.1 Validation errors (422)

`details.errors` lists every failing field. Request validation and business validation (e.g. "assignee must be a member") use the same shape:

```json
{
  "error": {
    "code": "validation_error",
    "message": "Request validation failed",
    "details": {
      "errors": [
        { "field": "email", "location": "body", "message": "value is not a valid email address" },
        { "field": "limit", "location": "query", "message": "Input should be less than or equal to 100" }
      ]
    }
  }
}
```

- `field` is the dotted path inside its location (`"title"`, `"items.0.name"`). It is `""` when the whole body is invalid.
- `location` is one of `body`, `query`, `path`, `header`, `cookie`.

#### 1.5.2 Rate limits (429, Phase 7, implemented)

`POST /auth/register` and `POST /auth/login` are rate-limited per client IP, over a sliding 60-second window:

| Limit | Default | Counts |
|---|---|---|
| Requests per client IP, to each of the two endpoints | 20 per minute (`AUTH_RATE_LIMIT_PER_MINUTE`) | Every request that passes the CSRF check, before body validation: `422`s, `401`s and successes all count |
| Login attempts per client IP **and** email | 10 per minute (`AUTH_RATE_LIMIT_PER_EMAIL_PER_MINUTE`) | Every login with a valid body, matched on the normalized (trimmed, lowercase) email, successful or not |

Over a limit, the request is refused before the password is checked (so even the right password gets the `429`) and no cookie is set. A refused request does not count against the limit that refused it, so waiting `Retry-After` seconds is always enough:

```
HTTP/1.1 429 Too Many Requests
Retry-After: 42
```

```json
{ "error": { "code": "rate_limited", "message": "Too many attempts. Try again in 42 seconds.", "details": {} } }
```

- `Retry-After` is a whole number of seconds (1 to 60) until the next attempt is allowed; the message repeats it.
- Order of checks on login: CSRF `403`, per-IP `429`, `422`, per-IP-and-email `429`, then `401` or `200`. Register: CSRF `403`, per-IP `429`, `422`, `409`, `201`.
- The counts live in the server process: a restart resets them. `0` turns a limit off.

### 1.6 Pagination (comments and activity only)

- Query: `limit` (integer 1 to 100, default 20) and `cursor` (opaque string from a previous page).
- Response:

```json
{ "items": [], "next_cursor": "eyJjIjoiMjAyNi0xMS0yMlQxMDowMDowMFoiLCJpZCI6IjUwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSJ9" }
```

- `next_cursor` is `null` on the last page, including a last page that is exactly `limit` items long. Clients pass it back unchanged as `cursor` and never parse it.
- Pages are keyset-based: items are ordered by `created_at`, then `id` (so items with equal timestamps still have a stable order), and the cursor marks the position of the previous page's last item. A cursor stays valid when items are added or deleted while paging: nothing is skipped or repeated, and items created after the walk started appear on later pages.
- An invalid `limit` (not an integer, below 1, above 100) or an invalid cursor (anything the server did not issue, including `""`) returns `422` with `location: "query"` and `field: "limit"` or `field: "cursor"`.
- Every other list endpoint returns a plain JSON array.

### 1.7 PATCH semantics

- PATCH bodies are partial: omitted fields stay unchanged.
- Sending `null` clears a nullable field (`description`, `assignee_id`, `due_date`).
- Sending `null` for a non-nullable field (e.g. `title`) is a `422`.
- An empty body `{}` is valid and returns the unchanged resource (no activity entry).

### 1.8 Field limits

Strings are trimmed before validation, except `password`, which is used exactly as sent (leading and trailing spaces are part of the password).

| Field | Rule |
|---|---|
| `email` | Valid email, max 254 chars. Stored and returned lowercase; matching is case-insensitive. |
| `password` | 8 to 128 chars on register. On login: 1 to 128 chars, so a too-short password gets the same `401` as a wrong one. |
| user `name` | 1 to 100 chars |
| workspace `name` | 1 to 100 chars |
| workspace `slug` | 1 to 48 chars, `^[a-z0-9]+(?:-[a-z0-9]+)*$` |
| project `name` | 1 to 100 chars |
| project `key` | `^[A-Z][A-Z0-9]{1,9}$` (2 to 10 chars, uppercase letters and digits, starts with a letter). Unique per workspace. Immutable. |
| project `description` | 0 to 2000 chars, nullable |
| task `title` | 1 to 200 chars |
| task `description` | 0 to 10000 chars, nullable |
| comment `body` | 1 to 5000 chars |
| `limit` | 1 to 100 |

### 1.9 Enums

| Enum | Values (in display order) | UI labels |
|---|---|---|
| `Role` | `owner`, `admin`, `member`, `viewer` | Owner, Admin, Member, Viewer |
| `TaskStatus` | `todo`, `in_progress`, `in_review`, `done` | To Do, In Progress, In Review, Done |
| `TaskPriority` | `low`, `medium`, `high`, `urgent` | Low, Medium, High, Urgent |
| `ActivityAction` | `workspace.created`, `workspace.renamed`, `member.added`, `member.removed`, `member.role_changed`, `project.created`, `project.updated`, `project.archived`, `task.created`, `task.updated`, `task.moved`, `task.assigned`, `task.due_date_changed`, `task.deleted`, `comment.created`, `comment.edited`, `comment.deleted` | Messages per section 3.8 |
| `ActivityEntityType` | `workspace`, `member`, `project`, `task`, `comment` (always the part of the action before the dot) | |

### 1.10 Access rules

Role permission matrix (from PLAN.md section 4). The backend's `app/services/permissions.py` (`can(role, action)`) and `frontend/src/lib/permissions.ts` use the same action identifiers:

| Action id | What it covers | Owner | Admin | Member | Viewer |
|---|---|:-:|:-:|:-:|:-:|
| `workspace.view` | View workspace, members, projects, tasks, comments, activity | Y | Y | Y | Y |
| `task.write` | Create/edit/move tasks, assign, set due date | Y | Y | Y | - |
| `comment.create` | Comment | Y | Y | Y | - |
| `comment.edit_own` | Edit/delete **own** comment | Y | Y | Y | - |
| `comment.delete_any` | Delete any comment | Y | Y | - | - |
| `task.delete` | Delete any task | Y | Y | - | - |
| `project.manage` | Create/edit/archive projects | Y | Y | - | - |
| `member.manage` | Add/remove members, change roles (only `member` and `viewer` targets and grants) | Y | Y | - | - |
| `member.promote` | Grant `admin`/`owner` (transfer ownership), change or remove admins and owners | Y | - | - | - |
| `workspace.manage` | Rename/delete the workspace | Y | - | - | - |

Each endpoint's "min role" is the lowest role allowed its action, e.g. `PATCH /workspaces/{wid}` performs `workspace.manage` (owner).

How the server applies it, in this order:

1. Resolve the resource to its workspace (task → project → workspace).
2. Not found, **or** the user is not a member → `404 not_found`. Never `403`, so the API does not reveal that the resource exists.
3. A member whose role is too low for the endpoint's action → `403 forbidden` with `details.reason = "insufficient_role"`. The message names the allowed roles, e.g. `"Only owners and admins can add, remove or change members"`.
4. Request validation → `422`. (Steps 2 and 3 run first, so a non-member sending an invalid body still gets `404`.)
5. Business rules → `403` (`own_role`, `protected_member`), `409`, `422`.

Membership rules:

- A workspace always has at least one owner.
- Users cannot change their own role (`403 own_role`).
- Admins can add, change or remove only `member` and `viewer` users, and can only grant `member` or `viewer` (`403 protected_member`).
- Owners can do anything to anyone except change their own role. Promoting another member to `owner` is how ownership is transferred, and a workspace may have several owners.
- Any member may leave (`DELETE` their own membership), except the last owner (`409 last_owner`).

Archived projects are read-only for tasks and comments. Creating, updating or moving tasks, and creating or editing comments, returns `409 project_archived`. Deleting tasks and comments is still allowed.

### 1.11 Request IDs and response headers (Phase 7, implemented)

Every response, errors included, carries `X-Request-ID`. A client may send its own `X-Request-ID` (1 to 128 characters from `A-Z a-z 0-9 . _ : -`); the server then uses and returns it unchanged. Otherwise, or when the value does not match, the server generates one (32 lowercase hex characters). The id is on every server log line of that request, so the UI can show it on a `500` ("error id") to find the logs.

Every response also carries security headers: `Content-Security-Policy` (`default-src 'self'`, no inline or remote scripts, inline styles allowed; Swagger UI at `/api/docs` gets a relaxed policy for its CDN assets), `X-Content-Type-Options: nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, and `Strict-Transport-Security` when served over HTTPS (`COOKIE_SECURE=true` or `APP_ENV=production`).

There is no CORS: the UI and the API share one origin (the Vite dev server proxies `/api`), so responses never carry `Access-Control-Allow-*` headers and cross-origin preflights fail.

Outside `/api`, the server serves the built UI (`frontend/dist`): existing files as they are (`/assets/*` cached as immutable) and `index.html` for every other `GET` path, so deep links work on refresh. Unknown `/api` paths still get the JSON `404` envelope. Without a build, non-API pages get `503 service_unavailable` with a message saying how to build it.

---

## 2. Object shapes

Example IDs used throughout:

| Prefix | Entity |
|---|---|
| `10000000-...` | users (`...0001` Asha, owner; `...0002` Ben, member; `...0003` Chen, viewer) |
| `20000000-...` | workspaces |
| `30000000-...` | projects |
| `40000000-...` | tasks |
| `50000000-...` | comments |
| `60000000-...` | activity entries |

### 2.1 TypeScript reference

The UI hand-writes these in `frontend/src/api/` until it generates `schema.d.ts` from `docs/openapi.json`.

```ts
type UUID = string
type Timestamp = string // ISO 8601 UTC
type DateOnly = string  // YYYY-MM-DD

type Role = 'owner' | 'admin' | 'member' | 'viewer'
type TaskStatus = 'todo' | 'in_progress' | 'in_review' | 'done'
type TaskPriority = 'low' | 'medium' | 'high' | 'urgent'

interface UserRef { id: UUID; name: string }

interface User { id: UUID; email: string; name: string; created_at: Timestamp }

interface Workspace {
  id: UUID; name: string; slug: string
  created_by: UUID; created_at: Timestamp
  my_role: Role
}

interface Member { user_id: UUID; email: string; name: string; role: Role; joined_at: Timestamp }

interface Project {
  id: UUID; workspace_id: UUID; name: string; key: string
  description: string | null; archived_at: Timestamp | null
  created_by: UUID; created_at: Timestamp
}

interface Task {
  id: UUID; project_id: UUID; workspace_id: UUID
  number: number; key: string           // key = `${project.key}-${number}`, e.g. "WEB-12"
  title: string; description: string | null
  status: TaskStatus; priority: TaskPriority; position: number
  assignee: UserRef | null; due_date: DateOnly | null
  comment_count: number
  created_by: UUID; created_at: Timestamp; updated_at: Timestamp
}

interface ProjectRef { id: UUID; name: string; key: string }
interface WorkspaceRef { id: UUID; name: string; slug: string }

interface MyTask extends Task {
  project: ProjectRef
  workspace: WorkspaceRef
}

interface Comment {
  id: UUID; task_id: UUID; author: UserRef; body: string
  created_at: Timestamp; edited_at: Timestamp | null
}

type ActivityAction =
  | 'workspace.created' | 'workspace.renamed'
  | 'member.added' | 'member.removed' | 'member.role_changed'
  | 'project.created' | 'project.updated' | 'project.archived'
  | 'task.created' | 'task.updated' | 'task.moved' | 'task.assigned'
  | 'task.due_date_changed' | 'task.deleted'
  | 'comment.created' | 'comment.edited' | 'comment.deleted'
type ActivityEntityType = 'workspace' | 'member' | 'project' | 'task' | 'comment'

interface ActivityEntry {
  id: UUID; workspace_id: UUID; project_id: UUID | null; task_id: UUID | null
  actor: UserRef; action: ActivityAction
  entity_type: ActivityEntityType
  entity_id: UUID
  metadata: Record<string, unknown> // shape per action, see section 3.8
  created_at: Timestamp
}

interface Page<T> { items: T[]; next_cursor: string | null }

interface ErrorEnvelope {
  error: { code: string; message: string; details: Record<string, unknown> }
}
```

### 2.2 Notes on shapes

- `Task.position` is a float that orders tasks within a status column (ascending). See `POST /tasks/{tid}/move`.
- `Task.number` is a per-project sequence starting at 1. It is never reused, even after deletes, and a rejected create does not use one up. Concurrent creates in one project always get different numbers.
- `Task.key` is the project key, a hyphen and the number (e.g. `"WEB-12"`). Project keys are immutable, so a task's key never changes.
- `Task.comment_count` counts the task's current comments (deleted ones no longer count). It is on every task response: the project task list, `GET`/`PATCH /tasks/{tid}`, `POST /tasks/{tid}/move`, `GET /me/tasks`, and `0` on a newly created task. After posting or deleting a comment, refetch the task (or the list) to see the new count.
- `Task.updated_at` changes whenever the task's row changes, including when a rebalance renumbers its `position` (see `POST /tasks/{tid}/move`). A request that changes nothing leaves it alone.
- `Workspace.my_role` is the calling user's role in that workspace. It is included on every workspace response.

### 2.3 OpenAPI schema names

The backend's OpenAPI document (`GET /api/openapi.json`; `scripts\openapi.ps1` writes it to `docs/openapi.json`) names each object below as a component schema. The UI's generated `schema.d.ts` exposes them as `components["schemas"]["<name>"]`. These names are part of the contract: renaming one is a contract change, and `backend/tests/api/test_openapi.py` guards them.

| Contract object | OpenAPI schema | Used by | Phase |
|---|---|---|---|
| `User` | `UserRead` | `200`/`201` of `POST /auth/register`, `POST /auth/login`, `GET /auth/me` | 1 |
| register request body | `RegisterRequest` | `POST /auth/register` | 1 |
| login request body | `LoginRequest` | `POST /auth/login` | 1 |
| `Workspace` | `WorkspaceRead` | `200` of `GET /workspaces` (array), `GET`/`PATCH /workspaces/{wid}`; `201` of `POST /workspaces` | 2 |
| create-workspace body | `WorkspaceCreate` | `POST /workspaces` | 2 |
| update-workspace body | `WorkspaceUpdate` | `PATCH /workspaces/{wid}` | 2 |
| `Member` | `MemberRead` | `200` of `GET /workspaces/{wid}/members` (array), `PATCH /workspaces/{wid}/members/{uid}`; `201` of `POST /workspaces/{wid}/members` | 2 |
| add-member body | `MemberCreate` | `POST /workspaces/{wid}/members` | 2 |
| change-role body | `MemberUpdate` | `PATCH /workspaces/{wid}/members/{uid}` | 2 |
| `Role` | `Role` (string enum) | `WorkspaceRead.my_role`, `MemberRead.role`, `MemberCreate.role`, `MemberUpdate.role` | 2 |
| `Project` | `ProjectRead` | `200` of `GET /workspaces/{wid}/projects` (array), `GET`/`PATCH /projects/{pid}`, `POST /projects/{pid}/archive`; `201` of `POST /workspaces/{wid}/projects` | 3 |
| create-project body | `ProjectCreate` | `POST /workspaces/{wid}/projects` | 3 |
| update-project body | `ProjectUpdate` | `PATCH /projects/{pid}` | 3 |
| `Task` | `TaskRead` | `200` of `GET /projects/{pid}/tasks` (array), `GET`/`PATCH /tasks/{tid}`, `POST /tasks/{tid}/move`; `201` of `POST /projects/{pid}/tasks` | 4 |
| create-task body | `TaskCreate` | `POST /projects/{pid}/tasks` | 4 |
| update-task body | `TaskUpdate` | `PATCH /tasks/{tid}` | 4 |
| move-task body | `TaskMoveRequest` | `POST /tasks/{tid}/move` | 4 |
| `MyTask` | `MyTaskRead` | `200` of `GET /me/tasks` (array) | 4 |
| `UserRef` | `UserRef` | `TaskRead.assignee`, `CommentRead.author`, `ActivityRead.actor` | 4 |
| `ProjectRef` | `ProjectRef` | `MyTaskRead.project` | 4 |
| `WorkspaceRef` | `WorkspaceRef` | `MyTaskRead.workspace` | 4 |
| `TaskStatus` | `TaskStatus` (string enum) | `TaskRead.status`, `TaskCreate.status`, `TaskUpdate.status`, `TaskMoveRequest.status`, the `status` query filter | 4 |
| `TaskPriority` | `TaskPriority` (string enum) | `TaskRead.priority`, `TaskCreate.priority`, `TaskUpdate.priority`, the `priority` query filter | 4 |
| `Comment` | `CommentRead` | `CommentPage.items`, `200` of `PATCH /comments/{cid}`; `201` of `POST /tasks/{tid}/comments` | 5 |
| `Page<Comment>` | `CommentPage` | `200` of `GET /tasks/{tid}/comments` | 5 |
| create-comment body | `CommentCreate` | `POST /tasks/{tid}/comments` | 5 |
| update-comment body | `CommentUpdate` | `PATCH /comments/{cid}` | 5 |
| `ActivityEntry` | `ActivityRead` (`metadata` is a plain object, `additionalProperties: true`) | `ActivityPage.items` | 6 |
| `Page<ActivityEntry>` | `ActivityPage` | `200` of `GET /workspaces/{wid}/activity` | 6 |
| `ActivityAction` | `ActivityAction` (string enum) | `ActivityRead.action` | 6 |
| `ActivityEntityType` | `ActivityEntityType` (string enum) | `ActivityRead.entity_type` | 6 |
| `ErrorEnvelope` | `ErrorEnvelope` (its `error` is `ErrorBody`) | every documented error response, `422` included | 0 |
| health response | `HealthRead` | `GET /health` | 0 |
| session cookie | security scheme `CookieAuth` (`apiKey`, in `cookie`, name `access_token`) | every endpoint that requires the cookie | 1 |

- Error responses (including `422`) are documented with `ErrorEnvelope`. FastAPI's default `HTTPValidationError` schema is not used, because the API never returns that shape.
- Path parameters keep the names used in this document: `wid` (workspace id), `uid` (a member's user id), `pid` (project id), `tid` (task id) and `cid` (comment id).
- Paginated responses are concrete named schemas (`CommentPage`, `ActivityPage`), never generic names like `Page_CommentRead_`.
- PATCH body fields are optional but not nullable in the schema unless section 1.7 says the field can be cleared (`WorkspaceUpdate.name`, `MemberUpdate.role`, `ProjectUpdate.name`, `TaskUpdate.title`, `TaskUpdate.status`, `TaskUpdate.priority` and `CommentUpdate.body` are `string`/enum, never `null`; `ProjectUpdate.description`, `TaskUpdate.description`, `TaskUpdate.assignee_id` and `TaskUpdate.due_date` are nullable).
- Later phases add rows here as they implement endpoints, following the same pattern: `<Entity>Read` for response objects, `<Entity>Create` / `<Entity>Update` for request bodies, and `<Action>Request` for action bodies.

---

## 3. Endpoints

### 3.1 Health (Phase 0, implemented)

#### `GET /health` (public)

`200`:

```json
{ "status": "ok", "database": "ok" }
```

`503` when the database is unreachable:

```json
{ "error": { "code": "service_unavailable", "message": "Database is unavailable", "details": {} } }
```

---

### 3.2 Auth (Phase 1, implemented)

#### `POST /auth/register` (public)

Request (`RegisterRequest`):

```json
{ "email": "asha@example.com", "name": "Asha Rao", "password": "correct-horse-battery" }
```

`201` (and sets the `access_token` cookie, which logs the new user in). The returned `email` is the normalized address (trimmed, lowercase) and `name` is trimmed:

```json
{
  "id": "10000000-0000-4000-8000-000000000001",
  "email": "asha@example.com",
  "name": "Asha Rao",
  "created_at": "2026-11-22T09:00:00Z"
}
```

Errors:
- `409 conflict` with `details.reason = "email_taken"`. Message: `"An account with this email already exists"`. Emails are compared case-insensitively, so `ASHA@example.com` conflicts with `asha@example.com`.
- `422` for an invalid email, a name or password out of range.
- `429 rate_limited` with `Retry-After` (section 1.5.2).

#### `POST /auth/login` (public)

Request (`LoginRequest`; the email is matched case-insensitively):

```json
{ "email": "asha@example.com", "password": "correct-horse-battery" }
```

`200` (and sets the cookie): a `User`, same shape as register.

Errors:
- `401 unauthorized`, message `"Invalid email or password"`. The same response is used for an unknown email and a wrong password.
- `422`.
- `429 rate_limited` with `Retry-After` (section 1.5.2), also with the right password.

#### `POST /auth/logout` (auth)

No body. `204`, and the response clears the cookie:
`Set-Cookie: access_token=""; expires=<now>; HttpOnly; Max-Age=0; Path=/; SameSite=lax`, plus `; Secure` when `COOKIE_SECURE=true`.

Tokens are stateless: logout only removes the cookie from the browser.

Errors: `401` when not logged in (the `unauthorized` envelope in 1.3).

#### `GET /auth/me` (auth)

`200`: the current `User`.

```json
{
  "id": "10000000-0000-4000-8000-000000000001",
  "email": "asha@example.com",
  "name": "Asha Rao",
  "created_at": "2026-11-22T09:00:00Z"
}
```

Errors: `401` when not logged in (the `unauthorized` envelope in 1.3). The UI calls this on start with `skipAuthRedirect: true` to decide between the app and the login page.

---

### 3.3 Workspaces (Phase 2, implemented)

Every `/workspaces/{wid}` endpoint returns `404 not_found` (message `"Workspace not found"`) when the workspace does not exist or the caller is not a member, and `422` (`field: "wid", location: "path"`) for a malformed id.

#### `GET /workspaces` (auth)

Workspaces the user belongs to, ordered by `name` (case-insensitive). `[]` when there are none. `200`:

```json
[
  {
    "id": "20000000-0000-4000-8000-000000000001",
    "name": "Acme",
    "slug": "acme",
    "created_by": "10000000-0000-4000-8000-000000000001",
    "created_at": "2026-11-22T09:05:00Z",
    "my_role": "owner"
  }
]
```

#### `POST /workspaces` (auth)

The creator becomes `owner`. `slug` is optional (omitted or `null`). When omitted, the server derives it from `name`: lowercase, runs of non-alphanumerics (anything outside `a-z0-9`, including accented letters) become `-`, trimmed of `-`, max 48 chars, `"workspace"` if empty. If the derived slug is taken, it appends `-2`, `-3`, and so on, shortening the base so the result still fits 48 chars (`"Acme Inc."` → `acme-inc`, then `acme-inc-2`).

Request:

```json
{ "name": "Acme", "slug": "acme" }
```

`201`: a `Workspace` with `"my_role": "owner"` (same shape as above).

Errors:
- `409` with `details.reason = "slug_taken"`, message `"This workspace URL is already taken"`, when an explicit `slug` is taken. A derived slug never conflicts, except in the unlikely case that concurrent requests take every free candidate three times in a row; retrying succeeds.
- `422`.

#### `GET /workspaces/{wid}` (viewer)

`200`: a `Workspace`. Errors: `404`.

#### `PATCH /workspaces/{wid}` (owner)

Only `name` can change; the slug is immutable (a `slug` in the body is ignored). `{}` returns the workspace unchanged; `"name": null` is a `422`. Request:

```json
{ "name": "Acme Inc" }
```

`200`: the updated `Workspace`. Errors: `403`, `404`, `422`.

#### `DELETE /workspaces/{wid}` (owner)

Deletes the workspace and everything in it (members, projects, tasks, comments, activity). `204`.

Errors: `403`, `404`.

---

### 3.4 Members (Phase 2, implemented)

The `404` and malformed-id rules of 3.3 apply. `PATCH` and `DELETE` also return `404` with message `"Member not found"` when `uid` is not a member of the workspace (or not a user at all), and `422` (`field: "uid"`) for a malformed id.

#### `GET /workspaces/{wid}/members` (viewer)

Ordered by role (owner, admin, member, viewer), then `name` (case-insensitive). `200`:

```json
[
  {
    "user_id": "10000000-0000-4000-8000-000000000001",
    "email": "asha@example.com",
    "name": "Asha Rao",
    "role": "owner",
    "joined_at": "2026-11-22T09:05:00Z"
  },
  {
    "user_id": "10000000-0000-4000-8000-000000000002",
    "email": "ben@example.com",
    "name": "Ben Okafor",
    "role": "member",
    "joined_at": "2026-11-22T09:10:00Z"
  }
]
```

#### `POST /workspaces/{wid}/members` (admin)

Adds an **existing** registered user by email (trimmed, matched case-insensitively). Both fields are required. Request:

```json
{ "email": "ben@example.com", "role": "member" }
```

`201`: the new `Member`:

```json
{
  "user_id": "10000000-0000-4000-8000-000000000002",
  "email": "ben@example.com",
  "name": "Ben Okafor",
  "role": "member",
  "joined_at": "2026-11-22T09:10:00Z"
}
```

Errors, in the order they are checked:
- `404` (workspace), then `403 insufficient_role` (member or viewer).
- `422` for an invalid body.
- `403 protected_member` when an admin grants `admin` or `owner`. Message: `"Only owners can grant the admin or owner role"`.
- `422` with `field: "email"`, message `"No user with this email"`, when no account exists.
- `409 already_member`.

#### `PATCH /workspaces/{wid}/members/{uid}` (admin)

`role` is optional (section 1.7): `{}`, or the member's current role, returns the member unchanged after the permission checks below. Request:

```json
{ "role": "admin" }
```

`200`: the updated `Member`.

Errors, in the order they are checked:
- `404` (workspace), then `403 insufficient_role` (member or viewer, even for themselves).
- `422` for an invalid body (`"role": null` included).
- `403 own_role` when `uid` is the caller.
- `404` when `uid` is not a member.
- `403 protected_member`: an admin acting on an owner or admin (message `"Only owners can change or remove owners and admins"`), or granting `admin`/`owner`.
- `409 last_owner` (demoting the only owner). Only reachable when two owners demote each other at the same time, because the caller of a role change is always another owner.

#### `DELETE /workspaces/{wid}/members/{uid}` (admin; any member for themselves)

`204`. `uid` equal to the caller's own id means "leave the workspace" and is allowed for any role.

Errors:
- `404` (workspace, or `uid` not a member).
- `403 insufficient_role` (a member or viewer removing someone else).
- `403 protected_member` (an admin removing an owner or admin).
- `409 last_owner`: the only owner leaving. Message: `"You are the only owner. Make another member an owner before leaving the workspace"`.

---

### 3.5 Projects (Phase 3, implemented)

- `/workspaces/{wid}/projects` follows the `404` and malformed-id rules of 3.3 (message `"Workspace not found"`).
- Every `/projects/{pid}` endpoint returns `404 not_found` with message `"Project not found"` when the project does not exist or the caller is not a member of its workspace, and `422` (`field: "pid", location: "path"`) for a malformed id. A project of another workspace gets exactly the same `404` as an id that does not exist.
- Roles always come from the project's own workspace.
- A `403` (member or viewer on a write) has message `"Only owners and admins can create, edit or archive projects"`.

#### `GET /workspaces/{wid}/projects` (viewer)

Query: `include_archived` (boolean, default `false`; `true` adds archived projects to the same list). Ordered by `name` (case-insensitive), then `key`. `[]` when there are none. An invalid `include_archived` is a `422` (`field: "include_archived", location: "query"`). `200`:

```json
[
  {
    "id": "30000000-0000-4000-8000-000000000001",
    "workspace_id": "20000000-0000-4000-8000-000000000001",
    "name": "Website",
    "key": "WEB",
    "description": "Marketing site and signup flow",
    "archived_at": null,
    "created_by": "10000000-0000-4000-8000-000000000001",
    "created_at": "2026-11-22T09:15:00Z"
  }
]
```

#### `POST /workspaces/{wid}/projects` (admin)

Request (`description` optional: omitted or `null` for none; a blank one is stored as `""`). Field rules are in 1.8. The key is not uppercased for you: `"web"` is a `422`. `created_by` is the caller and `archived_at` is `null`. Request:

```json
{ "name": "Website", "key": "WEB", "description": "Marketing site and signup flow" }
```

`201`: the new `Project`.

Errors, in the order they are checked:
- `404` (workspace), then `403 insufficient_role` (member or viewer).
- `422` for an invalid body.
- `409` with `details.reason = "project_key_taken"`, message `"This project key is already used in this workspace"`. Archived projects keep their key. The same key may be used in another workspace.

#### `GET /projects/{pid}` (viewer)

`200`: a `Project`, archived or not. Errors: `404`.

#### `PATCH /projects/{pid}` (admin)

`name` and `description` can change. `key` is immutable: a `key` in the body is ignored, like any other unknown field. Partial per 1.7: `{}` returns the project unchanged, `"name": null` is a `422`, `"description": null` clears the description. Archived projects can still be edited. Request:

```json
{ "name": "Website v2", "description": null }
```

`200`: the updated `Project`. Errors: `404`, then `403`, then `422`.

#### `POST /projects/{pid}/archive` (admin)

No body (one sent is ignored). There is no unarchive. `200`: the `Project` with `archived_at` set to the server's current time:

```json
{
  "id": "30000000-0000-4000-8000-000000000001",
  "workspace_id": "20000000-0000-4000-8000-000000000001",
  "name": "Website",
  "key": "WEB",
  "description": "Marketing site and signup flow",
  "archived_at": "2026-12-15T17:00:00Z",
  "created_by": "10000000-0000-4000-8000-000000000001",
  "created_at": "2026-11-22T09:15:00Z"
}
```

Errors: `404`, then `403`, then `409` with `details.reason = "already_archived"`, message `"This project is already archived"` (the original `archived_at` is kept).

---

### 3.6 Tasks (Phase 4, implemented; real `comment_count` since Phase 5)

- `/projects/{pid}/tasks` follows the `404` and malformed-id rules of 3.5 (message `"Project not found"`, `field: "pid"`).
- Every `/tasks/{tid}` endpoint returns `404 not_found` with message `"Task not found"` when the task does not exist or the caller is not a member of its workspace, and `422` (`field: "tid", location: "path"`) for a malformed id. A task of another workspace gets exactly the same `404` as an id that does not exist.
- Roles always come from the task's (project's) own workspace. A `403` has message `"Only owners, admins and members can create or edit tasks"` (`task.write`: create, update, move) or `"Only owners and admins can delete tasks"` (`task.delete`).
- Checks run in this order: `404`, `403`, request validation `422`, `409 project_archived`, then business `422`s (assignee, neighbours).
- Archived projects: create, update (any body, even `{}`) and move return `409` with `details.reason = "project_archived"` and message `"This project is archived, so its tasks are read-only"`. Reading and deleting still work.
- Field rules (section 1.8): `title` and `description` are trimmed; a blank `description` is stored as `""`, `null` means none. Unknown and server-controlled fields in a body (`number`, `key`, `position`, `project_id`, `workspace_id`, `created_by`, `comment_count`, ...) are ignored.
- Assignee rule: `assignee_id` must be a member of the task's workspace, with any role (viewers can be assigned). Otherwise `422` with `field: "assignee_id"`, message `"Assignee must be a member of this workspace"`. A task keeps its assignee if that user later leaves the workspace; it then no longer appears in their `GET /me/tasks`.
- The server serializes concurrent writes to the tasks of one project, so numbers, positions and the archived check stay consistent.

#### `GET /projects/{pid}/tasks` (viewer)

Returns **all** matching tasks of the project (not paginated), ordered by status (`todo`, `in_progress`, `in_review`, `done`), then `position` ascending, then `number` (so equal positions still list in a stable order). `[]` when there are none.

| Query param | Type | Meaning |
|---|---|---|
| `status` | `TaskStatus`, repeatable | `?status=todo&status=done` |
| `assignee_id` | UUID or `none` | `none` = unassigned. A user who is not a member just matches nothing. |
| `priority` | `TaskPriority`, repeatable | |
| `due_before` | date | `due_date` on or before this date (inclusive); excludes tasks without a due date |
| `q` | string, 1 to 200 chars after trimming | Case-insensitive substring match on `title` or `description`. `%`, `_` and `\` match literally. |

Different filters combine with AND; repeated values of one filter combine with OR. Unknown query parameters are ignored.

`200`:

```json
[
  {
    "id": "40000000-0000-4000-8000-000000000002",
    "project_id": "30000000-0000-4000-8000-000000000001",
    "workspace_id": "20000000-0000-4000-8000-000000000001",
    "number": 2,
    "key": "WEB-2",
    "title": "Write onboarding copy",
    "description": null,
    "status": "todo",
    "priority": "medium",
    "position": 1024.0,
    "assignee": null,
    "due_date": null,
    "comment_count": 0,
    "created_by": "10000000-0000-4000-8000-000000000001",
    "created_at": "2026-11-22T09:21:00Z",
    "updated_at": "2026-11-22T09:21:00Z"
  },
  {
    "id": "40000000-0000-4000-8000-000000000001",
    "project_id": "30000000-0000-4000-8000-000000000001",
    "workspace_id": "20000000-0000-4000-8000-000000000001",
    "number": 1,
    "key": "WEB-1",
    "title": "Fix login redirect",
    "description": "After login users land on /404 instead of the dashboard.",
    "status": "in_progress",
    "priority": "high",
    "position": 1024.0,
    "assignee": { "id": "10000000-0000-4000-8000-000000000002", "name": "Ben Okafor" },
    "due_date": "2026-12-01",
    "comment_count": 2,
    "created_by": "10000000-0000-4000-8000-000000000001",
    "created_at": "2026-11-22T09:20:00Z",
    "updated_at": "2026-11-22T10:02:00Z"
  }
]
```

Errors: `404`, `422` (`location: "query"`): a bad `status` or `priority` value reports its index (`field: "status.1"` for the second value); a bad `assignee_id` has message `"Input should be a valid UUID or 'none'"` (`none` is case-sensitive); a bad `due_before`; an empty, blank or too long `q`.

#### `POST /projects/{pid}/tasks` (member)

Only `title` is required. Defaults: `status = "todo"`, `priority = "medium"`; `description`, `assignee_id` and `due_date` may be omitted or `null`. `"status": null` or `"priority": null` is a `422`. The new task gets the project's next `number` and goes to the **end** of its status column (`position` = last position + 1024, or 1024 in an empty column). `created_by` is the caller. Request:

```json
{
  "title": "Fix login redirect",
  "description": "After login users land on /404 instead of the dashboard.",
  "status": "todo",
  "priority": "high",
  "assignee_id": "10000000-0000-4000-8000-000000000002",
  "due_date": "2026-12-01"
}
```

`201`: the new `Task` (same shape as the list items).

Errors, in the order they are checked:
- `404`, then `403`.
- `422` for an invalid body.
- `409 project_archived`.
- `422` on `assignee_id` (the assignee rule above).

#### `GET /tasks/{tid}` (viewer)

`200`: a `Task`, also in an archived project. Errors: `404`.

#### `PATCH /tasks/{tid}` (member)

Any subset of `title`, `description`, `status`, `priority`, `assignee_id`, `due_date`, partial per 1.7:

- Omitted fields stay unchanged. `null` clears `description`, `assignee_id` and `due_date`; `null` for `title`, `status` or `priority` is a `422`.
- `{}`, or values equal to the current ones, returns the task unchanged (`updated_at` included).
- A `status` change through PATCH moves the task to the end of the new column; the same status keeps its position. Use `/move` to control the exact place.
- The assignee rule applies only to a **new** `assignee_id`, so editing a task whose assignee has left the workspace still works.
- A rejected PATCH changes nothing, not even its valid fields.

Request:

```json
{ "priority": "urgent", "assignee_id": null, "due_date": "2026-12-03" }
```

`200`: the updated `Task`. Errors, in the order they are checked: `404`, `403`, `422` (body), `409 project_archived`, `422` (assignee rule).

#### `DELETE /tasks/{tid}` (admin)

`204`. Deletes the task and its comments; its activity entries remain (see 3.8). Allowed in archived projects. Members cannot delete tasks, not even their own. The task's `number` is not reused. Errors: `404` (also for a task that is already deleted), `403`.

#### `POST /tasks/{tid}/move` (member)

Moves a task within its column or to another column. `status` is required (the target column, which may be the current one); both neighbour ids are optional (omitted or `null`). The client sends the neighbours the task should have **after** the drop, in the target column. The moved task is placed **after** `after_task_id` and **before** `before_task_id`.

| `after_task_id` | `before_task_id` | Result |
|---|---|---|
| `null` | `null` | End of the target column (or 1024 if empty) |
| `null` | X | Top of column: `X.position - 1024` |
| Y | `null` | Bottom of column: `Y.position + 1024` |
| Y | X | Between them: `(Y.position + X.position) / 2` |

Request (drop "Fix login redirect" into In Review, between WEB-5 and WEB-3):

```json
{
  "status": "in_review",
  "after_task_id": "40000000-0000-4000-8000-000000000005",
  "before_task_id": "40000000-0000-4000-8000-000000000003"
}
```

`200`: the moved `Task` with its new `status` and `position`.

Notes:
- When the gap between the neighbours is below `1e-6` (or they share a position), the server rebalances the whole target column in the same transaction: positions 1024, 2048, ... in the current order, with the moved task in its requested place. Other tasks' positions (and their `updated_at`) may change, so after a move the UI invalidates the project's task list query instead of patching other tasks. Other columns never change.
- Both neighbours must be tasks of the same project, already in the target `status`, and not the moved task itself. Otherwise `422` on `after_task_id` / `before_task_id` with message `"Must be another task of this project with the target status"` (the same message for a missing task, one of another project or workspace, and the task itself). Both fields are reported when both are wrong.
- When both are given, `before_task_id` must come after `after_task_id` in the column (they need not be adjacent). Otherwise (including the same id twice) `422` on `before_task_id`, message `"Must come after after_task_id in the target column"`.
- If the column changed since the client loaded it, the task goes **directly after** `after_task_id` (or, with only `before_task_id`, **directly before** it), between it and its current neighbour, and never takes another task's position. With an up-to-date column this is exactly the table above.

Errors, in the order they are checked: `404`, `403`, `422` (body), `409 project_archived`, `422` (neighbours). A failed move changes nothing.

#### `GET /me/tasks` (auth)

Tasks assigned to the current user in the workspaces they are **currently** a member of (any role), excluding archived projects. A task still assigned to the user in a workspace they have left is not returned. Not paginated. Ordered by `due_date` ascending (no due date last), then `created_at`, then `id`. `[]` when there are none. Query: `status` (repeatable) and `due_before`, validated as in the project task list; other parameters are ignored.

`200`: `MyTask[]`, a `Task` plus `project` and `workspace` summaries:

```json
[
  {
    "id": "40000000-0000-4000-8000-000000000001",
    "project_id": "30000000-0000-4000-8000-000000000001",
    "workspace_id": "20000000-0000-4000-8000-000000000001",
    "number": 1,
    "key": "WEB-1",
    "title": "Fix login redirect",
    "description": "After login users land on /404 instead of the dashboard.",
    "status": "in_progress",
    "priority": "high",
    "position": 1024.0,
    "assignee": { "id": "10000000-0000-4000-8000-000000000002", "name": "Ben Okafor" },
    "due_date": "2026-12-01",
    "comment_count": 2,
    "created_by": "10000000-0000-4000-8000-000000000001",
    "created_at": "2026-11-22T09:20:00Z",
    "updated_at": "2026-11-22T10:02:00Z",
    "project": { "id": "30000000-0000-4000-8000-000000000001", "name": "Website", "key": "WEB" },
    "workspace": { "id": "20000000-0000-4000-8000-000000000001", "name": "Acme", "slug": "acme" }
  }
]
```

Errors: `401`, `422`.

---

### 3.7 Comments (Phase 5, implemented)

- `/tasks/{tid}/comments` follows the `404` and malformed-id rules of 3.6 (message `"Task not found"`, `field: "tid"`).
- Every `/comments/{cid}` endpoint returns `404 not_found` with message `"Comment not found"` when the comment does not exist (also after it or its task was deleted) or the caller is not a member of its workspace (comment → task → project → workspace), and `422` (`field: "cid", location: "path"`) for a malformed id. A comment of another workspace gets exactly the same `404` as an id that does not exist.
- Roles always come from the comment's (task's) own workspace.
- `body` is trimmed (section 1.8), then 1 to 5000 characters; line breaks and inner whitespace are kept. Unknown and server-controlled fields in a body (`id`, `task_id`, `author`, `author_id`, `created_at`, `edited_at`, ...) are ignored.
- Archived projects: creating and editing return `409` with `details.reason = "project_archived"` and message `"This project is archived, so its comments are read-only"`. Listing and deleting still work.
- Comments are deleted with their task (`DELETE /tasks/{tid}`) and their workspace. A comment whose author left the workspace stays, under the author's name; the author can no longer reach it (`404`).

`403` responses:

| When | `details.reason` | `message` |
|---|---|---|
| A viewer posts a comment | `insufficient_role` | `"Only owners, admins and members can comment"` |
| A viewer edits or deletes any comment, even one they wrote before being demoted | `insufficient_role` | `"Only owners, admins and members can edit or delete their comments"` |
| Anyone but the author edits a comment (admins and owners included) | `not_author` | `"Only the author can edit this comment"` |
| A member deletes someone else's comment | `not_author` | `"Only owners and admins can delete other people's comments"` |

#### `GET /tasks/{tid}/comments` (viewer)

Paginated (section 1.6), **oldest first**: by `created_at`, then `id`. Query: `limit` (1 to 100, default 20) and `cursor`. A task without comments returns `{ "items": [], "next_cursor": null }`. Works in archived projects. `200`:

```json
{
  "items": [
    {
      "id": "50000000-0000-4000-8000-000000000001",
      "task_id": "40000000-0000-4000-8000-000000000001",
      "author": { "id": "10000000-0000-4000-8000-000000000002", "name": "Ben Okafor" },
      "body": "Reproduced on Chrome and Firefox.",
      "created_at": "2026-11-22T10:00:00Z",
      "edited_at": null
    }
  ],
  "next_cursor": null
}
```

To load the whole thread, follow `next_cursor` until it is `null`; a comment posted meanwhile appears on the last page.

Errors: `404`, `422` (`location: "query"`, `field: "limit"` or `"cursor"`; section 1.6).

#### `POST /tasks/{tid}/comments` (member)

The author is the caller. `edited_at` is `null`. Request:

```json
{ "body": "Reproduced on Chrome and Firefox." }
```

`201`: the new `Comment` (same shape as the list items).

Errors, in the order they are checked:
- `404`, then `403 insufficient_role` (viewer).
- `422` for an invalid body.
- `409 project_archived`.

#### `PATCH /comments/{cid}` (author only, who must still be member or above)

Only `body` can change. Partial per 1.7: `{}`, or the current body (after trimming), returns the comment unchanged, `edited_at` included; `"body": null` is a `422`. Request:

```json
{ "body": "Reproduced on Chrome, Firefox and Safari." }
```

`200`: the `Comment` with the new `body` and `edited_at` set to the server's current time (`created_at` never changes):

```json
{
  "id": "50000000-0000-4000-8000-000000000001",
  "task_id": "40000000-0000-4000-8000-000000000001",
  "author": { "id": "10000000-0000-4000-8000-000000000002", "name": "Ben Okafor" },
  "body": "Reproduced on Chrome, Firefox and Safari.",
  "created_at": "2026-11-22T10:00:00Z",
  "edited_at": "2026-11-22T10:12:00Z"
}
```

Editing is author-only. Admins may delete any comment but not edit other people's comments (role matrix, PLAN.md section 4).

Errors, in the order they are checked:
- `404`, then `403 insufficient_role` (viewer, also for their own comment).
- `422` for an invalid body.
- `403 not_author` (the caller did not write the comment).
- `409 project_archived` (for any body, even `{}`).

#### `DELETE /comments/{cid}` (author with member role or above, or admin/owner)

`204`. Allowed in archived projects. The task's `comment_count` drops by one.

Errors, in the order they are checked:
- `404` (also for a comment that is already deleted).
- `403 insufficient_role` (viewer, also for their own comment).
- `403 not_author` (a member deleting someone else's comment).

---

### 3.8 Activity (Phase 6, implemented)

#### `GET /workspaces/{wid}/activity` (viewer)

Paginated (section 1.6), **newest first**: by `created_at` descending, then `id` descending; the cursor works the same way as for comments, in that direction. Query: `project_id`, `task_id`, `actor_id` (each optional, a UUID), `limit` (1 to 100, default 20) and `cursor`.

- Filters combine with AND. They narrow the results and never cause a `404`; an id from another workspace, or one that does not exist, just matches nothing (`{ "items": [], "next_cursor": null }`). The per-task activity tab uses `?task_id=` (the task's `workspace_id` is on the `Task`); the feed's project filter uses `?project_id=`.
- `project_id` matches the project's entries and those of its tasks and comments. `task_id` matches the task's entries and those of its comments. A deleted task's or project's entries no longer match (their ids become `null`, see the rules below).
- Entries written after a walk started are newer than its cursor, so they appear on a fresh first page, not on later pages.
- `created_at` is the time the entry was written. Entries written by one request have increasing timestamps in the order they were written, so they list in reverse of that order.
- Any member (all roles) can read the whole feed, including entries by people who have since left the workspace (`actor` still names them).

`200`:

```json
{
  "items": [
    {
      "id": "60000000-0000-4000-8000-000000000001",
      "workspace_id": "20000000-0000-4000-8000-000000000001",
      "project_id": "30000000-0000-4000-8000-000000000001",
      "task_id": "40000000-0000-4000-8000-000000000001",
      "actor": { "id": "10000000-0000-4000-8000-000000000001", "name": "Asha Rao" },
      "action": "task.moved",
      "entity_type": "task",
      "entity_id": "40000000-0000-4000-8000-000000000001",
      "metadata": {
        "task": { "id": "40000000-0000-4000-8000-000000000001", "key": "WEB-1", "title": "Fix login redirect" },
        "before": { "status": "todo" },
        "after": { "status": "in_review" }
      },
      "created_at": "2026-11-22T10:05:00Z"
    }
  ],
  "next_cursor": "eyJjIjoiMjAyNi0xMS0yMlQxMDowNTowMFoiLCJpZCI6IjYwMDAwMDAwLTAwMDAtNDAwMC04MDAwLTAwMDAwMDAwMDAwMSJ9"
}
```

Errors:
- `401`.
- `404 not_found`, message `"Workspace not found"`: the workspace does not exist or the caller is not a member (checked before the query, so a non-member with an invalid query still gets `404`).
- `422`: a malformed `wid` (`location: "path"`), or `location: "query"` with `field` `project_id`, `task_id` or `actor_id` (not a UUID), `limit` or `cursor` (section 1.6).

#### Rules

- Every mutation writes its activity entry in the **same transaction** as the change. A failed mutation writes nothing: requests rejected with `403`, `404`, `409` or `422` write no entry, and an unexpected error before the commit rolls the entries back with the change.
- One request can write several entries. A `PATCH /tasks/{tid}` writes one entry per kind of change, in this order: `task.updated` (title, description, priority), `task.assigned`, `task.due_date_changed`, `task.moved` (status). For example, one that changes title, assignee and status writes `task.updated`, `task.assigned` and `task.moved`. Every other request writes at most one entry.
- A request that changes nothing writes nothing: a PATCH with `{}` or only current values (section 1.7), and a `POST /tasks/{tid}/move` that leaves the task at the same place in the same column (same status, same neighbours). Reads never write.
- `POST /projects/{pid}/tasks` writes only `task.created`, even when the new task has an assignee or a due date. `POST /workspaces` writes only `workspace.created` (no `member.added` for the creator).
- `metadata` holds **snapshots** (names, keys, titles at the time of the action), so the UI renders messages from `action` + `metadata` alone. It never looks up the entity, which may have been renamed or deleted since. `TaskRef` and `ProjectRef` show the task or project as it is **after** the action (so after a rename, `task.updated` names the new title and `before.title` holds the old one).
- After a task or project is deleted, its entries stay. Their `task_id` / `project_id` become `null`; `entity_id` and `metadata` are unchanged. The `task.deleted` entry itself has `task_id: null` (its `project_id` is set). Deleting a workspace deletes its activity.
- `actor` is the user who made the request. For `member.removed` with `self_removal: true` (a member leaving), the actor is the member who left.

Shared metadata refs: `TaskRef = { id, key, title }`, `ProjectRef = { id, name, key }`, `UserRef = { id, name }`.

| `action` | `entity_type` / `entity_id` | `metadata` | Example message |
|---|---|---|---|
| `workspace.created` | workspace / workspace id | `{ "name": "Acme" }` | Asha created the workspace **Acme** |
| `workspace.renamed` | workspace / workspace id | `{ "before": { "name": "Acme" }, "after": { "name": "Acme Inc" } }` | Asha renamed the workspace from Acme to **Acme Inc** |
| `member.added` | member / user id | `{ "user": UserRef, "role": "member" }` | Asha added **Ben** as Member |
| `member.removed` | member / user id | `{ "user": UserRef, "role": "member", "self_removal": false }` | Asha removed **Ben** / Ben left the workspace |
| `member.role_changed` | member / user id | `{ "user": UserRef, "before": { "role": "member" }, "after": { "role": "admin" } }` | Asha changed **Ben**'s role from Member to Admin |
| `project.created` | project / project id | `{ "project": ProjectRef }` | Asha created project **Website** (WEB) |
| `project.updated` | project / project id | `{ "project": ProjectRef, "changed_fields": ["name", "description"], "before": { "name": "Website" }, "after": { "name": "Website v2" } }` | Asha updated project **Website v2** |
| `project.archived` | project / project id | `{ "project": ProjectRef }` | Asha archived project **Website** |
| `task.created` | task / task id | `{ "task": TaskRef, "status": "todo" }` | Asha created **WEB-1 Fix login redirect** in To Do |
| `task.updated` | task / task id | `{ "task": TaskRef, "changed_fields": ["title", "priority"], "before": { "title": "Fix login", "priority": "medium" }, "after": { "title": "Fix login redirect", "priority": "high" } }` | Asha updated the title and priority of **WEB-1** |
| `task.moved` | task / task id | `{ "task": TaskRef, "before": { "status": "todo" }, "after": { "status": "in_review" } }` | Asha moved **Fix login redirect** from To Do to In Review (same status: "reordered ... in To Do") |
| `task.assigned` | task / task id | `{ "task": TaskRef, "before": { "assignee": UserRef or null }, "after": { "assignee": UserRef or null } }` | Asha assigned **WEB-1** to Ben / unassigned **WEB-1** |
| `task.due_date_changed` | task / task id | `{ "task": TaskRef, "before": { "due_date": null }, "after": { "due_date": "2026-12-01" } }` | Asha set the due date of **WEB-1** to Dec 1 |
| `task.deleted` | task / task id | `{ "task": TaskRef }` | Asha deleted **WEB-1 Fix login redirect** |
| `comment.created` | comment / comment id | `{ "task": TaskRef, "excerpt": "Reproduced on Chrome..." }` | Ben commented on **WEB-1**: "Reproduced on Chrome..." |
| `comment.edited` | comment / comment id | `{ "task": TaskRef, "excerpt": "..." }` | Ben edited a comment on **WEB-1** |
| `comment.deleted` | comment / comment id | `{ "task": TaskRef }` | Asha deleted a comment on **WEB-1** |

Details:
- `changed_fields` lists every field that changed, in the order `name`, `description` (projects) or `title`, `description`, `priority` (tasks). `before` and `after` hold the old and new values of changed fields **except** `description`, which only appears in `changed_fields` (it can be long). A description-only change has `"before": {}, "after": {}`.
- `task.updated` covers `title`, `description` and `priority`. Status, assignee and due date changes use their own actions.
- `excerpt` is the first 140 characters of the comment body (after trimming), without an ellipsis; the UI adds one if it wants. `comment.edited` has the excerpt of the new body.
- A `task.moved` within the same column has `before.status == after.status`. A status change through `PATCH /tasks/{tid}` is also a `task.moved`.
- `task.assigned` names the previous assignee even if they have since left the workspace. `null` means unassigned.
- Values are JSON: ids are strings, `due_date` is `YYYY-MM-DD` or `null`, `role` and `status` are the enum strings (sections 1.2 and 1.9).

---

### 3.9 WebSocket live updates (Phase 8, stretch)

`GET /ws?workspace_id=<uuid>` upgrades to a WebSocket (through the Vite proxy in dev). It is authenticated by the same cookie during the handshake.

Close codes:
- `4401`: not authenticated.
- `4404`: workspace not found or the user is not a member.

The server sends one event per activity entry, after the transaction commits:

```json
{
  "type": "task.moved",
  "entity": "task",
  "id": "40000000-0000-4000-8000-000000000001",
  "actor_id": "10000000-0000-4000-8000-000000000001",
  "workspace_id": "20000000-0000-4000-8000-000000000001",
  "project_id": "30000000-0000-4000-8000-000000000001",
  "task_id": "40000000-0000-4000-8000-000000000001"
}
```

- `type` is the activity `action`.
- `entity` and `id` are the activity `entity_type` and `entity_id`.
- Every 30 seconds the server sends `{ "type": "ping" }`. Clients may ignore it.
- Clients ignore events whose `actor_id` is the current user, and otherwise invalidate the matching TanStack Query keys.
