import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it } from 'vitest'
import { DEMO_USER, endMockSession, MOCK_PROJECTS, startMockSession } from '../mocks/db'
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

describe('app shell: landmarks, skip link, theme and page titles', () => {
  beforeEach(() => startMockSession(DEMO_USER.id))

  it('has a banner, a main navigation and one main landmark', async () => {
    renderRoute({ route: '/' })
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' })

    expect(screen.getByRole('banner')).toBeInTheDocument()
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(within(nav).getByRole('link', { name: 'My tasks' })).toBeInTheDocument()
    expect(screen.getAllByRole('main')).toHaveLength(1)
  })

  it('"Skip to main content" is the first stop and moves focus to the main landmark', async () => {
    const user = userEvent.setup()
    const { router } = renderRoute({ route: '/' })
    await screen.findByRole('heading', { level: 1, name: 'Dashboard' })

    await user.tab()
    const skip = screen.getByRole('link', { name: 'Skip to main content' })
    expect(skip).toHaveFocus()
    await user.keyboard('{Enter}')

    expect(screen.getByRole('main')).toHaveFocus()
    // The URL does not change (no #hash route).
    expect(router.state.location.hash).toBe('')
  })

  it('toggles the dark theme and remembers the choice (a UI preference, not auth data)', async () => {
    const user = userEvent.setup()
    renderRoute({ route: '/' })
    const toggle = await screen.findByRole('button', { name: 'Dark theme' })
    expect(toggle).toHaveAttribute('aria-pressed', 'false')

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-pressed', 'true')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(window.localStorage.getItem('taskboard.theme')).toBe('dark')
    // Nothing but UI preferences in storage.
    expect(Object.keys(window.localStorage).every((key) => key.startsWith('taskboard.'))).toBe(true)

    cleanup()
    renderRoute({ route: '/' })
    expect(await screen.findByRole('button', { name: 'Dark theme' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(screen.getByRole('button', { name: 'Dark theme' }))
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(window.localStorage.getItem('taskboard.theme')).toBe('light')
  })

  it('offers the theme toggle before signing in too', async () => {
    endMockSession()
    renderRoute({ route: '/login' })

    expect(await screen.findByRole('heading', { name: 'Log in' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Dark theme' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'Main' })).not.toBeInTheDocument()
  })

  it.each([
    ['/', 'Dashboard · TaskBoard'],
    ['/me/tasks', 'My tasks · TaskBoard'],
    ['/w/acme', 'Acme · TaskBoard'],
    ['/w/acme/activity', 'Activity · Acme · TaskBoard'],
    ['/w/acme/settings', 'Settings · Acme · TaskBoard'],
    [`/w/acme/projects/${MOCK_PROJECTS.website.id}`, 'Website · Acme · TaskBoard'],
    ['/w/nope', 'Workspace not found · TaskBoard'],
    ['/nowhere', 'Page not found · TaskBoard'],
  ])('titles %s as "%s"', async (route, title) => {
    renderRoute({ route })

    await waitFor(() => expect(document.title).toBe(title))
  })
})
