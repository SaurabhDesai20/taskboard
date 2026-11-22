// Import everything from 'react-router' (not 'react-router/dom'): in Vitest the two entry
// points load different builds and <Link> loses the router context.
import { createBrowserRouter, RouterProvider } from 'react-router'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { AppProviders } from './providers'
import { flushSyncForRouter } from './routerFlushSync'
import { routes } from './routes'

const router = createBrowserRouter(routes)

export function App() {
  return (
    // Route errors show the routes' errorElement; this catches anything outside them.
    <ErrorBoundary>
      <AppProviders>
        <RouterProvider router={router} flushSync={flushSyncForRouter} />
      </AppProviders>
    </ErrorBoundary>
  )
}
