# TaskBoard: rules for every session

- `PLAN.md` is the source of truth for scope, phases, the domain model and the permission matrix. Read it fully before starting a phase.
- `docs/api-contract.md` is the contract between the agents. Read it before you touch an endpoint, a request/response shape, an MSW handler or an API type.

## Environment: Windows, PowerShell scripts instead of make

Wherever PLAN.md says `make <target>`, run `.\scripts\<target>.ps1` from the repo root:

| PLAN.md | Here | What it does |
|---|---|---|
| (first run) | `.\scripts\setup.ps1` | Creates `.env` from `.env.example`, `uv sync`, `npm install` |
| `make db` | `.\scripts\db.ps1` | `docker compose up -d --wait` (Postgres only) |
| `make migrate` | `.\scripts\migrate.ps1` | `alembic upgrade head` |
| `make backend` | `.\scripts\backend.ps1` | uvicorn with reload on :8000 |
| `make frontend` | `.\scripts\frontend.ps1` | Vite on :5173, proxies `/api` and `/api/ws` to :8000 |
| `make test` | `.\scripts\test.ps1` | pytest + vitest (backend tests need `db.ps1` running) |
| (extra) | `.\scripts\lint.ps1` | ruff check, ruff format --check, mypy, eslint, tsc |
| `make build` | `.\scripts\build.ps1` | Builds `frontend/dist` |
| `make start` | `.\scripts\start.ps1` | Single uvicorn process on :8000 (serves `frontend/dist` from Phase 7) |
| `make openapi` | `.\scripts\openapi.ps1` | Writes `docs/openapi.json` |

Machine facts the config files will not tell you:

- **Postgres is on host port 35432.** 5432 belongs to a native Postgres install on this machine.
- The compose project is named `taskboard`, so every git worktree shares one container and volume.
- Each worktree needs its own `.env`: run `setup.ps1` in it.
- **Python runs through uv**: Python 3.12 in `backend/.venv`. From `backend/`, run tools as `uv run <tool>`. Add dependencies with `uv add <pkg>` (or `uv add --dev <pkg>`), which updates `uv.lock`.
- Scripts stay **ASCII-only and Windows PowerShell 5.1 compatible**: chain with `;` and `if ($?)`, never `&&`, `||`, `?:` or `??`.
- Line endings are LF for every file (`.gitattributes`).
- The human runs migrations against the dev database (`migrate.ps1`). Agents write migration files and run the test suite, which migrates its own `taskboard_test` database.

## Git

- Work on the current branch only. Never switch, create, rename or delete branches.
- Run `git push`, `git merge` or `git rebase` only when the human explicitly asks.
- Commit only when the human asks. Propose small commits with conventional messages (`feat(backend): ...`, `feat(ui): ...`, `test(...)`, `fix(...)`), one per logical unit, and give the exact commands.
- A new library needs a one-line justification in the commit message.

## Architecture rules

### Backend (`backend/app`)

1. **Layering is strict:** `router -> service -> repository -> model`.
   - Routers parse HTTP and call one service function.
   - Services own business rules, permission checks, transactions and activity logging.
   - Repositories contain queries only.
   - Routers never touch the session directly.
2. **One transaction per request.** The service commits once at the end. The activity log row is written in the **same transaction** as the change it describes.
3. **Permissions live in one place:** `api/deps.py::require_role(min_role)` plus `services/permissions.py` (a pure function `can(role, action) -> bool`). Every role check goes through `can()`.
4. **Tenant isolation:** every query for workspace-scoped data filters by `workspace_id`. Resolve project/task -> workspace first, then check membership. Return **404** (not 403) when the user is not a member, so existence isn't leaked.
5. **Errors:** services raise the domain exceptions in `app/core/errors.py`: `NotFound`, `Forbidden`, `Conflict`, `ValidationFailed` (use `ValidationFailed.for_field(...)` for field errors), `Unauthorized`. The registered handlers turn them, and every framework error, into the contract's envelope.
6. **Schemas:** separate `Create`, `Update` and `Read` Pydantic models. Responses use Read schemas only, never ORM models or password hashes.
7. **Config** via `pydantic-settings` (`app/core/config.py`) reading the repo-root `.env`. Secrets come from `.env` only.
8. Type hints everywhere; `ruff` and `mypy --strict` clean.

### Frontend (`frontend/src`)

1. **Feature folders.** Each feature in `features/<name>/` owns its components, hooks and types. Shared pieces go in `components/` or `lib/`.
2. **Server state = TanStack Query only.** UI state stays local or in small contexts.
3. **All HTTP goes through `api/client.ts`.** It adds `credentials: 'include'` and the CSRF header, parses the error envelope into `ApiError`, and calls the 401 handler (pass `skipAuthRedirect: true` for `GET /auth/me`).
4. **Types come from the contract.** Generate `src/api/schema.d.ts` from `docs/openapi.json` (`openapi-typescript`) once the backend publishes it. Until then, hand-write types in `src/api/` strictly matching `docs/api-contract.md`.
5. **Permission-aware UI:** `lib/permissions.ts` mirrors the backend matrix to hide or disable actions. The backend remains the authority.
6. Every data view handles **loading, empty and error** states.
7. Accessibility basics: semantic elements, labels, keyboard-operable modals, and a drag-and-drop fallback.

## Ownership (PLAN.md section 8)

| Path | Owner |
|---|---|
| `backend/**` | Backend Agent only |
| `frontend/**` | UI Agent only |
| `docs/api-contract.md`, `docs/openapi.json` | Backend Agent edits; the UI Agent proposes changes in `docs/CONTRACT_CHANGES.md` |
| `docs/CONTRACT_CHANGES.md`, `docs/BLOCKERS.md` | Either agent appends |
| `.env.example` | Backend Agent may add keys |
| `PLAN.md`, `CLAUDE.md`, `docker-compose.yml`, `scripts/**`, `.gitattributes`, `.gitignore` | Neither, unless the human approves |

Protocol:

- **The contract is law.** The UI builds against it with MSW mocks, so it never waits for the backend. The backend implements it exactly.
- **Contract changes** go in `docs/CONTRACT_CHANGES.md` (what, why, affected endpoints). Keep building against the current contract until the human or the Backend Agent applies the change at the next Sync Point.
- **Blocked by the other agent:** mock it, note the dependency in `docs/BLOCKERS.md`, and stay inside your own directory.
- **End of each phase:**
  - The Backend Agent runs `openapi.ps1`.
  - The UI Agent regenerates its types and fixes any mismatch with its mocks.
  - At each Sync Point, both agents stop and wait for the human.
- **Definition of done per phase:**
  - Code complete.
  - Tests written and passing (`test.ps1`).
  - `lint.ps1` clean.
  - No unexplained TODOs.
  - Contract matches reality.

## Never do (each with what to do instead)

- **Docker:** `docker-compose.yml` with the single Postgres service is the only Docker file. Never add a Dockerfile, `.dockerignore` or another compose file; the app runs on the host with uvicorn and Vite.
- **Schema changes:** never call `Base.metadata.create_all()`. Change the schema through Alembic migrations only. Even the tests build their database with `alembic upgrade head`.
- **Business logic:** keep it out of routers and React components. It lives in backend services and in frontend hooks or `lib/`.
- **Server data:** never copy it into `useState`, context or any other store. Read it through TanStack Query.
- **JWT:** never store it in `localStorage` or `sessionStorage`. It lives only in the httpOnly cookie.
- **SQL:** never build it by concatenating strings. Use SQLAlchemy constructs and bound parameters, scoped by `workspace_id`.
- **Contract:** never invent endpoints or fields. Implement only what `docs/api-contract.md` defines; propose additions in `CONTRACT_CHANGES.md`.
- **Commits and tests:** never make large do-everything commits or skip tests to go faster. Every change ships with its tests, in small commits.

## Testing notes

### Backend

- `tests/conftest.py` (with helpers in `tests/database.py`):
  - Points the app at `TEST_DATABASE_URL`, whose name must end with `_test`.
  - Creates that database if missing, wipes its `public` schema, and runs `alembic upgrade head` once per session.
  - Wraps each test in a rolled-back transaction, so service code may call `commit()`.
- Use the `client`, `app` and `db_session` fixtures. Tests mirror the `app/` layout; put factories in `tests/factories.py`.
- `tests/db/test_migrations.py` fails when models and migrations differ or when Alembic has more than one head.
- **After changing a model**, do all of these in order:
  1. Import its module in `app/models/__init__.py` (autogenerate only sees imported models).
  2. Run `uv run alembic revision --autogenerate -m "<change>"`.
  3. Review the generated file.
  4. Run the tests.
- Starlette 1.x's TestClient needs `httpx2`, which is already a dev dependency.

### Frontend

- `src/test/setup.ts` runs the MSW Node server with `onUnhandledFrame: 'error'`, so every request a test makes needs a handler.
  - MSW 3 renamed MSW 2's `onUnhandledRequest` to `onUnhandledFrame`.
  - Override handlers per test with `server.use(...)`.
- Render routed UI with `renderRoute()` from `src/test/render.tsx`.
- **Import router APIs from `'react-router'` only.** In Vitest, `'react-router/dom'` loads a second build, and `<Link>` then fails with "Cannot destructure property 'basename'".
- **Pinned versions:**

  | Package | Version | Why |
  |---|---|---|
  | React | 18 | Required by PLAN.md |
  | React Router | 7 | v8 requires React 19 |
  | TypeScript | ~6.0 | typescript-eslint does not support TS 7 yet |

- **Browser mocking:** `VITE_API_MOCKING` in `frontend/.env.development` turns MSW on (`true`). Unhandled requests pass through the Vite proxy to the real backend. Set it to `false` at the Phase 1 Sync Point.
