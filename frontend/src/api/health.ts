import { useQuery } from '@tanstack/react-query'
import { api } from './client'
import type { HealthResponse } from './types'

export const healthKeys = {
  all: ['health'] as const,
}

export function useHealth() {
  return useQuery({
    queryKey: healthKeys.all,
    queryFn: ({ signal }) => api.get<HealthResponse>('/health', { signal }),
  })
}
