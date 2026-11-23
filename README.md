# TaskBoard

A multi-user mini project management tool (workspaces, roles, projects, a Kanban board, comments and an activity feed): **React (Vite + TypeScript) + FastAPI + PostgreSQL**, run as a single monolith. Docker is used only for the Postgres container.

- Build plan: `PLAN.md`. API contract: `docs/api-contract.md`. Build log: `docs/PROGRESS.md`.
- Backend details (env keys, seed data, rate limits, logging, security headers, index review): [`backend/README.md`](backend/README.md)
- Frontend details (scripts, mocking, type generation, structure, testing, accessibility): [`frontend/README.md`](frontend/README.md)

## Prerequisites (Windows)

- Docker Desktop (running)
- [uv](https://docs.astral.sh/uv/) (installs Python 3.12 for the backend if needed)
- Node.js 22+ and npm

## Quick start (PowerShell, from the repo root)

```powershell
.\scripts\setup.ps1      # .env (with a random JWT secret), backend + frontend dependencies
.\scripts\db.ps1         # Postgres in Docker on 127.0.0.1:35432
.\scripts\migrate.ps1    # alembic upgrade head
.\scripts\seed.ps1       # optional demo data: workspace "acme", one user per role
.\scripts\build.ps1      # build the UI into frontend/dist
.\scripts\start.ps1      # one process on http://localhost:8000 serves the UI and /api
```

Demo logins (after `seed.ps1`) all use the password `taskboard-demo`: `asha@acme.example.com` (owner), `devon@acme.example.com` (admin), `ben@acme.example.com` (member), `chen@acme.example.com` (viewer). The full list is in `backend/README.md`.

### Development mode (hot reload)

Instead of `build.ps1` + `start.ps1`, run these in two terminals:

```powershell
.\scripts\backend.ps1    # API with auto-reload on http://127.0.0.1:8000 (docs: /api/docs)
.\scripts\frontend.ps1   # UI on http://localhost:5173, proxying /api to :8000
```

## Other scripts

| Script | Purpose |
|---|---|
| `test.ps1` | Backend (pytest) and frontend (vitest) tests. Postgres must be running; tests use their own `taskboard_test` database. |
| `lint.ps1` | ruff, mypy, eslint, tsc |
| `openapi.ps1` | Writes `docs/openapi.json`; then `npm run gen:api` in `frontend/` regenerates the UI types |

If PowerShell refuses to run scripts, allow local scripts once for your user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```
