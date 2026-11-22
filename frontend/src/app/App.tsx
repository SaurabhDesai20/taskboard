// Import everything from 'react-router' (not 'react-router/dom'): in Vitest the two entry
// points load different builds and <Link> loses the router context.
import { createBrowserRouter, RouterProvider } from 'react-router'
import { AppProviders } from './providers'
import { flushSyncForRouter } from './routerFlushSync'
import { routes } from './routes'

const router = createBrowserRouter(routes)

export function App() {
  return (
    <AppProviders>
      <RouterProvider router={router} flushSync={flushSyncForRouter} />
    </AppProviders>
  )
}
