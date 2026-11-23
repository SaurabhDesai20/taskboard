import { QueryClient } from '@tanstack/react-query'
import { ApiError } from './client'

const MAX_RETRIES = 2

function shouldRetry(failureCount: number, error: unknown): boolean {
  // A 4xx answer will not change on retry.
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) {
    return false
  }
  return failureCount < MAX_RETRIES
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 30_000, retry: shouldRetry },
      mutations: { retry: false },
    },
  })
}
