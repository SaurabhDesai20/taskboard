import { screen } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { User } from '../../api/types'
import { DEMO_USER, startMockSession, toUser } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'

async function fillLogin(user: UserEvent, email: string, password: string) {
  await user.type(await screen.findByLabelText('Email'), email)
  await user.type(screen.getByLabelText('Password'), password)
}

describe('LoginPage', () => {
  it('signs in and opens the protected home page', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute({ route: '/login' })

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    await fillLogin(user, DEMO_USER.email, DEMO_USER.password)
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('heading', { name: 'Welcome to TaskBoard' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(screen.getByRole('button', { name: DEMO_USER.name })).toBeInTheDocument()
  })

  it('returns to the page the user asked for before logging in', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute({ route: '/projects/web?tab=board' })

    // Logged out: the guard sends us to /login first.
    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/login')

    await fillLogin(user, DEMO_USER.email, DEMO_USER.password)
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/projects/web')
    expect(router.state.location.search).toBe('?tab=board')
  })

  it('shows "Invalid email or password" for a wrong password', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute({ route: '/login' })

    await fillLogin(user, DEMO_USER.email, 'not-the-password')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('Invalid email or password')
    expect(router.state.location.pathname).toBe('/login')
    expect(screen.getByRole('button', { name: 'Log in' })).toBeEnabled()
  })

  it('validates the fields before sending anything', async () => {
    const user = userEvent.setup()
    let requests = 0
    server.use(
      http.post('/api/auth/login', () => {
        requests += 1
        return HttpResponse.json(null, { status: 500 })
      }),
    )
    renderRoute({ route: '/login' })

    await user.click(await screen.findByRole('button', { name: 'Log in' }))

    const email = screen.getByLabelText('Email')
    expect(email).toHaveAccessibleDescription('Enter your email address')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(email).toHaveFocus()
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription('Enter your password')

    await user.type(email, 'not-an-email')
    expect(email).toHaveAccessibleDescription('Enter a valid email address')
    expect(requests).toBe(0)
  })

  it('maps 422 details.errors to the matching fields', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/login', () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_error',
              message: 'Request validation failed',
              details: {
                errors: [
                  {
                    field: 'email',
                    location: 'body',
                    message: 'value is not a valid email address',
                  },
                ],
              },
            },
          },
          { status: 422 },
        ),
      ),
    )
    renderRoute({ route: '/login' })

    await fillLogin(user, 'asha@example.invalid', 'whatever-password')
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByText('value is not a valid email address')).toBeInTheDocument()
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription(
      'value is not a valid email address',
    )
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it('disables the submit button while the request is pending', async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.post('/api/auth/login', async () => {
        await gate
        startMockSession(DEMO_USER.id)
        return HttpResponse.json<User>(toUser(DEMO_USER))
      }),
    )
    renderRoute({ route: '/login' })

    await fillLogin(user, DEMO_USER.email, DEMO_USER.password)
    await user.click(screen.getByRole('button', { name: 'Log in' }))

    expect(await screen.findByRole('button', { name: 'Logging in...' })).toBeDisabled()
    release()
    expect(await screen.findByRole('heading', { name: 'Welcome to TaskBoard' })).toBeInTheDocument()
  })

  it('links to the register page', async () => {
    const user = userEvent.setup()
    renderRoute({ route: '/login' })

    await user.click(await screen.findByRole('link', { name: 'Create an account' }))

    expect(await screen.findByRole('heading', { name: 'Create an account' })).toBeInTheDocument()
  })

  it('sends a signed-in user from /login to home', async () => {
    startMockSession(DEMO_USER.id)
    const { router } = renderRoute({ route: '/login' })

    expect(await screen.findByRole('heading', { name: 'Welcome to TaskBoard' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
