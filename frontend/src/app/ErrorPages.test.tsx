import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { isValidElement } from 'react'
import type { RouteObject } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ErrorBoundary } from '../components/ErrorBoundary'
import { RequireAuth } from '../features/auth/RouteGuards'
import { DEMO_USER, startMockSession } from '../mocks/db'
import { renderRoute } from '../test/render'
import { routes } from './routes'

/** Throws while `failing.current` is true. */
const failing = { current: true }

function Unstable() {
  if (failing.current) throw new Error('Kaboom')
  return <p>Back to normal</p>
}

/** The app's routes with `/boom` (a crashing page) among the signed-in pages. */
function routesWithCrashingPage(): RouteObject[] {
  const [root] = routes
  const children = root.children?.map((child): RouteObject => {
    if (child.index || !isValidElement(child.element) || child.element.type !== RequireAuth) return child
    return { ...child, children: [...(child.children ?? []), { path: 'boom', element: <Unstable /> }] }
  })
  return [{ ...root, children } as RouteObject]
}

/** React (in development) rethrows caught render errors to `window`; jsdom would print them. */
const swallowReportedError = (event: ErrorEvent) => event.preventDefault()

describe('error pages', () => {
  beforeEach(() => {
    failing.current = true
    // React reports caught render errors on the console; they are expected here.
    vi.spyOn(console, 'error').mockImplementation(() => {})
    window.addEventListener('error', swallowReportedError)
  })
  afterEach(() => {
    window.removeEventListener('error', swallowReportedError)
    vi.restoreAllMocks()
  })

  it('a page that crashes shows a friendly error inside the layout, and "Try again" renders it again', async () => {
    const user = userEvent.setup()
    startMockSession(DEMO_USER.id)
    renderRoute({ route: '/boom', routes: routesWithCrashingPage() })

    const heading = await screen.findByRole('heading', { level: 1, name: 'Something went wrong' })
    expect(heading).toHaveFocus()
    expect(document.title).toBe('Something went wrong · TaskBoard')
    // The header is outside the failed route: still there to get away.
    expect(screen.getByRole('banner')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'TaskBoard' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to the dashboard' })).toHaveAttribute('href', '/')

    failing.current = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByText('Back to normal')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Something went wrong' })).not.toBeInTheDocument()
  })

  it('every route level has an error page', () => {
    const [root] = routes
    expect(root.errorElement).toBeTruthy()
    for (const child of root.children ?? []) expect(child.errorElement).toBeTruthy()
  })

  it('the root error boundary catches what the router does not, with a retry', async () => {
    const user = userEvent.setup()
    render(
      <ErrorBoundary>
        <Unstable />
      </ErrorBoundary>,
    )

    expect(screen.getByRole('main')).toContainElement(screen.getByRole('heading', { name: 'Something went wrong' }))
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeInTheDocument()

    failing.current = false
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(screen.getByText('Back to normal')).toBeInTheDocument()
  })
})
