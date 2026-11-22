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
