# TaskBoard frontend

React 18, Vite and TypeScript (strict), with React Router 7, TanStack Query 5 and dnd-kit.
Tests use Vitest, Testing Library and MSW. Repo-wide rules are in `../CLAUDE.md`, and the API is described in `../docs/api-contract.md`.

## Scripts

Run these from `frontend/`. From the repo root, `.\scripts\frontend.ps1`, `build.ps1`, `test.ps1` and `lint.ps1` wrap them.

| Command | What it does |
|---|---|
| `npm run dev` | Vite on :5173. It proxies `/api` (and `/api/ws`) to FastAPI on :8000. |
| `npm run build` | Type-checks, then builds `dist/` (served by FastAPI in production). |
| `npm test` | Runs Vitest once (jsdom + MSW). `npm run test:watch` re-runs it on change. |
| `npm run lint` / `npm run typecheck` | ESLint / `tsc -b`. |
| `npm run gen:api` | Regenerates `src/api/schema.d.ts` from `../docs/openapi.json`. |

## Environment, mocking and production

- `.env.development` sets `VITE_API_MOCKING`:
  - `false` (default): the browser talks to the real backend through the Vite proxy.
  - `true`: MSW answers `/api` in the browser from seeded in-memory data. Sign in as `asha@example.com` / `correct-horse-battery`. A reload resets the mock session.
- Production builds contain no MSW:
  - The worker is imported only behind `import.meta.env.DEV`.
  - A small Vite plugin removes `public/mockServiceWorker.js` from `dist/`.
- FastAPI serves `dist/` from the same origin, with an SPA fallback:
  - Assets load from `/assets/` (`base: '/'`) and the API from the relative `/api`, so deep links such as `/w/acme/projects/<id>` work on refresh.
  - No development URLs are built in.
- The session lives only in the httpOnly cookie. `localStorage` holds UI preferences only: `taskboard.theme` and `taskboard.projectSidebarOpen`.

## API types and calls

- Types are generated from the backend's OpenAPI document (`npm run gen:api`, `openapi-typescript`) and given readable names in `src/api/types.ts`.
- Every request goes through `src/api/client.ts`, which:
  - sends the cookie and the CSRF header;
  - parses the error envelope into an `ApiError` (`status`, `code`, `details`, and `retryAfter` from `Retry-After`);
  - calls the 401 handler.
- Server state lives only in TanStack Query: the hooks in each feature's `hooks.ts`. UI state stays local.

## Folder structure

```
src/
  app/         router, layout (header, skip link), providers, error pages, cross-feature tests
  api/         client.ts, queryClient.ts, schema.d.ts (generated), types.ts
  components/  shared UI: Modal, ConfirmDialog, Tabs, ToastProvider, Skeleton, EmptyState,
               ErrorState, ErrorBoundary, ThemeToggle, form fields, badges
  features/    auth, dashboard, workspaces, members, projects, tasks, comments, activity
               (each: components, hooks.ts, api.ts, CSS, tests)
  lib/         permissions (mirror of the backend matrix), dates, focus, forms, preferences,
               theme, useDocumentTitle
  mocks/       MSW handlers that implement the contract, and their in-memory db
  test/        setup (MSW server, cleanup), renderRoute(), toast helpers
```

## Testing

- Tests render real routes with `renderRoute({ route })` as a seeded user (`startMockSession(...)`).
  - The MSW Node server must answer every request (`onUnhandledFrame: 'error'`).
  - `server.use(...)` overrides a handler for one test.
  - The mock db and `localStorage` reset after each test.
- Query by role and accessible name, the way assistive technology sees the page.
- Import router APIs from `'react-router'` only (see `CLAUDE.md`).
- Cross-cutting suites:
  - `app/permissionMatrix.test.tsx`: role x action matrix of the visible and enabled controls.
  - `features/tasks/KanbanKeyboard.test.tsx`: moving cards with the keyboard only.
  - `app/focusAndToasts.test.tsx`: focus after deletions, and the toasts.
  - `app/ErrorPages.test.tsx`: error boundaries.

## UI conventions

- **Loading**: skeletons shaped like the content they replace, with a screen reader label (`role="status"`).
- **Empty**: `EmptyState`.
- **Load errors**: `ErrorState`, with "Try again".
- **Crashes**: the routes' `errorElement`, plus a root `ErrorBoundary`, offer "Try again" and "Reload page".
- **Toasts** (`useToast()`):
  - They confirm the main changes, and report failures that have nowhere else to show.
    Examples: a refused board move, or a save that fails after its drawer was closed.
  - Form and dialog errors stay next to their fields.
  - Toasts pause while hovered or focused; Escape or the dismiss button closes one.
- **Theme**: color tokens in `index.css`, with a dark set. The theme follows the system until the header toggle is used.
- **Responsive** down to tablets (768px):
  - The header wraps.
  - The project sidebar collapses, and stacks above the board on narrow screens.
  - The board and wide tables scroll sideways.
  - The drawer goes full width on small screens.

## Accessibility notes

- **Landmarks**: banner, "Main" navigation, `main` (the skip link's target), and the breadcrumb, workspace and project navigations.
- **Headings and titles**: one `h1` per page, headings in order, and every page sets `document.title`.
- **Dialogs and the task drawer** (`Modal`):
  - Labelled and modal, with focus trapped inside; Escape closes them.
  - Focus returns to the opener. If the opener is gone (a deleted row, a role change), focus goes to the nearest section heading or the page's `h1`, never the page body.
- **Kanban**: every drag has a keyboard alternative, each card's Move menu.
  - Moves are announced in a polite live region; a refused move in an assertive toast.
- **Tabs**: follow the WAI-ARIA tabs pattern (arrow keys, Home and End).
- **Forms**:
  - Labels on every field; errors are tied to them with `aria-describedby` and `aria-invalid`.
  - A 429 says how long to wait, from `Retry-After`.
- **Visual cues**:
  - A visible focus ring everywhere, in both themes.
  - Status is never shown by color alone (an "Overdue" label, role and priority text).
  - Animations stop with `prefers-reduced-motion`.
