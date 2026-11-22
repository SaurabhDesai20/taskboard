import { QueryClientProvider, type QueryClient } from '@tanstack/react-query'
import { useState, type ReactNode } from 'react'
import { createQueryClient } from '../api/queryClient'

interface AppProvidersProps {
  children: ReactNode
  /** Tests pass their own client; the app creates one. */
  queryClient?: QueryClient
}

export function AppProviders({ children, queryClient }: AppProvidersProps) {
  // Keeps one QueryClient instance for the app's lifetime (this is not server data).
  const [client] = useState(() => queryClient ?? createQueryClient())
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}
