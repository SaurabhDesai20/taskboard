# TaskBoard build progress

One section per phase: what was built, what was tested, decisions and open issues.
Each phase was built by two parallel subagents (backend track, UI track), then integrated:
OpenAPI published (`scripts\openapi.ps1`), UI types regenerated (`npm run gen:api`), and
`scripts\lint.ps1` + `scripts\test.ps1` run before the phase commit.

Run-wide decisions:
- Migrations are never applied to the dev database `taskboard` by the agents. The test suite
  migrates its own `taskboard_test` database; integration smoke checks run uvicorn against that
  test database. Apply migrations to the dev database yourself with `.\scripts\migrate.ps1`.
- The UI builds against MSW mocks; `frontend/.env.development` switched to the real backend
  (`VITE_API_MOCKING=false`) at the Phase 1 Sync Point. Vitest keeps using MSW.

## Phase 1: Auth

**Built**
- Backend:
  - `users` model and migration (citext email).
  - Register, login, logout and me endpoints.
  - argon2id password hashing and an HS256 JWT in the `access_token` cookie (httpOnly, SameSite=Lax, Secure only when `COOKIE_SECURE=true`).
  - `get_current_user` dependency.
  - CSRF middleware (403 `csrf` when `X-Requested-With: taskboard` is missing), which runs before routing and auth.
  - Unknown-email logins take about as long as wrong-password logins.
- UI:
  - Login and register pages with client-side and server-side validation errors.
  - `useMe`, plus login, register and logout mutations.
  - `RequireAuth` / `RequireGuest` route guards that remember the target page.
  - In-app 401 handling (no page reload).
  - A header with a keyboard-accessible user menu.
  - MSW auth handlers with a resettable in-memory database.
  - `openapi-typescript` with `npm run gen:api`.
- Sync Point:
  - The UI's auth types are now aliases of the generated `UserRead`, `RegisterRequest` and `LoginRequest`.
  - `VITE_API_MOCKING=false`: the dev UI talks to the real backend.

**Tested**
- `lint.ps1` is clean.
- `test.ps1`: 91 backend tests and 73 frontend tests pass.
- Live smoke check through the Vite proxy: 13/13. It covers register, cookie set, me, logout without CSRF (403), logout, me after logout (401), wrong password, case-insensitive login, duplicate email (409) and invalid register (422).

**Decisions**
- Passwords are not trimmed. Login accepts passwords of 1 to 128 characters, so a too-short password gets the same 401 as a wrong one (contract updated).
- The test client sends the CSRF header by default.
- `setup.ps1` now writes a random 64-character `JWT_SECRET` into a new `.env`.
- The local `.env` secret was rotated, because PyJWT warned that the old one was too short.
- New libraries:
  - `argon2-cffi`: hashing.
  - `PyJWT`: tokens.
  - `email-validator`: pydantic `EmailStr`.
  - `openapi-typescript`: type generation. It has an npm `overrides` entry for TypeScript 6.

**Open issues**
- The dev database has not been migrated. Run `.\scripts\migrate.ps1`.
- With mocks on in the browser, a reload loses the mock session. Mocks are now off in dev.

## Phase 2: Workspaces, Members, Roles

**Built**
- Backend:
  - `workspaces` and `workspace_members` models and migration. The role column is VARCHAR with a CHECK constraint; deleting a workspace cascades to its members.
  - `services/permissions.py`: one data table over the 10 shared action ids, plus `can()`.
  - A shared access helper: 404 for a missing workspace or a non-member, 403 `insufficient_role` for a role that is too low.
  - Workspace CRUD with slug derivation and `-2` suffixes.
  - Members: add, change role, remove and leave, with every owner/admin rule. Owner rows are locked while checking the last-owner rule.
- UI:
  - `lib/permissions.ts` (the same table) with member-rule helpers, `<Can>` / `useCan`, `RoleBadge`, and a reusable accessible `Modal` and `ConfirmDialog`.
  - Workspace and member hooks.
  - Pages: `/` (workspace list), `/w/:slug` (overview), `/w/:slug/settings` (rename/delete, members table, add by email, role dropdowns, remove/leave).
  - A header workspace switcher and a create-workspace modal.
  - MSW handlers for all Phase 2 endpoints, seeded with one user per role.
- Sync Point:
  - `schema.d.ts` regenerated. `Role`, `WorkspaceRead/Create/Update` and `MemberRead/Create/Update` are now aliases of the generated types.
  - The permission matrix was compared programmatically, backend `PERMISSIONS` against UI `PERMISSIONS`: all 10 actions × 4 roles match.

**Tested**
- `lint.ps1` is clean.
- `test.ps1`: 395 backend tests (including the full role × action matrix and every endpoint × role) and 247 frontend tests pass.
- Live smoke check through the Vite proxy: 36/36. It covers create (derived slug), slug conflict, add, duplicate and unknown member, member/viewer 403s, outsider 404s, promote, `protected_member`, `own_role`, `last_owner`, role ordering, leave, and delete.

**Decisions**
- `require_role` takes an **action id** (`require_role("member.manage")`) instead of a minimum role. The gate still decides through `can()`. PLAN.md and CLAUDE.md still say `require_role(min_role)`, which is now out of date.
- The `/` page lists workspaces. The Phase 0 health status page was removed.
- No new libraries.

**Open issues**
- After removing a member, keyboard focus falls back to the page body.
- The "You left / workspace deleted" notice lives in router state, so it reappears after a browser reload.

## Phase 3: Projects

**Built**
- Backend:
  - `projects` model and migration: unique `(workspace_id, key)`, cascade from workspaces.
  - CRUD plus archive. Archive is a single conditional UPDATE, so a second archive gets 409 `already_archived`.
  - `project_access()`, which resolves project → workspace and then reuses the workspace access check and `can()`.
  - `require_project_role(action)` dependency.
  - The key is immutable: a key sent to PATCH is ignored.
- UI:
  - Project grid on `/w/:slug` with a "Show archived" toggle (`?archived=1`) and loading, empty and error states.
  - Create and edit modals (key suggested from the name; server errors shown on their fields) and an archive confirm dialog.
  - Project layout at `/w/:slug/projects/:projectId` with breadcrumbs, a sidebar, an archived banner, and a not-found state.
  - MSW handlers and seed projects.
- Sync Point: `ProjectRead`, `ProjectCreate` and `ProjectUpdate` are aliases of the generated types.

**Tested**
- `lint.ps1` is clean.
- `test.ps1`: 572 backend tests (including cross-workspace isolation tests that the agent confirmed catch deliberately introduced leaks) and 348 frontend tests pass.
- Live smoke check through the Vite proxy: 56/56. It covers create by owner and admin, duplicate and invalid keys, the member 403, viewer list order, outsider 404s, admin edit, the viewer 403, archive and re-archive (409), the default and `include_archived` lists, the same key allowed in another workspace, and 404 for reading or editing another workspace's project.

**Decisions**
- Project URLs use the project UUID: `/w/:slug/projects/:projectId`.
- Creating a project opens it.
- Archived projects can still be edited by managers. There is no unarchive (contract updated).
- The Sync Point's "verify each role's UI in the browser" was not done in a real browser, because no browser was available to the build. Role-based visibility is covered by component tests for all four roles, and the API side by the smoke check.

**Open issues**
- If the project request fails while the project is still in the cached project list, the page shows the cached copy.
- When a modal closes after a demotion, keyboard focus can land on the page body.

## Phase 4: Tasks and Kanban

**Built**
- Backend:
  - `tasks` model and migration (PLAN indexes, unique `(project_id, number)`) and a `projects.next_task_number` counter.
  - Create, PATCH and move lock the project row (`FOR NO KEY UPDATE`), so task numbers never collide or get reused. A two-connection test and an 8-thread test prove it.
  - List filters: repeatable `status` and `priority`, `assignee_id` or `none`, `due_before` inclusive, and an escaped ILIKE search `q`.
  - Move uses the neighbour semantics, validates neighbours, and rebalances a column when gaps get under 1e-6.
  - `/me/tasks` shows only workspaces you are still a member of and excludes archived projects.
  - Archived projects return 409 `project_archived`. The assignee must be a workspace member.
- UI:
  - dnd-kit Kanban board with optimistic moves that roll back on error, plus a keyboard Move menu fallback.
  - Cards with priority, assignee initials and overdue styling.
  - Inline create per column.
  - A task drawer opened by `?task=<id>` (edits every field; delete with confirmation).
  - URL-synced filters and a Board/List toggle.
  - `/me/tasks` grouped into overdue, due this week, later and no due date.
  - A read-only board for viewers and archived projects.
  - MSW handlers that share the same ordering math (`ordering.ts`).
- Sync Point: 10 task-related types are now aliases of the generated ones (`TaskRead`, `TaskCreate`, `TaskUpdate`, `TaskMoveRequest`, `MyTaskRead`, `UserRef`, `ProjectRef`, `WorkspaceRef`, `TaskStatus`, `TaskPriority`).

**Tested**
- `lint.ps1` is clean.
- `test.ps1`: 885 backend tests and 483 frontend tests pass.
- Live smoke check through the Vite proxy: 89/89. It covers:
  - numbering and defaults;
  - assignee nesting and the non-member 422;
  - viewer 403 and member create;
  - move to the top, between columns, and with an invalid neighbour;
  - **60 inserts that each halve the gap, which keep exact order with strictly increasing positions (rebalance)**;
  - every filter, including escaped `%` and `_`;
  - assignment showing up in the assignee's `/me/tasks`;
  - PATCH null clearing a field, PATCH status moving the task to the end of the new column, and PATCH title null giving 422;
  - member delete 403 and admin delete 204;
  - deleted numbers not reused;
  - the archived-project 409 and outsider 404s.
- The Sync check ("drag, refresh, order persists"; "assign, see it under My Tasks") was verified through the API: move, then re-fetch the order, and assign, then fetch `/me/tasks`. A real mouse drag was not tried in a browser; the drag path shares its mutation with the keyboard Move menu, which is tested.

**Decisions**
- **Type generation:** `gen:api` now runs `openapi-typescript` with `--default-non-nullable false`. Version 7's default made request fields that have defaults (e.g. `TaskCreate.status`) required. All response schemas still mark every field required, which was checked.
- **Out-of-date neighbours:** a move places the task directly after `after_task_id` (or directly before `before_task_id`).
- **Archived projects:** any PATCH on a task returns 409, even `{}`.
- **My Tasks:** shows open tasks only. "Due this week" means today plus the next six days.
- **Status filter:** hides the board columns it leaves out.
- **New libraries:** `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` (drag and drop, as named in PLAN.md).

**Open issues**
- A member who leaves or is removed stays assigned to their tasks (hidden from their `/me/tasks`). Unassigning them on removal is a possible follow-up.
- On a filtered board, "top of column" means the top of the visible tasks.
- The drawer doesn't pick up edits made elsewhere while it is open (Phase 8).
- After deleting a task from the drawer, keyboard focus falls to the page body.

## Phase 5: Comments

**Built**
- Backend:
  - `comments` model and migration, indexed on `(task_id, created_at, id)`.
  - List, create, edit and delete, with keyset cursor pagination (base64url of `created_at` and `id`; an invalid cursor or limit returns 422).
  - Author-or-admin rules: edit is author-only; delete is the author or owner/admin; viewers get 403 `insufficient_role`.
  - Archived projects make comments read-only, but deleting is allowed.
  - `comment_count` is real on every task response. A correlated subquery computes it, and a test shows the number of SQL statements does not grow with the number of tasks.
  - Posting a comment locks the task, so it can't be deleted mid-request.
- UI:
  - Comment thread in the task drawer, built on `useInfiniteQuery` with "Load more".
  - Relative timestamps in `<time>`, and an "(edited)" marker.
  - A composer that is disabled for viewers and archived projects, with the reason shown.
  - Optimistic add with rollback on error.
  - Inline edit and delete per role.
  - A comment count on cards and in the list view that updates after posting or deleting.
  - MSW comment handlers.
- Sync Point:
  - `CommentRead`, `CommentCreate`, `CommentUpdate` and `CommentPage` are aliases of the generated types.
  - The comment mock was re-aligned to the final contract 3.7: PATCH check order, an unchanged body does not set `edited_at`, and the exact 403 messages.

**Tested**
- `lint.ps1` is clean.
- `test.ps1`: 1078 backend tests and 567 frontend tests pass.
- Live smoke check through the Vite proxy: 111/111. It covers:
  - member comment, viewer 403, empty-body 422;
  - `comment_count` on the task, the board list and `/me/tasks`;
  - 25 comments paginated as 20 + 5 with no duplicates and a null last cursor;
  - limit and cursor 422s;
  - author edit, the owner's `not_author` 403, the viewer and member delete 403s, admin delete, author delete;
  - the count after deletes, outsider 404s, and the archived-project 409s with delete still allowed.

**Decisions**
- Check order on PATCH: 404, then 403 role, then 422, then 403 `not_author`, then 409.
- `UserRef` moved to `schemas/user.py`.
- The backend's Phase 4 concurrency test helper had a race; it was fixed.
- The Testing Library async timeout was raised to 3 s, because the full suite flaked under CPU load while the backend tests ran in parallel.
- No new libraries.

**Open issues**
- If more pages exist and the thread refetches, a just-posted comment drops out of view until "Load more".
- Escape in the composer closes the drawer and loses the draft.
- My Tasks does not show comment counts.
