// MSW handlers implementing docs/api-contract.md, so the UI runs without the backend.
// Shared by the browser worker (dev, VITE_API_MOCKING=true) and the Node server (Vitest).
import { http, HttpResponse } from 'msw'
import type { HealthResponse } from '../api/types'

export const handlers = [
  http.get('/api/health', () => HttpResponse.json<HealthResponse>({ status: 'ok', database: 'ok' })),
]
