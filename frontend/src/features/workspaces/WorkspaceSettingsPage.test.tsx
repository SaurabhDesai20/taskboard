import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  createWorkspace,
  db,
  findWorkspace,
  MOCK_USERS,
  MOCK_WORKSPACES,
  setMockMembership,
  startMockSession,
} from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'
import { findToast } from '../../test/toasts'

const { acme } = MOCK_WORKSPACES

function renderSettingsAs(who: keyof typeof MOCK_USERS) {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route: '/w/acme/settings' })
}

/** Waits for the members table, so every role-dependent part of the page has rendered. */
async function membersTable() {
  return screen.findByRole('table', { name: 'Members of Acme' })
}

describe('workspace settings per role', () => {
  it('owner: rename form, add-member form, editable members and the delete section', async () => {
    renderSettingsAs('asha')
    await membersTable()

    expect(screen.getByRole('form', { name: 'Rename workspace' })).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Acme')
    expect(screen.getByRole('form', { name: 'Add a member' })).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Delete workspace' })).toBeInTheDocument()
    expect(screen.getAllByRole('combobox', { name: /^Role for/ })).toHaveLength(3)
  })

  it('admin: no rename or delete, but can add and manage members and viewers', async () => {
    renderSettingsAs('dana')
    await membersTable()

    expect(screen.queryByRole('form', { name: 'Rename workspace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Delete workspace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete workspace' })).not.toBeInTheDocument()
    const general = screen.getByRole('region', { name: 'General' })
    expect(within(general).getByText('Acme')).toBeInTheDocument()
    expect(within(general).getByText('acme')).toBeInTheDocument()
    expect(screen.getByRole('form', { name: 'Add a member' })).toBeInTheDocument()
    expect(
      screen.getAllByRole('combobox', { name: /^Role for/ }).map((select) => select.getAttribute('aria-label')),
    ).toEqual(['Role for Ben Okafor', 'Role for Chen Wei'])
  })

  it.each(['ben', 'chen'] as const)('%s (member/viewer): read-only members, only "Leave workspace"', async (who) => {
    renderSettingsAs(who)
    const table = await membersTable()

    expect(screen.queryByRole('form', { name: 'Rename workspace' })).not.toBeInTheDocument()
    expect(screen.queryByRole('form', { name: 'Add a member' })).not.toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Delete workspace' })).not.toBeInTheDocument()
    expect(within(table).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(table).queryByRole('button', { name: /^Remove/ })).not.toBeInTheDocument()
    expect(within(table).getAllByRole('button')).toHaveLength(1)
    expect(within(table).getByRole('button', { name: 'Leave workspace' })).toBeEnabled()
    // Every member is listed with a role badge.
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getByRole('rowheader').textContent)).toEqual([
      'Asha Rao',
      'Dana Kim',
      who === 'ben' ? 'Ben Okafor (you)' : 'Ben Okafor',
      who === 'chen' ? 'Chen Wei (you)' : 'Chen Wei',
    ])
    expect(rows.map((row) => within(row).getAllByRole('cell')[1].textContent)).toEqual([
      'Owner',
      'Admin',
      'Member',
      'Viewer',
    ])
  })
})

describe('rename (owner)', () => {
  it('renames the workspace and updates the header and switcher', async () => {
    const user = userEvent.setup()
    renderSettingsAs('asha')
    const name = await screen.findByLabelText('Workspace name')

    await user.clear(name)
    await user.type(name, '  Acme Inc ')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(await screen.findByRole('status')).toHaveTextContent('Renamed to Acme Inc.')
    expect(screen.getByRole('heading', { level: 1, name: 'Acme Inc' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Current workspace: Acme Inc' })).toBeInTheDocument()
    expect(findWorkspace(acme.id)?.name).toBe('Acme Inc')
  })

  it('validates the name before sending', async () => {
    const user = userEvent.setup()
    renderSettingsAs('asha')
    const name = await screen.findByLabelText('Workspace name')

    await user.clear(name)
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    expect(name).toHaveAccessibleDescription('Enter a workspace name')
    expect(findWorkspace(acme.id)?.name).toBe('Acme')
  })

  it('after a 403 (demoted meanwhile) refetches my role and hides the owner-only form', async () => {
    const user = userEvent.setup()
    setMockMembership(acme.id, MOCK_USERS.dana.id, 'owner')
    renderSettingsAs('asha')
    const name = await screen.findByLabelText('Workspace name')
    // Dana demotes Asha in another browser.
    setMockMembership(acme.id, MOCK_USERS.asha.id, 'admin')

    await user.type(name, ' Inc')
    await user.click(screen.getByRole('button', { name: 'Save name' }))

    await waitFor(() => expect(screen.getByText(/^Your role/)).toHaveTextContent('Your role: Admin'))
    expect(screen.queryByRole('form', { name: 'Rename workspace' })).not.toBeInTheDocument()
    expect(findWorkspace(acme.id)?.name).toBe('Acme')
  })
})

describe('switching workspaces on the settings page', () => {
  it('starts the forms over for the other workspace', async () => {
    const user = userEvent.setup()
    createWorkspace({ name: 'Beta', slug: 'beta' }, MOCK_USERS.asha.id)
    const { router } = renderSettingsAs('asha')
    const name = await screen.findByLabelText('Workspace name')
    await user.type(name, ' draft')

    await router.navigate('/w/beta/settings')

    expect(await screen.findByRole('heading', { level: 1, name: 'Beta' })).toBeInTheDocument()
    expect(screen.getByLabelText('Workspace name')).toHaveValue('Beta')
  })
})

describe('delete (owner)', () => {
  it('asks for confirmation; Cancel keeps the workspace', async () => {
    const user = userEvent.setup()
    renderSettingsAs('asha')
    const open = await screen.findByRole('button', { name: 'Delete workspace' })

    await user.click(open)
    const dialog = screen.getByRole('dialog', { name: 'Delete Acme?' })
    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(open).toHaveFocus()
    expect(findWorkspace(acme.id)).toBeDefined()
  })

  it('deletes the workspace and goes home with a toast that does not come back', async () => {
    const user = userEvent.setup()
    const { router } = renderSettingsAs('asha')

    await user.click(await screen.findByRole('button', { name: 'Delete workspace' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Acme?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete workspace' }))

    expect(await findToast('Deleted the workspace Acme.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    // Unlike the old notice in router state, nothing is left for a reload to show again.
    expect(router.state.location.state).toBeNull()
    const workspaces = screen.getByRole('region', { name: 'Your workspaces' })
    expect(within(workspaces).getAllByRole('link').map((link) => link.textContent)).toEqual(['Globex/w/globexMember'])
    expect(findWorkspace(acme.id)).toBeUndefined()
    expect(db.members.some((member) => member.workspace_id === acme.id)).toBe(false)
  })

  it('shows a server error inside the dialog', async () => {
    const user = userEvent.setup()
    server.use(
      http.delete('/api/workspaces/:wid', () =>
        HttpResponse.json(
          { error: { code: 'forbidden', message: 'Only owners can delete the workspace', details: { reason: 'insufficient_role' } } },
          { status: 403 },
        ),
      ),
    )
    renderSettingsAs('asha')

    await user.click(await screen.findByRole('button', { name: 'Delete workspace' }))
    const dialog = screen.getByRole('dialog', { name: 'Delete Acme?' })
    await user.click(within(dialog).getByRole('button', { name: 'Delete workspace' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only owners can delete the workspace')
  })
})
