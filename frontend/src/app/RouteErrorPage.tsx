import { isRouteErrorResponse, Link, useLocation, useNavigate, useRouteError } from 'react-router'
import { ErrorFallback } from '../components/ErrorFallback'
import { MAIN_CONTENT_ID } from '../lib/focus'
import { useDocumentTitle } from '../lib/useDocumentTitle'

/**
 * The router's `errorElement`: a page that throws while rendering shows this in its place. The
 * header stays (it is outside the failed route). "Try again" re-enters the same URL, which
 * resets the router's error boundary and renders the page again.
 */
export function RouteErrorPage() {
  const error = useRouteError()
  const location = useLocation()
  const navigate = useNavigate()
  useDocumentTitle(isRouteErrorResponse(error) && error.status === 404 ? 'Page not found' : 'Something went wrong')

  if (isRouteErrorResponse(error) && error.status === 404) {
    return (
      <section className="page" aria-labelledby="route-not-found-title">
        <h1 id="route-not-found-title">Page not found</h1>
        <p>
          <Link to="/">Back to the dashboard</Link>
        </p>
      </section>
    )
  }

  const retry = () =>
    void navigate({ pathname: location.pathname, search: location.search, hash: location.hash }, { replace: true })
  return <ErrorFallback onRetry={retry} />
}

/** For the root route, whose layout (header and `<main>`) is what failed. */
export function RootErrorPage() {
  return (
    <main className="app-main" id={MAIN_CONTENT_ID} tabIndex={-1}>
      <RouteErrorPage />
    </main>
  )
}
