// MSW handlers implementing docs/api-contract.md, so the UI runs without the backend.
// Shared by the browser worker (dev, VITE_API_MOCKING=true) and the Node server (Vitest).
// One file per feature in ./handlers/; in-memory data in ./db.ts.
import { resetMockDb } from './db'
import { authHandlers } from './handlers/auth'
import { healthHandlers } from './handlers/health'
import { memberHandlers } from './handlers/members'
import { projectHandlers } from './handlers/projects'
import { taskHandlers } from './handlers/tasks'
import { workspaceHandlers } from './handlers/workspaces'
import { csrfGuard } from './http'

export const handlers = [
  // First, like the backend middleware: rejects mutating requests without the CSRF header.
  csrfGuard,
  ...healthHandlers,
  ...authHandlers,
  ...workspaceHandlers,
  ...memberHandlers,
  ...projectHandlers,
  ...taskHandlers,
]

/** Back to the seeded data and no session. Tests call it after each test (src/test/setup.ts). */
export function resetMockState(): void {
  resetMockDb()
}
