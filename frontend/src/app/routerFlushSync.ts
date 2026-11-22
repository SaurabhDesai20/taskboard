import { flushSync } from 'react-dom'

/**
 * ReactDOM.flushSync for <RouterProvider flushSync>. 'react-router/dom' would pass it for us, but
 * we import from 'react-router' only (see App.tsx). It enables `navigate(to, { flushSync: true })`,
 * which logout uses to leave the protected pages before any query observer re-renders.
 */
export function flushSyncForRouter(fn: () => unknown): undefined {
  flushSync(fn)
  return undefined
}
