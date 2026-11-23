# TaskBoard backend

FastAPI + SQLAlchemy 2.0 (sync, psycopg 3) + Alembic + PostgreSQL 16, Python 3.12 via
[uv](https://docs.astral.sh/uv/). One process serves the API (`/api/*`) and the built React
app (everything else). The API is specified in [`docs/api-contract.md`](../docs/api-contract.md);
the build plan is [`PLAN.md`](../PLAN.md).

## Setup

From the repo root (PowerShell), the whole app:

```powershell
.\scripts\setup.ps1      # .env from .env.example (random JWT_SECRET), uv sync, npm install
.\scripts\db.ps1         # Postgres in Docker on 127.0.0.1:35432
.\scripts\migrate.ps1    # alembic upgrade head
.\scripts\backend.ps1    # API with reload on http://127.0.0.1:8000 (docs: /api/docs)
```

Single process with the built UI: `.\scripts\build.ps1; .\scripts\start.ps1`, then open
http://localhost:8000.

## Commands (from `backend/`)

| What | Command |
|---|---|
| Install | `uv sync` |
| Dev server | `uv run uvicorn app.main:app --reload --port 8000` |
| Tests | `uv run pytest` |
| Lint, format, types | `uv run ruff check .`, `uv run ruff format --check .`, `uv run mypy` |
| Migrate | `uv run alembic upgrade head` |
| New migration | `uv run alembic revision --autogenerate -m "<change>"` |
| OpenAPI | `uv run python -m app.export_openapi ../docs/openapi.json` |
| Demo data | `uv run python -m app.seed` |

## Environment

Read from the repo-root `.env` (template: `.env.example`) by `app/core/config.py`; real
environment variables win.

| Key | Default | Meaning |
|---|---|---|
| `APP_ENV` | `development` | `development`, `test` or `production`. Production requires a `JWT_SECRET` of 32+ characters, sends HSTS, and `app.seed` refuses to run. |
| `LOG_LEVEL` | `INFO` | Root log level |
| `DATABASE_URL` | (required) | `postgresql+psycopg://...` |
| `TEST_DATABASE_URL` | none | Database for pytest; its name must end with `_test` |
| `JWT_SECRET` | (required) | HS256 signing key |
| `JWT_EXPIRE_MINUTES` | `10080` | Session length (7 days) |
| `COOKIE_SECURE` | `false` | `Secure` cookie; also turns on HSTS. Set `true` behind HTTPS. |
| `AUTH_RATE_LIMIT_PER_MINUTE` | `20` | Requests per client IP per minute to each of login and register; `0` = off |
| `AUTH_RATE_LIMIT_PER_EMAIL_PER_MINUTE` | `10` | Login attempts per client IP and email per minute; `0` = off |
| `FRONTEND_DIST_DIR` | `frontend/dist` | The built UI; a relative path is relative to the repo root |

## Demo data

`uv run python -m app.seed` writes demo data to the database at `DATABASE_URL`, so point it at a
database meant for it (it refuses `APP_ENV=production`). It creates the workspace **Acme**
(`/w/acme`), projects Website (WEB) and Mobile App (MOB), the archived Launch 2025 (L25), 15
tasks in every column with assignees, priorities and due dates relative to today (some
overdue), and comments. Everything goes through the services, so each change has its activity
entry. Logins, all with the password **`taskboard-demo`**:

| Email | Name | Role |
|---|---|---|
| `asha@acme.example.com` | Asha Rao | owner |
| `devon@acme.example.com` | Devon Hale | admin |
| `ben@acme.example.com` | Ben Okafor | member |
| `maya@acme.example.com` | Maya Lin | member |
| `chen@acme.example.com` | Chen Wei | viewer |

It is idempotent: it creates only what is missing, matched by email, workspace slug, project
key and task title, and never changes or deletes existing rows (an existing user keeps their
password). It stops with an error if the slug `acme` belongs to a workspace Asha is not in.

## Tests

`uv run pytest` (Postgres must be running). `tests/conftest.py` creates `TEST_DATABASE_URL`'s
database if needed, drops its `public` schema, runs `alembic upgrade head` once, and wraps each
test in a rolled-back transaction, so services may commit. The suite turns the auth rate
limits off; `tests/api/test_auth_rate_limit.py` builds apps with them on (`app_with(...)`
fixture). `tests/db/test_migrations.py` fails when models and migrations disagree.

## Migrations

Alembic only, never `create_all()`. After changing a model: import it in
`app/models/__init__.py`, autogenerate, review the file, run the tests (they migrate the test
database). The human applies migrations to the dev database with `scripts\migrate.ps1`.

## Architecture

`router -> service -> repository -> model`, strictly:

| Folder | Holds |
|---|---|
| `app/api/routers/` | HTTP only: parse, call one service function, set cookies |
| `app/api/deps.py` | `get_db`, `get_current_user`, `require_role(action)` and its project/task/comment variants |
| `app/api/rate_limit.py` | Rate-limit dependencies for login and register |
| `app/services/` | Business rules, permission checks (`permissions.can()`), one commit per request, activity entries in the same transaction |
| `app/repositories/` | Queries only, always scoped by `workspace_id` |
| `app/models/`, `app/schemas/` | SQLAlchemy models; Pydantic `Create`/`Update`/`Read` models |
| `app/core/` | Config, errors (one envelope for everything), security, CSRF, rate limiter, logging, request context, security headers |
| `app/frontend.py` | Serves `frontend/dist` with the SPA fallback |
| `app/seed.py` | Demo data |

Middleware, outermost first: security headers, request context (request id, access log,
unhandled errors as a 500 envelope), CSRF (`X-Requested-With: taskboard` on mutating `/api`
requests). Routing then tries every `/api` route, and last the frontend route.

## Rate limits

`POST /api/auth/login` and `POST /api/auth/register`: at most `AUTH_RATE_LIMIT_PER_MINUTE`
requests per client IP to each, counted before body validation; login also at most
`AUTH_RATE_LIMIT_PER_EMAIL_PER_MINUTE` attempts per client IP and normalized email. Over a limit:
`429 rate_limited` with `Retry-After` (seconds), before the password is checked. The windows
slide over 60 seconds and live in process memory (`app/core/rate_limit.py`): a restart resets
them, and with several workers each counts on its own. Behind a reverse proxy, run uvicorn with
`--proxy-headers --forwarded-allow-ips=<proxy>` so the limit sees client addresses.

## Logging

One format on stderr: `time level [logger] request_id=<id> message`.

- Every request gets an id: the client's `X-Request-ID` when it matches `[A-Za-z0-9._:-]{1,128}`,
  else 32 hex characters.
- The id is returned in `X-Request-ID` on every response, errors included.
- It is on every log line written while handling the request (a contextvar plus a logging
  filter), `-` outside requests.
- One access line per request from `app.access`: `GET /api/health 200 3.1ms`. Uvicorn's own
  access log is silenced.
- An unhandled exception is logged once, with its traceback and the request id, and answered
  with the `500 internal_error` envelope.

## Security headers and CORS

Every response gets `Content-Security-Policy`, `X-Content-Type-Options: nosniff`,
`X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, `Permissions-Policy` (sensors, camera,
microphone, geolocation, payment, USB off) and `Cross-Origin-Opener-Policy: same-origin`. Values
a response sets itself are kept.

- **CSP for the app:** `default-src 'self'`, `script-src 'self'` (no inline scripts),
  `style-src 'self' 'unsafe-inline'` (React and dnd-kit set inline `style` attributes),
  `img-src 'self' data: blob:`, `connect-src 'self'`, `object-src 'none'`,
  `frame-ancestors 'none'`.
- **Swagger UI** (`/api/docs`) loads its bundle from cdn.jsdelivr.net and starts with an inline
  script, so that page alone gets a policy allowing both.
- **HSTS** (`max-age=31536000; includeSubDomains`) only when `COOKIE_SECURE=true` or
  `APP_ENV=production`.

**No CORS middleware, on purpose.** The UI and the API share one origin: in production FastAPI
serves both, in development the Vite server proxies `/api`. Cross-origin requests get no
`Access-Control-Allow-*` headers, so browsers refuse cross-origin reads and preflights, which
backs up the CSRF header check. A test asserts that a preflight gets no
`Access-Control-Allow-Origin`.

## Serving the frontend

For `GET`/`HEAD` outside `/api`, `app/frontend.py`:

- serves files that exist in `FRONTEND_DIST_DIR`: `/assets/*` with
  `Cache-Control: public, max-age=31536000, immutable` (Vite hashes their names), other files
  with `no-cache`;
- answers every other path with `index.html` (`no-cache`), so deep links like
  `/w/acme/projects/<id>` work on refresh;
- returns a JSON `404` for a missing `/assets/*` file;
- without a build, returns `503 service_unavailable` with a message to run `scripts\build.ps1`.

Unknown `/api` paths keep the JSON `404`, wrong methods the `405`, and other methods outside
`/api` get a `404`. The dist directory is read per request, so a rebuild needs no restart.

## Index review

Method: the test database (PostgreSQL 16.14) was filled with generated data and each list
query was run through `EXPLAIN (ANALYZE, BUFFERS)` with the exact SQL and parameters the
repository functions emit (captured with a SQLAlchemy `before_cursor_execute` hook), warm
cache, after `VACUUM ANALYZE`.

- **Volume:** 3,000 users; 151 workspaces with 3,300 memberships; 762 projects; 249,000 tasks;
  747,000 comments; 1.49 million activity entries.
- **Shape:** one large workspace with 300 members, 12 projects of 2,000 tasks each and 144,000
  activity entries, plus 150 small workspaces of 20 members and 5 projects of 300 tasks.
- **Measured in the large workspace**, with a member assigned to 61 tasks and a "rare" actor
  who has 3 entries there, all old.

| Query | Plan before | Before | After |
|---|---|---|---|
| Board, `GET /projects/{pid}/tasks`, 2,000 tasks | Bitmap scan `uq_tasks_project_id_number`, in-memory sort (571 kB), comment count per row via `ix_comments_task_id_created_at_id` | 20.1 ms | 19.7 ms |
| Board + `status` + `priority` | Bitmap scan `ix_tasks_project_id_status_position` | 4.9 ms | 4.2 ms |
| Board + `assignee_id` / `none` / `due_before` / `q` | BitmapAnd of the project index with `ix_tasks_assignee_id` / `ix_tasks_due_date`; `q` filters the project's rows | 0.2 to 8.5 ms | 0.3 to 7.0 ms |
| `GET /me/tasks` (+ `status`, `due_before`) | `ix_workspace_members_user_id`, then `ix_tasks_assignee_id` | 1.0 ms | 0.8 ms |
| Comments page | `ix_comments_task_id_created_at_id` range | 0.06 ms | 0.05 ms |
| Activity feed, first page | `ix_activity_logs_workspace_id_created_at_id`, LIMIT 21 | 0.18 ms | 0.12 ms |
| Activity feed, page 100,000 entries deep | Same index; the keyset `ROW(created_at, id) < ROW(...)` is an index condition, so no rows are skipped | 0.18 ms | 0.13 ms |
| Activity `project_id` / `task_id` | `ix_activity_logs_project_id_...` / `ix_activity_logs_task_id_...` | 0.17 / 0.08 ms | 0.10 / 0.05 ms |
| **Activity `actor_id`, busy actor** | Feed index, filters `actor_id`: 8,955 rows read and dropped | **4.9 ms** | **0.07 ms** |
| **Activity `actor_id`, rare actor** | Parallel bitmap scan of all 144,000 workspace entries, then a sort | **28.6 ms** | **0.06 ms** |
| **Activity `actor_id` + `project_id`** | BitmapAnd of both indexes, 12,000 rows filtered | **14.2 ms** | **0.07 ms** |
| Members (300) | `pk_workspace_members` + hash join on users | 1.9 ms | 1.6 ms |
| Projects | `uq_projects_workspace_id_key` | 0.11 ms | 0.10 ms |
| Workspaces of a user | `ix_workspace_members_user_id` | 0.12 ms | 0.12 ms |

**Decisions**

- **Added** `ix_activity_logs_workspace_id_actor_id_created_at_id` on
  `(workspace_id, actor_id, created_at DESC, id DESC)` (migration `49c18dddd806`, 110 MB at
  1.49 million rows, like the other three activity indexes). The actor filter was the only
  query whose cost grew with the workspace's whole history: the feed index could only filter
  by actor, so finding an actor's few entries meant reading every entry. It leads with
  `workspace_id`, because an actor's entries span workspaces and the feed is always scoped to
  one. The plan is now a single index range scan in feed order.
- **No change, task board.** It sorts by a `CASE` on status, which no index can provide, but it
  sorts at most one project's tasks in memory. About half of its 20 ms for 2,000 tasks is the
  per-task comment count, an index range scan that also checks `workspace_id` in the heap.
  That is fine for this size; the next step would be a denormalized counter, not an index.
- **No change, `q` search.** `ILIKE '%...%'` filters the rows of one project (2,000 rows in
  under 5 ms). A trigram index (`pg_trgm`) would pay off only for search across projects.
- **No change, workspace delete cascades.** The foreign keys `tasks.workspace_id` and
  `comments.workspace_id` have no index of their own, so `DELETE /workspaces/{wid}` scans both
  tables once each. With 1,500 tasks deleted, the cascades took 0.36 to 0.66 s in total, of
  which 165 to 310 ms were these two scans. Deleting a workspace is a rare, owner-only action,
  and two more indexes would slow every task and comment insert. Revisit if those tables reach
  tens of millions of rows.
- The foreign keys to `users` (`actor_id`, `author_id`, `created_by`) need no index for
  cascades: users are never deleted.
- Row estimates for the board are low (176 estimated, 2,000 actual), because `workspace_id`
  and `project_id` are correlated. The plans are still right, so no extended statistics were
  added.
