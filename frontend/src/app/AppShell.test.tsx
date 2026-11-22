import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_USER, startMockSession } from '../mocks/db'
import { renderRoute } from '../test/render'

describe('app shell (signed in)', () => {
  beforeEach(() => startMockSession(DEMO_USER.id))

  it('renders the header (brand, workspace switcher, user menu) and the home page', async () => {
    renderRoute({ route: '/' })

    expect(screen.getByRole('link', { name: 'TaskBoard' })).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Your workspaces' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Workspaces' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: DEMO_USER.name })).toBeInTheDocument()
  })

  it('shows a not-found page for unknown routes', async () => {
    renderRoute({ route: '/does-not-exist' })

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to home' })).toBeInTheDocument()
  })

  it('has a keyboard-operable user menu with the user name and a Log out button', async () => {
    const user = userEvent.setup()
    renderRoute({ route: '/' })

    const toggle = await screen.findByRole('button', { name: DEMO_USER.name })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()

    // Tab to the toggle and open it with the keyboard.
    toggle.focus()
    await user.keyboard('{Enter}')
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const panel = document.getElementById(toggle.getAttribute('aria-controls') ?? '')
    expect(panel).not.toBeNull()
    expect(within(panel as HTMLElement).getByText(DEMO_USER.email)).toBeInTheDocument()

    await user.tab()
    expect(screen.getByRole('button', { name: 'Log out' })).toHaveFocus()

    // Escape closes the menu and returns focus to the toggle.
    await user.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
    expect(screen.queryByRole('button', { name: 'Log out' })).not.toBeInTheDocument()
  })
})
