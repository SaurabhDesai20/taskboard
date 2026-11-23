import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { db, findWorkspaceBySlug, MOCK_USERS, startMockSession } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'

function renderAsAsha(route = '/') {
  startMockSession(MOCK_USERS.asha.id)
  return renderRoute({ route })
}

/** The switcher's disclosure panel (the toggle's aria-controls target). */
function panelOf(toggle: HTMLElement): HTMLElement {
  return document.getElementById(toggle.getAttribute('aria-controls') ?? '') as HTMLElement
}

async function openSwitcher(name: string | RegExp = 'Workspaces') {
  const user = userEvent.setup()
  const toggle = await screen.findByRole('button', { name })
  await user.click(toggle)
  return { user, toggle, panel: panelOf(toggle) }
}

describe('workspace switcher', () => {
  it('lists my workspaces with my role and links to each one', async () => {
    const { router } = renderAsAsha()
    const { user, toggle } = await openSwitcher()

    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const list = await screen.findByRole('list', { name: 'Your workspaces' })
    const items = within(list).getAllByRole('link')
    expect(items.map((item) => item.textContent)).toEqual(['AcmeOwner', 'GlobexMember'])

    await user.click(within(list).getByRole('link', { name: /Globex/ }))

    expect(router.state.location.pathname).toBe('/w/globex')
    expect(await screen.findByRole('heading', { level: 1, name: 'Globex' })).toBeInTheDocument()
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(screen.getByRole('button', { name: 'Current workspace: Globex' })).toBe(toggle)
  })

  it('marks the current workspace in the list', async () => {
    renderAsAsha('/w/acme/settings')
    await openSwitcher('Current workspace: Acme')

    const list = await screen.findByRole('list', { name: 'Your workspaces' })
    expect(within(list).getByRole('link', { name: /Acme/ })).toHaveAttribute('aria-current', 'true')
    expect(within(list).getByRole('link', { name: /Globex/ })).not.toHaveAttribute('aria-current')
  })

  it('closes on Escape and returns focus to the toggle', async () => {
    renderAsAsha()
    const { user, toggle, panel } = await openSwitcher()
    await screen.findByRole('list', { name: 'Your workspaces' })

    await user.tab()
    expect(within(panel).getByRole('link', { name: /Acme/ })).toHaveFocus()
    await user.keyboard('{Escape}')

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  it('shows an empty message for a user without workspaces', async () => {
    startMockSession(MOCK_USERS.eve.id)
    renderRoute({ route: '/' })
    const { panel } = await openSwitcher()

    expect(await within(panel).findByText('You are not in any workspace yet.')).toBeInTheDocument()
    expect(within(panel).getByRole('button', { name: 'Create workspace' })).toBeInTheDocument()
  })

  it('shows an error with a retry when the list cannot be loaded', async () => {
    server.use(
      http.get(
        '/api/workspaces',
        () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom', details: {} } }, { status: 500 }),
        { once: true },
      ),
    )
    renderAsAsha()
    const { user, panel } = await openSwitcher()

    expect(await within(panel).findByText('Could not load your workspaces.')).toBeInTheDocument()
    await user.click(within(panel).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('list', { name: 'Your workspaces' })).toBeInTheDocument()
  })
})

describe('create workspace modal (from the switcher)', () => {
  async function openCreateModal() {
    const result = renderAsAsha()
    const { user, toggle, panel } = await openSwitcher()
    await user.click(within(panel).getByRole('button', { name: 'Create workspace' }))
    const dialog = screen.getByRole('dialog', { name: 'Create workspace' })
    return { ...result, user, toggle, dialog }
  }

  it('is keyboard operable: focus moves in, Tab is trapped, Escape closes and refocuses the toggle', async () => {
    renderAsAsha()
    const user = userEvent.setup()
    const toggle = await screen.findByRole('button', { name: 'Workspaces' })

    // Open everything with the keyboard only.
    toggle.focus()
    await user.keyboard('{Enter}')
    await screen.findByRole('list', { name: 'Your workspaces' })
    await user.tab() // Acme
    await user.tab() // Globex
    await user.tab() // Create workspace
    expect(within(panelOf(toggle)).getByRole('button', { name: 'Create workspace' })).toHaveFocus()
    await user.keyboard('{Enter}')

    const dialog = screen.getByRole('dialog', { name: 'Create workspace' })
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    const name = within(dialog).getByLabelText('Name')
    expect(name).toHaveFocus()
    // The switcher panel closed behind the dialog.
    expect(toggle).toHaveAttribute('aria-expanded', 'false')

    await user.tab()
    expect(within(dialog).getByLabelText('URL slug (optional)')).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.tab()
    expect(within(dialog).getByRole('button', { name: 'Create workspace' })).toHaveFocus()
    await user.tab()
    expect(name).toHaveFocus()
    await user.tab({ shift: true })
    expect(within(dialog).getByRole('button', { name: 'Create workspace' })).toHaveFocus()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
  })

  it('creates a workspace with a derived slug and opens it', async () => {
    const { user, dialog, router } = await openCreateModal()

    await user.type(within(dialog).getByLabelText('Name'), '  Initech Labs ')
    expect(within(dialog).getByLabelText('URL slug (optional)')).toHaveAttribute('placeholder', 'initech-labs')
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('heading', { level: 1, name: 'Initech Labs' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/w/initech-labs')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText(/^Your role/)).toHaveTextContent('Your role: Owner')
    expect(screen.getByRole('button', { name: 'Current workspace: Initech Labs' })).toHaveFocus()
    expect(findWorkspaceBySlug('initech-labs')?.name).toBe('Initech Labs')
  })

  it('sends an explicit slug', async () => {
    const { user, dialog, router } = await openCreateModal()

    await user.type(within(dialog).getByLabelText('Name'), 'Initech')
    await user.type(within(dialog).getByLabelText('URL slug (optional)'), 'ini-hq')
    await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Initech' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/w/ini-hq')
  })

  it('shows a taken slug (409 slug_taken) on the slug field and stays open', async () => {
    const { user, dialog, router } = await openCreateModal()

    await user.type(within(dialog).getByLabelText('Name'), 'Another Acme')
    await user.type(within(dialog).getByLabelText('URL slug (optional)'), 'acme')
    await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))

    const slug = within(dialog).getByLabelText('URL slug (optional)')
    expect(await within(dialog).findByText('This workspace URL is already taken')).toBeInTheDocument()
    expect(slug).toHaveAttribute('aria-invalid', 'true')
    expect(router.state.location.pathname).toBe('/')
    expect(db.workspaces).toHaveLength(2)
  })

  it('validates before sending', async () => {
    let requests = 0
    server.use(
      http.post('/api/workspaces', () => {
        requests += 1
        return HttpResponse.json(null, { status: 500 })
      }),
    )
    const { user, dialog } = await openCreateModal()

    await user.type(within(dialog).getByLabelText('URL slug (optional)'), 'Bad Slug')
    await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))

    const name = within(dialog).getByLabelText('Name')
    expect(name).toHaveAccessibleDescription('Enter a workspace name')
    expect(name).toHaveFocus()
    expect(within(dialog).getByText('Use lowercase letters, numbers and single hyphens, like "acme-inc"')).toBeInTheDocument()
    expect(requests).toBe(0)
  })

  it('shows other server errors above the form', async () => {
    server.use(
      http.post('/api/workspaces', () =>
        HttpResponse.json({ error: { code: 'internal_error', message: 'Server exploded', details: {} } }, { status: 500 }),
      ),
    )
    const { user, dialog } = await openCreateModal()

    await user.type(within(dialog).getByLabelText('Name'), 'Initech')
    await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Server exploded')
  })

  it('Cancel closes without creating anything', async () => {
    const { user, dialog, toggle } = await openCreateModal()

    await user.type(within(dialog).getByLabelText('Name'), 'Initech')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(toggle).toHaveFocus()
    expect(db.workspaces).toHaveLength(2)
  })
})
