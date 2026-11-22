# TaskBoard

A multi-user mini project management tool: **React (Vite + TypeScript) + FastAPI + PostgreSQL**, run as a single monolith. See `PLAN.md` for the full build plan and `docs/api-contract.md` for the API.

## Prerequisites (Windows)

- Docker Desktop (running)
- [uv](https://docs.astral.sh/uv/) (it installs Python 3.12 for the backend if needed)
- Node.js 22+ and npm

## Quick start (PowerShell, from the repo root)

```powershell
.\scripts\setup.ps1      # .env from .env.example, backend + frontend dependencies
.\scripts\db.ps1         # Postgres in Docker on 127.0.0.1:35432
.\scripts\migrate.ps1    # alembic upgrade head
.\scripts\backend.ps1    # API on http://127.0.0.1:8000  (docs: /api/docs)
.\scripts\frontend.ps1   # UI on http://localhost:5173   (in a second terminal)
```

Other scripts:

| Script | Purpose |
|---|---|
| `test.ps1` | Backend (pytest) and frontend (vitest) tests. Postgres must be running. |
| `lint.ps1` | ruff, mypy, eslint, tsc |
| `build.ps1` | Builds the frontend into `frontend/dist` |
| `start.ps1` | Runs the app as one process on :8000 |
| `openapi.ps1` | Writes `docs/openapi.json` |

If PowerShell refuses to run scripts, allow local scripts once for your user:

```powershell
Set-ExecutionPolicy -Scope CurrentUser RemoteSigned
```
