// Contract section 3.1 (Health).
import { http, HttpResponse } from 'msw'
import type { HealthResponse } from '../../api/types'
import { API } from '../http'

export const healthHandlers = [
  http.get(`${API}/health`, () => HttpResponse.json<HealthResponse>({ status: 'ok', database: 'ok' })),
]
