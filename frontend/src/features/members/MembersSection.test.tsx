import { screen, waitFor, within } from '@testing-library/react'
import userEvent, { type UserEvent } from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { findMembership, MOCK_USERS, MOCK_WORKSPACES, setMockMembership, startMockSession } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'

const { acme } = MOCK_WORKSPACES
const { asha, ben, chen, dana, eve } = MOCK_USERS

function renderSettingsAs(who: keyof typeof MOCK_USERS) {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route: '/w/acme/settings' })
}

const membersTable = () => screen.findByRole('table', { name: 'Members of Acme' })

function rowOf(table: HTMLElement, name: string): HTMLElement {
  const header = within(table).getByRole('rowheader', { name: new RegExp(`^${name}`) })
  return header.closest('tr') as HTMLElement
}

const optionLabels = (select: HTMLElement) =>
  within(select)
    .getAllByRole('option')
    .map((option) => option.textContent)

const rowNames = (table: HTMLElement) =>
  within(table)
    .getAllByRole('rowheader')
    .map((header) => header.textContent)

async function addMember(user: UserEvent, email: string, role?: string) {
  const form = screen.getByRole('form', { name: 'Add a member' })
  await user.type(within(form).getByLabelText('Email'), email)
  if (role) await user.selectOptions(within(form).getByLabelText('Role'), role)
  await user.click(within(form).getByRole('button', { name: 'Add member' }))
  return form
}

describe('members table', () => {
  it('lists members by role then name, with email and role', async () => {
    renderSettingsAs('chen')
    const table = await membersTable()

    expect(rowNames(table)).toEqual(['Asha Rao', 'Dana Kim', 'Ben Okafor', 'Chen Wei (you)'])
    expect(within(rowOf(table, 'Asha Rao')).getByText(asha.email)).toBeInTheDocument()
  })

  it('shows a loading state, then an error with a retry', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(
        '/api/workspaces/:wid/members',
        () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom', details: {} } }, { status: 500 }),
        { once: true },
      ),
    )
    renderSettingsAs('asha')

    expect(await screen.findByText('Loading members...')).toBeInTheDocument()
    const members = screen.getByRole('region', { name: 'Members' })
    expect(await within(members).findByRole('alert')).toHaveTextContent('Could not load the members. Boom')
    await user.click(within(members).getByRole('button', { name: 'Try again' }))

    expect(await membersTable()).toBeInTheDocument()
  })
})

describe('role dropdowns', () => {
  it('owner: every other member gets all four roles; my own role is a badge', async () => {
    renderSettingsAs('asha')
    const table = await membersTable()

    for (const name of ['Dana Kim', 'Ben Okafor', 'Chen Wei']) {
      expect(optionLabels(within(table).getByRole('combobox', { name: `Role for ${name}` }))).toEqual([
        'Owner',
        'Admin',
        'Member',
        'Viewer',
      ])
    }
    expect(within(rowOf(table, 'Asha Rao')).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(rowOf(table, 'Asha Rao')).getByText('Owner')).toBeInTheDocument()
    expect(optionLabels(screen.getByLabelText('Role'))).toEqual(['Owner', 'Admin', 'Member', 'Viewer'])
  })

  it('admin: only members and viewers are editable, and only to Member or Viewer', async () => {
    renderSettingsAs('dana')
    const table = await membersTable()

    expect(optionLabels(within(table).getByRole('combobox', { name: 'Role for Ben Okafor' }))).toEqual(['Member', 'Viewer'])
    expect(optionLabels(within(table).getByRole('combobox', { name: 'Role for Chen Wei' }))).toEqual(['Member', 'Viewer'])
    expect(within(rowOf(table, 'Asha Rao')).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(rowOf(table, 'Dana Kim')).queryByRole('combobox')).not.toBeInTheDocument()
    expect(within(rowOf(table, 'Asha Rao')).queryByRole('button')).not.toBeInTheDocument()
    expect(optionLabels(screen.getByLabelText('Role'))).toEqual(['Member', 'Viewer'])
  })

  it('changes a role, then shows the member in the new order', async () => {
    const user = userEvent.setup()
    renderSettingsAs('asha')
    const table = await membersTable()

    await user.selectOptions(within(table).getByRole('combobox', { name: 'Role for Ben Okafor' }), 'Admin')

    await waitFor(() => expect(rowNames(table)).toEqual(['Asha Rao (you)', 'Ben Okafor', 'Dana Kim', 'Chen Wei']))
    expect(within(table).getByRole('combobox', { name: 'Role for Ben Okafor' })).toHaveValue('admin')
    expect(findMembership(acme.id, ben.id)?.role).toBe('admin')
  })

  it('shows a 403 (protected_member) in the row and refreshes the stale row', async () => {
    const user = userEvent.setup()
    renderSettingsAs('dana')
    const table = await membersTable()
    // Asha promotes Ben to admin in another browser; Dana's page still shows him as a member.
    setMockMembership(acme.id, ben.id, 'admin')

    await user.selectOptions(within(table).getByRole('combobox', { name: 'Role for Ben Okafor' }), 'Viewer')

    const row = rowOf(table, 'Ben Okafor')
    expect(await within(row).findByRole('alert')).toHaveTextContent(
      'Could not change the role. Only owners can change or remove owners and admins',
    )
    await waitFor(() => expect(within(rowOf(table, 'Ben Okafor')).queryByRole('combobox')).not.toBeInTheDocument())
    expect(within(rowOf(table, 'Ben Okafor')).getByText('Admin')).toBeInTheDocument()
    expect(findMembership(acme.id, ben.id)?.role).toBe('admin')
  })
})

describe('add member', () => {
  it('adds an existing user by email with the chosen role and clears the form', async () => {
    const user = userEvent.setup()
    renderSettingsAs('asha')
    const table = await membersTable()

    const form = await addMember(user, ' EVE@example.com ', 'Admin')

    expect(await within(form).findByRole('status')).toHaveTextContent('Added Eve Santos as Admin.')
    expect(within(form).getByLabelText('Email')).toHaveValue('')
    expect(rowNames(table)).toEqual(['Asha Rao (you)', 'Dana Kim', 'Eve Santos', 'Ben Okafor', 'Chen Wei'])
    expect(findMembership(acme.id, eve.id)?.role).toBe('admin')
  })

  it('shows "No user with this email" (422) on the email field', async () => {
    const user = userEvent.setup()
    renderSettingsAs('dana')
    await membersTable()

    const form = await addMember(user, 'nobody@example.com')

    const email = within(form).getByLabelText('Email')
    await waitFor(() => expect(email).toHaveAttribute('aria-invalid', 'true'))
    expect(email).toHaveAccessibleDescription('The person needs a TaskBoard account. No user with this email')
  })

  it('shows "already a member" (409) on the email field', async () => {
    const user = userEvent.setup()
    renderSettingsAs('dana')
    await membersTable()

    const form = await addMember(user, chen.email)

    expect(await within(form).findByText('This user is already a member of the workspace')).toBeInTheDocument()
    expect(within(form).getByLabelText('Email')).toHaveAttribute('aria-invalid', 'true')
  })

  it('validates the email before sending', async () => {
    const user = userEvent.setup()
    let requests = 0
    server.use(
      http.post('/api/workspaces/:wid/members', () => {
        requests += 1
        return HttpResponse.json(null, { status: 500 })
      }),
    )
    renderSettingsAs('asha')
    await membersTable()

    const form = await addMember(user, 'not-an-email')

    expect(within(form).getByLabelText('Email')).toHaveAccessibleDescription(
      'The person needs a TaskBoard account. Enter a valid email address',
    )
    expect(requests).toBe(0)
  })

  it('shows a 403 reason above the form', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/workspaces/:wid/members', () =>
        HttpResponse.json(
          {
            error: {
              code: 'forbidden',
              message: 'Only owners can grant the admin or owner role',
              details: { reason: 'protected_member' },
            },
          },
          { status: 403 },
        ),
      ),
    )
    renderSettingsAs('dana')
    await membersTable()

    const form = await addMember(user, eve.email)

    expect(await within(form).findByRole('alert')).toHaveTextContent('Only owners can grant the admin or owner role')
  })
})

describe('remove member', () => {
  it('asks for confirmation, then removes the member', async () => {
    const user = userEvent.setup()
    renderSettingsAs('asha')
    const table = await membersTable()

    await user.click(within(table).getByRole('button', { name: 'Remove Chen Wei' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Chen Wei?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove member' }))

    await waitFor(() => expect(rowNames(table)).toEqual(['Asha Rao (you)', 'Dana Kim', 'Ben Okafor']))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(findMembership(acme.id, chen.id)).toBeUndefined()
  })

  it('offers Remove only where the rules allow it', async () => {
    renderSettingsAs('dana')
    const table = await membersTable()

    expect(
      within(table)
        .getAllByRole('button', { name: /^Remove/ })
        .map((button) => button.textContent),
    ).toEqual(['Remove Ben Okafor', 'Remove Chen Wei'])
  })

  it('shows a server error in the dialog', async () => {
    const user = userEvent.setup()
    renderSettingsAs('dana')
    const table = await membersTable()
    setMockMembership(acme.id, ben.id, 'admin')

    await user.click(within(table).getByRole('button', { name: 'Remove Ben Okafor' }))
    const dialog = screen.getByRole('dialog', { name: 'Remove Ben Okafor?' })
    await user.click(within(dialog).getByRole('button', { name: 'Remove member' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'Only owners can change or remove owners and admins',
    )
    expect(findMembership(acme.id, ben.id)).toBeDefined()
  })
})

describe('leave workspace', () => {
  it('lets a member leave after confirming, then goes home', async () => {
    const user = userEvent.setup()
    const { router } = renderSettingsAs('ben')
    const table = await membersTable()

    await user.click(within(table).getByRole('button', { name: 'Leave workspace' }))
    const dialog = screen.getByRole('dialog', { name: 'Leave Acme?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave workspace' }))

    expect(await screen.findByText('You left Acme.')).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    const main = screen.getByRole('main')
    expect(within(main).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/w/globex'])
    expect(findMembership(acme.id, ben.id)).toBeUndefined()
  })

  it('disables Leave for the only owner, with the reason', async () => {
    renderSettingsAs('asha')
    const table = await membersTable()

    const leave = within(table).getByRole('button', { name: 'Leave workspace' })
    expect(leave).toBeDisabled()
    expect(leave).toHaveAccessibleDescription('You are the only owner. Make someone else an owner first.')
  })

  it('shows the 409 last_owner error when the other owner was demoted meanwhile', async () => {
    const user = userEvent.setup()
    setMockMembership(acme.id, dana.id, 'owner')
    renderSettingsAs('asha')
    const table = await membersTable()
    const leave = within(table).getByRole('button', { name: 'Leave workspace' })
    expect(leave).toBeEnabled()
    // Dana steps down to admin in another browser: Asha is now the only owner.
    setMockMembership(acme.id, dana.id, 'admin')

    await user.click(leave)
    const dialog = screen.getByRole('dialog', { name: 'Leave Acme?' })
    await user.click(within(dialog).getByRole('button', { name: 'Leave workspace' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent(
      'You are the only owner. Make another member an owner before leaving the workspace',
    )
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await waitFor(() => expect(within(table).getByRole('button', { name: 'Leave workspace' })).toBeDisabled())
    expect(findMembership(acme.id, asha.id)?.role).toBe('owner')
  })
})
