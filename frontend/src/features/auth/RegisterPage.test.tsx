import { screen } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { DEMO_USER, findUserByEmail } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'

async function fillRegister(
  user: UserEvent,
  { name, email, password }: { name: string; email: string; password: string },
) {
  if (name) await user.type(await screen.findByLabelText('Name'), name)
  if (email) await user.type(screen.getByLabelText('Email'), email)
  if (password) await user.type(screen.getByLabelText('Password'), password)
}

const submit = (user: UserEvent) => user.click(screen.getByRole('button', { name: 'Create account' }))

describe('RegisterPage', () => {
  it('creates the account, signs in and opens home', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute({ route: '/register' })

    expect(await screen.findByRole('heading', { name: 'Create an account' })).toBeInTheDocument()
    await fillRegister(user, {
      name: '  Nia Patel ',
      email: 'Nia@Example.com',
      password: 'correct-horse-battery',
    })
    await submit(user)

    expect(await screen.findByRole('heading', { name: 'Your workspaces' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    // Name trimmed before sending; email stored lowercase by the server.
    expect(screen.getByRole('button', { name: 'Nia Patel' })).toBeInTheDocument()
    expect(findUserByEmail('nia@example.com')?.name).toBe('Nia Patel')
  })

  it('shows validation errors for every invalid field and sends nothing', async () => {
    const user = userEvent.setup()
    let requests = 0
    server.use(
      http.post('/api/auth/register', () => {
        requests += 1
        return HttpResponse.json(null, { status: 500 })
      }),
    )
    renderRoute({ route: '/register' })

    await fillRegister(user, { name: '   ', email: 'ben@', password: 'short' })
    await submit(user)

    const name = screen.getByLabelText('Name')
    expect(name).toHaveAccessibleDescription('Enter your name')
    expect(name).toHaveFocus()
    expect(screen.getByLabelText('Email')).toHaveAccessibleDescription('Enter a valid email address')
    expect(screen.getByText('Password must be at least 8 characters')).toBeInTheDocument()
    expect(screen.getByLabelText('Password')).toHaveAttribute('aria-invalid', 'true')
    expect(requests).toBe(0)
  })

  it('enforces the maximum lengths from the contract', async () => {
    const user = userEvent.setup()
    renderRoute({ route: '/register' })

    await user.click(await screen.findByLabelText('Name'))
    await user.paste('n'.repeat(101))
    await user.click(screen.getByLabelText('Email'))
    await user.paste('nia@example.com')
    await user.click(screen.getByLabelText('Password'))
    await user.paste('p'.repeat(129))
    await submit(user)

    expect(screen.getByText('Name must be at most 100 characters')).toBeInTheDocument()
    expect(screen.getByText('Password must be at most 128 characters')).toBeInTheDocument()
  })

  it('shows the duplicate email error on the email field', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute({ route: '/register' })

    await fillRegister(user, {
      name: 'Another Asha',
      email: DEMO_USER.email.toUpperCase(),
      password: 'correct-horse-battery',
    })
    await submit(user)

    const email = screen.getByLabelText('Email')
    expect(await screen.findByText('An account with this email already exists')).toBeInTheDocument()
    expect(email).toHaveAccessibleDescription('An account with this email already exists')
    expect(email).toHaveAttribute('aria-invalid', 'true')
    expect(router.state.location.pathname).toBe('/register')
  })

  it('maps server 422 errors to fields and shows unknown ones above the form', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/auth/register', () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_error',
              message: 'Request validation failed',
              details: {
                errors: [
                  { field: 'password', location: 'body', message: 'Password is too common' },
                  { field: '', location: 'body', message: 'Something else is off' },
                ],
              },
            },
          },
          { status: 422 },
        ),
      ),
    )
    renderRoute({ route: '/register' })

    await fillRegister(user, {
      name: 'Nia',
      email: 'nia@example.com',
      password: 'password1',
    })
    await submit(user)

    expect(await screen.findByRole('alert')).toHaveTextContent('Something else is off')
    expect(screen.getByLabelText('Password')).toHaveAccessibleDescription(
      '8 to 128 characters. Password is too common',
    )
  })

  it('links back to the login page', async () => {
    const user = userEvent.setup()
    renderRoute({ route: '/register' })

    await user.click(await screen.findByRole('link', { name: 'Log in' }))

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
  })
})
