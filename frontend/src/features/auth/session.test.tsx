// The session lifecycle across the app: route guards, logout and session expiry (401).
import { screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { DEMO_USER, endMockSession, sessionUser, startMockSession } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'
import { workspaceKeys } from '../workspaces/hooks'
import { authKeys } from './hooks'

describe('route guards', () => {
  it('redirects a logged-out visitor from a protected page to /login', async () => {
    const { router } = renderRoute({ route: '/' })

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    expect(router.state.location.state).toEqual({ from: { pathname: '/', search: '', hash: '' } })
    expect(screen.queryByRole('heading', { name: 'Your workspaces' })).not.toBeInTheDocument()
  })

  it('shows a loading state while the session is checked', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('/api/auth/me', async () => {
        await gate
        return HttpResponse.json(
          { error: { code: 'unauthorized', message: 'Authentication required', details: {} } },
          { status: 401 },
        )
      }),
    )
    renderRoute({ route: '/' })

    expect(screen.getByRole('status')).toHaveTextContent('Loading your session...')
    release()
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })

  it('shows an error with a retry when the session check fails for another reason', async () => {
    const user = userEvent.setup()
    startMockSession(DEMO_USER.id)
    server.use(http.get('/api/auth/me', () => HttpResponse.error(), { once: true }))
    renderRoute({ route: '/' })

    expect(await screen.findByRole('alert')).toHaveTextContent('We could not check your session.')
    await user.click(screen.getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { name: 'Your workspaces' })).toBeInTheDocument()
  })
})

describe('logout', () => {
  it('ends the session, clears cached data and returns to /login', async () => {
    const user = userEvent.setup()
    startMockSession(DEMO_USER.id)
    const { router, queryClient } = renderRoute({ route: '/' })

    expect(await screen.findByRole('link', { name: /Acme/ })).toBeInTheDocument()
    expect(queryClient.getQueryData(workspaceKeys.list())).toBeDefined()

    await user.click(screen.getByRole('button', { name: DEMO_USER.name }))
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    // No "return to" target after a deliberate logout.
    expect(router.state.location.state).toBeNull()
    expect(sessionUser()).toBeNull()
    expect(queryClient.getQueryData(workspaceKeys.list())).toBeUndefined()
    expect(queryClient.getQueryData(authKeys.me)).toBeNull()
    expect(screen.queryByRole('button', { name: DEMO_USER.name })).not.toBeInTheDocument()
  })

  it('treats an already expired session as logged out', async () => {
    const user = userEvent.setup()
    startMockSession(DEMO_USER.id)
    const { router } = renderRoute({ route: '/' })

    await user.click(await screen.findByRole('button', { name: DEMO_USER.name }))
    endMockSession() // the cookie expired while the page was open: logout answers 401
    await user.click(screen.getByRole('button', { name: 'Log out' }))

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
  })
})

describe('session expiry (401 from a protected request)', () => {
  it('clears the session and redirects to /login in-app, then returns after login', async () => {
    const user = userEvent.setup()
    startMockSession(DEMO_USER.id)
    // The session expires on the server: the next protected request answers 401.
    server.use(
      http.get('/api/workspaces', () => {
        endMockSession()
        return HttpResponse.json(
          { error: { code: 'unauthorized', message: 'Authentication required', details: {} } },
          { status: 401 },
        )
      }),
    )
    const { router, queryClient } = renderRoute({ route: '/' })

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')
    // The memory router moved, so this was an in-app navigation, not window.location.assign().
    expect(queryClient.getQueryData(authKeys.me)).toBeNull()
    expect(router.state.location.state).toEqual({ from: { pathname: '/', search: '', hash: '' } })

    server.resetHandlers()
    await user.type(screen.getByLabelText('Email'), DEMO_USER.email)
    await user.type(screen.getByLabelText('Password'), DEMO_USER.password)
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('link', { name: /Acme/ })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
