import { QueryClient } from '@tanstack/react-query'
import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider, type RouteObject } from 'react-router'
import { AppProviders } from '../app/providers'
import { flushSyncForRouter } from '../app/routerFlushSync'
import { routes as appRoutes } from '../app/routes'

export function createTestQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
}

interface RenderRouteOptions {
  route?: string
  routes?: RouteObject[]
  queryClient?: QueryClient
}

/** Render the app's routes at `route` with fresh providers (memory router, no retries). */
export function renderRoute({
  route = '/',
  routes = appRoutes,
  queryClient = createTestQueryClient(),
}: RenderRouteOptions = {}) {
  const router = createMemoryRouter(routes, { initialEntries: [route] })
  const result = render(
    <AppProviders queryClient={queryClient}>
      <RouterProvider router={router} flushSync={flushSyncForRouter} />
    </AppProviders>,
  )
  return { ...result, router, queryClient }
}
