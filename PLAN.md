# TaskBoard: Build Plan (Mini Project Management Tool)

A multi-user, Trello/Jira-lite monolith: **React (Vite + TS) + FastAPI + PostgreSQL**.
This file is the single source of truth. Read it fully before doing anything, then follow the phases in order.

---

## 0. How to Use This Plan

1. Put this file at the repo root as `PLAN.md`.
2. Start Claude Code and say: **"Read PLAN.md and execute Phase 0."**
3. After Phase 0, open **two** Claude Code sessions (two terminals):
   - **Agent B (Backend):** "Read PLAN.md and CLAUDE.md. You are the Backend Agent. Execute the backend track starting at Phase 1."
   - **Agent U (UI):** "Read PLAN.md and CLAUDE.md. You are the UI Agent. Execute the UI track starting at Phase 1."
4. Recommended: give each agent its own git worktree and branch so they never collide:
   ```
   git worktree add ../taskboard-backend -b agent/backend
   git worktree add ../taskboard-ui -b agent/ui
   ```
   Merge to `main` at each **Sync Point** (see section 8).

---

## 1. Hard Constraints

- **Monolith:** one FastAPI process serves the API (`/api/*`), the WebSocket (`/api/ws`), and the built React app (`frontend/dist`).
- **Docker:** exactly ONE file, `docker-compose.yml`, containing ONLY the Postgres service. **No Dockerfile, no .dockerignore, no other Docker/compose files, no containerizing the app.** The app runs locally with uvicorn.
- **Stack:** Python 3.12, FastAPI, SQLAlchemy 2.0 (**sync**, psycopg 3), Alembic, Pydantic v2, pytest. React 18, Vite, TypeScript (strict), React Router, TanStack Query, Vitest + Testing Library.
- **Auth:** JWT stored in an **httpOnly, SameSite=Lax cookie**. No tokens in localStorage.
- **Migrations:** Alembic only. Never use `Base.metadata.create_all()` outside tests.
- Do not add libraries beyond those listed without a short justification in the PR/commit message.

---

## 2. Repository Layout

```
taskboard/
├── PLAN.md
├── CLAUDE.md                  # architecture rules for every session (created in Phase 0)
├── docker-compose.yml         # Postgres only
├── .env.example
├── Makefile                   # dev shortcuts (db, migrate, backend, frontend, test, build)
├── docs/
│   └── api-contract.md        # THE contract between agents (created in Phase 0)
├── backend/
│   ├── pyproject.toml
│   ├── alembic.ini
│   ├── alembic/versions/
│   ├── app/
│   │   ├── main.py            # app factory, routers, static serving, SPA fallback
│   │   ├── core/              # config.py, security.py, errors.py, logging.py
│   │   ├── db/                # base.py, session.py
│   │   ├── models/            # SQLAlchemy models (one file per aggregate)
│   │   ├── schemas/           # Pydantic request/response models
│   │   ├── repositories/      # DB queries only, no business rules
│   │   ├── services/          # business logic, permission checks, activity logging
│   │   ├── api/
│   │   │   ├── deps.py        # get_db, get_current_user, require_role(...)
│   │   │   └── routers/       # auth, workspaces, members, projects, tasks, comments, activity, ws
│   │   └── realtime/          # websocket connection manager (Phase 8)
│   └── tests/                 # mirrors app/ structure; factories in tests/factories.py
└── frontend/
    ├── package.json
    ├── vite.config.ts         # proxy /api and /api/ws to :8000
    └── src/
        ├── app/               # router, providers, layout shell
        ├── api/               # http client, generated types, per-resource query hooks
        ├── features/          # auth, workspaces, members, projects, tasks, comments, activity
        ├── components/        # shared UI primitives (Button, Modal, Avatar, Toast, ...)
        ├── lib/               # utils, date helpers, permissions helper
        └── mocks/             # MSW handlers (UI works before backend is ready)
```

---

## 3. Architecture Rules (copy into CLAUDE.md)

### Backend
1. **Layering is strict:** `router -> service -> repository -> model`. Routers parse HTTP and call one service function. Services own business rules, permission checks, transactions, and activity logging. Repositories contain queries only. Routers never touch the session directly.
2. **One transaction per request.** The service commits once at the end. The activity log row is written in the **same transaction** as the change it describes.
3. **Permissions live in one place:** `api/deps.py::require_role(min_role)` plus `services/permissions.py` (a pure function `can(role, action) -> bool`). No inline `if role == ...` in routers or services other than via `can()`.
4. **Tenant isolation:** every query for workspace-scoped data filters by `workspace_id`. Resolve project/task -> workspace first, then check membership. Return **404** (not 403) when the user is not a member, so existence isn't leaked.
5. **Errors:** raise domain exceptions (`NotFound`, `Forbidden`, `Conflict`, `ValidationFailed`) in services; one exception handler maps them to the error envelope in the contract.
6. **Schemas:** separate `Create`, `Update`, and `Read` Pydantic models. Never return ORM models or password hashes.
7. **Config** via `pydantic-settings` reading `.env`. No hardcoded secrets.
8. Type hints everywhere, `ruff` + `mypy` clean.

### Frontend
1. **Feature folders.** Each feature owns its components, hooks, and types. Shared stuff goes in `components/` or `lib/`.
2. **Server state = TanStack Query only.** No copying server data into useState/Redux. UI state stays local or in small contexts.
3. **All HTTP goes through `api/client.ts`** (fetch wrapper: `credentials: 'include'`, JSON handling, error envelope parsing, 401 -> redirect to login).
4. **Types come from the contract.** Generate `src/api/schema.d.ts` from the backend OpenAPI (`openapi-typescript`) once the backend publishes it; until then, hand-write types strictly matching `docs/api-contract.md`.
5. **Permission-aware UI:** use `lib/permissions.ts` (mirror of backend matrix) to hide/disable actions, but the backend remains the authority.
6. Every data view handles **loading, empty, and error** states.
7. Accessibility basics: semantic elements, labels, keyboard-operable modals and drag-drop fallback.

---

## 4. Domain Model

| Table | Key columns |
|---|---|
| `users` | id (uuid), email (unique, citext), name, password_hash, created_at |
| `workspaces` | id, name, slug (unique), created_by, created_at |
| `workspace_members` | workspace_id, user_id, role (`owner/admin/member/viewer`), joined_at. PK (workspace_id, user_id) |
| `projects` | id, workspace_id, name, description, key (e.g. "WEB"), archived_at, created_by, created_at |
| `tasks` | id, project_id, workspace_id (denormalized for fast scoping), number (per-project sequence), title, description, status (`todo/in_progress/in_review/done`), priority (`low/medium/high/urgent`), position (float, for ordering within a column), assignee_id (nullable), due_date (nullable), created_by, created_at, updated_at |
| `comments` | id, task_id, workspace_id, author_id, body, created_at, edited_at |
| `activity_logs` | id, workspace_id, project_id (nullable), task_id (nullable), actor_id, action (string, e.g. `task.created`), entity_type, entity_id, metadata (jsonb: before/after), created_at |

Indexes: `tasks(project_id, status, position)`, `tasks(assignee_id)`, `tasks(due_date)`, `activity_logs(workspace_id, created_at desc)`, `comments(task_id, created_at)`.

**Ordering:** `position` is a float. Moving a task between neighbors sets `position = (prev + next) / 2`; first/last use +/- 1024. Backend rebalances a column if gaps get too small.

### Role Permission Matrix

| Action | Owner | Admin | Member | Viewer |
|---|:-:|:-:|:-:|:-:|
| View workspace, projects, tasks, comments, activity | Y | Y | Y | Y |
| Create/edit/move tasks, assign, set due date | Y | Y | Y | - |
| Comment | Y | Y | Y | - |
| Edit/delete **own** comment | Y | Y | Y | - |
| Delete any comment, delete any task | Y | Y | - | - |
| Create/edit/archive projects | Y | Y | - | - |
| Add/remove members, change roles (not owners) | Y | Y | - | - |
| Rename/delete workspace, transfer ownership, promote to admin | Y | - | - | - |

Rules: a workspace always has at least one owner. Admins cannot modify owners or other admins' roles. A user cannot change their own role.

### Activity Actions
`workspace.created/renamed`, `member.added/removed/role_changed`, `project.created/updated/archived`, `task.created/updated/moved/assigned/deleted`, `task.due_date_changed`, `comment.created/edited/deleted`.

---

## 5. API Contract (summary; full version goes in `docs/api-contract.md`)

Base path `/api`. JSON. Auth cookie `access_token` (httpOnly, SameSite=Lax, Secure in prod). Mutating requests must send header `X-Requested-With: taskboard` (basic CSRF defense, enforced by backend middleware).

**Error envelope (all non-2xx):**
```json
{ "error": { "code": "forbidden", "message": "Human readable", "details": {} } }
```
Codes: `validation_error` (422), `unauthorized` (401), `forbidden` (403), `not_found` (404), `conflict` (409).

**Pagination:** list endpoints that can grow (`activity`, `comments`) use `?limit=&cursor=` and return `{ "items": [...], "next_cursor": "..." | null }`.

| Method | Path | Min role | Notes |
|---|---|---|---|
| POST | `/auth/register` | public | email, name, password; sets cookie |
| POST | `/auth/login` | public | sets cookie |
| POST | `/auth/logout` | auth | clears cookie |
| GET | `/auth/me` | auth | current user |
| GET | `/workspaces` | auth | workspaces I belong to, with my role |
| POST | `/workspaces` | auth | creator becomes owner |
| GET/PATCH/DELETE | `/workspaces/{wid}` | viewer / owner / owner | |
| GET | `/workspaces/{wid}/members` | viewer | |
| POST | `/workspaces/{wid}/members` | admin | add existing user by email + role |
| PATCH/DELETE | `/workspaces/{wid}/members/{uid}` | admin | change role / remove (self-leave allowed for non-last-owner) |
| GET/POST | `/workspaces/{wid}/projects` | viewer / admin | |
| GET/PATCH | `/projects/{pid}` | viewer / admin | |
| POST | `/projects/{pid}/archive` | admin | |
| GET | `/projects/{pid}/tasks` | viewer | filters: `status`, `assignee_id`, `priority`, `due_before`, `q` |
| POST | `/projects/{pid}/tasks` | member | |
| GET/PATCH/DELETE | `/tasks/{tid}` | viewer / member / admin | |
| POST | `/tasks/{tid}/move` | member | body: `{status, before_task_id?, after_task_id?}` |
| GET/POST | `/tasks/{tid}/comments` | viewer / member | |
| PATCH/DELETE | `/comments/{cid}` | author or admin | |
| GET | `/workspaces/{wid}/activity` | viewer | filters: `project_id`, `task_id`, `actor_id` |
| GET | `/me/tasks` | auth | tasks assigned to me across workspaces, with due dates |
| GET | `/health` | public | |
| WS | `/ws?workspace_id=` | viewer | Phase 8 only |

Task read model includes nested `assignee {id,name}` and `comment_count`. Timestamps are ISO 8601 UTC.

---

## 6. Dev Workflow and Commands

`Makefile` targets (created in Phase 0):
```
make db          # docker compose up -d
make migrate     # alembic upgrade head
make backend     # uvicorn app.main:app --reload --port 8000
make frontend    # vite dev (port 5173, proxies /api -> 8000)
make test        # pytest + vitest
make build       # npm run build (output served by FastAPI)
make start       # run FastAPI serving the built frontend (single process, port 8000)
```

`docker-compose.yml` (the ONLY Docker file): service `db` using `postgres:16`, a named volume, port 5432, env from `.env`, and a healthcheck. Nothing else.

---

## 7. Phases and Tracks

**Phase 0 is done once, by a single agent, before parallel work begins.** From Phase 1 onward, Backend (B) and UI (U) work in parallel on the same phase number. Each phase ends at a **Sync Point**.

### Phase 0: Foundation (single agent, sequential)
- Create repo layout, `.gitignore`, `.env.example`, `Makefile`, `docker-compose.yml` (Postgres only).
- Backend scaffold: pyproject (ruff, mypy, pytest), app factory, config, DB session, Alembic init wired to models, `/api/health`, error handlers, test setup with a separate test database.
- Frontend scaffold: Vite + React + TS strict, Router, TanStack Query provider, `api/client.ts`, MSW setup, Vitest config, Vite proxy.
- Write **CLAUDE.md** from section 3 plus: folder ownership (section 8), commands, and "never do" list (no extra Docker files, no create_all, no business logic in routers, no server state in useState).
- Write the full **docs/api-contract.md** from section 5, expanded with exact request/response JSON examples for every endpoint. This is what lets both agents work independently.
- Done when: `make db && make migrate && make backend` serves `/api/health`; `make frontend` shows a blank shell; `make test` passes; first commit on `main`.

### Phase 1: Auth
- **B:** `users` model + migration, register/login/logout/me, password hashing (argon2 or bcrypt), JWT cookie, `get_current_user` dependency, CSRF header middleware, tests (duplicate email, wrong password, expired token, missing cookie).
- **U:** Login and Register pages, `useMe` query, auth guard route wrapper, logout, 401 handling, app shell (header, user menu), form validation, MSW handlers for auth, component tests.
- **Sync:** UI switches from MSW to the real backend; login/register/logout work end to end.

### Phase 2: Workspaces, Members, Roles
- **B:** `workspaces` and `workspace_members` models + migration, `permissions.py` (`can()` matrix), `require_role` dependency, workspace CRUD, member add/change/remove with the owner rules, **permission matrix tests parametrized over all roles and actions**, 404 for non-members.
- **U:** Workspace switcher, create-workspace modal, workspace settings page, members table (add by email, role dropdown, remove), `lib/permissions.ts`, a `<Can action="...">` component, role badges.
- **Sync:** run publish OpenAPI -> UI regenerates `schema.d.ts`; verify the UI permission helper matches the backend matrix.

### Phase 3: Projects
- **B:** `projects` model + migration, project CRUD + archive, list scoped by workspace, tests incl. cross-workspace isolation.
- **U:** Projects list/grid in a workspace, create/edit project modal, archive action, project layout with sidebar and breadcrumbs, empty states.
- **Sync:** create, edit, and archive a project in the browser as owner, admin, member, viewer (verify each role's UI).

### Phase 4: Tasks and Kanban
- **B:** `tasks` model + migration (per-project `number` sequence, safe under concurrency), CRUD, filters and search (`q` using ILIKE or `tsvector`), `move` endpoint with position logic and rebalance, `/me/tasks`, tests (ordering, move between columns, assignee must be a workspace member, viewer cannot write).
- **U:** Kanban board with four columns, drag-and-drop (dnd-kit) with **optimistic updates and rollback on error**, keyboard-accessible move menu as fallback, task card (priority, assignee avatar, due date, overdue styling), create-task inline form, task detail drawer/modal (edit title, description, status, priority, assignee, due date), filter bar, list-view toggle, "My Tasks" page.
- **Sync:** drag a card, refresh, order persists; assign a task and see it under My Tasks.

### Phase 5: Comments
- **B:** `comments` model + migration, create/list (cursor pagination)/edit/delete with author-or-admin rule, `comment_count` on tasks, tests.
- **U:** Comment thread inside the task drawer, add/edit/delete own comment, relative timestamps, disabled composer for viewers, optimistic add.
- **Sync:** comment counts on cards update after posting.

### Phase 6: Activity Log
- **B:** `activity_logs` model + migration, `ActivityService.record(...)` called from every mutating service **inside the same transaction**, retrofit all earlier services (workspace, member, project, task, comment), activity list endpoint with filters and cursor pagination, tests proving a failed mutation writes no log row.
- **U:** Workspace activity feed page, per-task activity tab in the drawer, human-readable messages built from `action + metadata` (e.g. "Asha moved *Fix login* from To Do to In Review"), infinite scroll, filter by project/actor.
- **Sync:** perform actions in the UI and see each appear in the feed correctly.

### Phase 7: Polish, Hardening, and Single-Process Serving
- **B:** Rate-limit auth endpoints, consistent logging with request IDs, index review via `EXPLAIN` on the main list queries, seed script (`python -m app.seed`: demo users, workspace, projects, tasks), FastAPI serves `frontend/dist` with `StaticFiles` and an SPA catch-all that excludes `/api`, security headers, CORS disabled in prod (same origin), README backend section.
- **U:** Toasts and global error boundary, skeleton loaders, responsive layout down to tablet, dark mode (optional), dashboard page (my overdue and due-this-week tasks), accessibility pass, empty/error states audit, Vitest tests for kanban and permission-gated UI, README frontend section.
- **Final Sync:** `make build && make start`, open `http://localhost:8000`, run through the full acceptance checklist (section 9).

### Phase 8 (Stretch): WebSocket Live Updates
- **B:** `realtime/manager.py` (per-workspace connections, auth via cookie on handshake, membership check), publish an event after commit for each activity log entry (`{type, entity, id, actor_id, workspace_id}`), heartbeat, tests with the Starlette test client.
- **U:** `useRealtime(workspaceId)` hook that connects, reconnects with backoff, and **invalidates the relevant TanStack Query keys** on events (no manual cache surgery), presence of "updated by someone else" toast, ignore events caused by the current user.
- **Sync:** two browser windows as different users see changes instantly.

---

## 8. Parallel Agent Protocol

**Ownership (strict):**

| Path | Owner |
|---|---|
| `backend/**` | Backend Agent only |
| `frontend/**` | UI Agent only |
| `docs/api-contract.md` | Backend Agent edits; UI Agent may only propose changes |
| `PLAN.md`, `CLAUDE.md`, `docker-compose.yml`, `Makefile` | Neither, unless the human approves |

**Rules for both agents:**
1. **The contract is law.** The UI Agent builds against `docs/api-contract.md` and MSW mocks (`frontend/src/mocks`) so it never waits for the backend. The Backend Agent must implement the contract exactly.
2. **Contract changes** are the only cross-boundary change. If an agent needs a change: write it in `docs/CONTRACT_CHANGES.md` (what, why, affected endpoints), keep going with the current contract, and let the human or the Backend Agent apply it at the next Sync Point. Never silently deviate.
3. **Backend publishes OpenAPI** at the end of each phase (`make openapi` writes `docs/openapi.json`). The UI Agent regenerates types from it and fixes any mismatch with its mocks.
4. **Small commits, conventional messages** (`feat(backend): ...`, `feat(ui): ...`, `test(...)`, `fix(...)`). One commit per logical unit.
5. **Definition of done per phase** for each agent: code complete, tests written and passing, lint/type-check clean, no TODOs left unexplained, contract matches reality.
6. **At each Sync Point:** both agents stop, push their branch, the human merges both into `main`, runs the integration check listed in the phase, and both agents rebase on `main` before starting the next phase.
7. If blocked by the other agent, mock it and note the dependency in `docs/BLOCKERS.md`. Do not edit the other agent's directory.

---

## 9. Final Acceptance Checklist

- [ ] `docker compose up -d` is the only Docker usage, and only one Docker-related file exists in the repo
- [ ] Register two users; user A creates a workspace and invites user B as Member
- [ ] Roles behave per the matrix in both the API (tested) and the UI (buttons hidden/disabled)
- [ ] Create projects; create, edit, drag, assign, and set due dates on tasks; ordering persists after refresh
- [ ] Comments work, with the author/admin rule enforced
- [ ] Every mutation appears in the activity feed with a readable message
- [ ] A user outside a workspace gets 404 for all its resources
- [ ] `make test` passes (backend permission matrix and isolation tests included)
- [ ] `make build && make start` serves the full app from one process on port 8000, deep links like `/w/acme/projects/1` work on refresh
- [ ] README explains setup in under 10 commands
- [ ] (Stretch) Live updates work across two browser windows

---

## 10. Things To Avoid

- Adding a Dockerfile, extra compose files, or any container config for the app
- Business logic inside routers or React components
- Using `create_all()`, raw SQL string concatenation, or unscoped queries (always filter by `workspace_id`)
- Storing the JWT in localStorage
- Copying server data into client state instead of using TanStack Query
- Inventing endpoints or fields that aren't in the contract
- Large "do everything" commits or skipping tests to move faster
