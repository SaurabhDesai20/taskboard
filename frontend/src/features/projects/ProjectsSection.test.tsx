import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import {
  createWorkspace,
  db,
  findProject,
  MOCK_PROJECTS,
  MOCK_USERS,
  MOCK_WORKSPACES,
  setMockMembership,
  startMockSession,
} from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'
import { findToast } from '../../test/toasts'

const { acme } = MOCK_WORKSPACES
const { website, mobile, legacy } = MOCK_PROJECTS
const PROJECTS_URL = '/api/workspaces/:wid/projects'

function renderAs(who: keyof typeof MOCK_USERS, route = '/w/acme') {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route })
}

function projectsRegion() {
  return screen.getByRole('region', { name: 'Projects' })
}

/** Waits for the project cards and returns their names in display order. */
async function cardNames() {
  const region = await screen.findByRole('region', { name: 'Projects' })
  const cards = await within(region).findAllByRole('article')
  return cards.map((card) => within(card).getByRole('heading').textContent)
}

function card(name: string) {
  return within(projectsRegion()).getByRole('article', { name })
}

function errorResponse(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
  return HttpResponse.json({ error: { code, message, details } }, { status })
}

describe('projects grid on the workspace overview', () => {
  it('lists active projects by name with key and description', async () => {
    renderAs('asha')

    expect(await cardNames()).toEqual(['Mobile App', 'Website'])
    const web = card('Website')
    expect(within(web).getByRole('link', { name: 'Website' })).toHaveAttribute('href', `/w/acme/projects/${website.id}`)
    expect(web).toHaveTextContent('Key: WEB')
    expect(web).toHaveTextContent('Marketing site and signup flow')
    expect(card('Mobile App')).toHaveTextContent('No description')
    expect(within(projectsRegion()).queryByText('Legacy CRM')).not.toBeInTheDocument()
  })

  it('shows a loading state while the projects load', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get(PROJECTS_URL, async () => {
        await gate
        return HttpResponse.json([])
      }),
    )
    renderAs('asha')

    expect(await screen.findByText('Loading projects...')).toBeInTheDocument()
    release()
    expect(await screen.findByRole('heading', { name: 'No active projects' })).toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    const user = userEvent.setup()
    server.use(http.get(PROJECTS_URL, () => errorResponse(500, 'internal_error', 'Boom'), { once: true }))
    renderAs('asha')

    const alert = await within(await screen.findByRole('region', { name: 'Projects' })).findByRole('alert')
    expect(alert).toHaveTextContent('Could not load the projects. Boom')
    await user.click(within(projectsRegion()).getByRole('button', { name: 'Try again' }))

    expect(await cardNames()).toEqual(['Mobile App', 'Website'])
  })

  it('shows archived projects with "Show archived", kept in the URL', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('asha')
    await cardNames()

    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }))

    await waitFor(async () => expect(await cardNames()).toEqual(['Legacy CRM', 'Mobile App', 'Website']))
    expect(router.state.location.search).toBe('?archived=1')
    const archived = card('Legacy CRM')
    expect(archived).toHaveTextContent('Archived')
    expect(within(archived).getByRole('button', { name: 'Edit Legacy CRM' })).toBeInTheDocument()
    expect(within(archived).queryByRole('button', { name: /^Archive/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    await waitFor(async () => expect(await cardNames()).toEqual(['Mobile App', 'Website']))
    expect(router.state.location.search).toBe('')
  })

  it('starts with archived projects shown for ?archived=1', async () => {
    renderAs('chen', '/w/acme?archived=1')

    expect(await cardNames()).toEqual(['Legacy CRM', 'Mobile App', 'Website'])
    expect(screen.getByRole('checkbox', { name: 'Show archived' })).toBeChecked()
  })

  it('navigates from a card into the project', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('ben')

    await user.click(await within(await screen.findByRole('region', { name: 'Projects' })).findByRole('link', { name: 'Website' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Website' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/w/acme/projects/${website.id}`)
  })
})

describe('empty states', () => {
  it('invites owners and admins to create the first project', async () => {
    const user = userEvent.setup()
    createWorkspace({ name: 'Beta', slug: 'beta' }, MOCK_USERS.asha.id)
    renderAs('asha', '/w/beta')

    const region = await screen.findByRole('region', { name: 'Projects' })
    expect(await within(region).findByRole('heading', { name: 'No active projects' })).toBeInTheDocument()
    expect(within(region).getByText('Create a project to organize the work in Beta.')).toBeInTheDocument()
    // One call to action: the header button appears once there are projects.
    expect(within(region).getAllByRole('button', { name: 'New project' })).toHaveLength(1)

    await user.click(within(region).getByRole('checkbox', { name: 'Show archived' }))
    expect(await within(region).findByRole('heading', { name: 'No projects yet' })).toBeInTheDocument()
  })

  it.each(['member', 'viewer'] as const)('words the empty state for a %s, without a create button', async (role) => {
    const beta = createWorkspace({ name: 'Beta', slug: 'beta' }, MOCK_USERS.asha.id)
    setMockMembership(beta.id, MOCK_USERS.chen.id, role)
    renderAs('chen', '/w/beta')

    const region = await screen.findByRole('region', { name: 'Projects' })
    expect(await within(region).findByText('Projects that admins and owners create will be listed here.')).toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: 'New project' })).not.toBeInTheDocument()
  })
})

describe('role-based visibility', () => {
  it.each(['asha', 'dana'] as const)('%s (owner/admin) can create, edit and archive', async (who) => {
    renderAs(who)
    await cardNames()

    expect(within(projectsRegion()).getByRole('button', { name: 'New project' })).toBeInTheDocument()
    for (const name of ['Mobile App', 'Website']) {
      expect(within(card(name)).getByRole('button', { name: `Edit ${name}` })).toBeInTheDocument()
      expect(within(card(name)).getByRole('button', { name: `Archive ${name}` })).toBeInTheDocument()
    }
  })

  it.each(['ben', 'chen'] as const)('%s (member/viewer) sees a read-only grid', async (who) => {
    renderAs(who)
    await cardNames()

    const region = projectsRegion()
    expect(within(region).queryByRole('button', { name: 'New project' })).not.toBeInTheDocument()
    expect(within(region).queryByRole('button', { name: /^(Edit|Archive) / })).not.toBeInTheDocument()
    expect(within(region).getAllByRole('link').map((link) => link.textContent)).toEqual(['Mobile App', 'Website'])
    expect(within(region).getByRole('checkbox', { name: 'Show archived' })).toBeInTheDocument()
  })
})

async function openCreateDialog(who: keyof typeof MOCK_USERS = 'asha') {
  const user = userEvent.setup()
  const rendered = renderAs(who)
  await cardNames()
  await user.click(within(projectsRegion()).getByRole('button', { name: 'New project' }))
  const dialog = screen.getByRole('dialog', { name: 'Create project' })
  return { ...rendered, user, dialog }
}

describe('create project', () => {
  it('creates the project and opens it', async () => {
    const { user, dialog, router } = await openCreateDialog('dana')

    expect(within(dialog).getByLabelText('Name')).toHaveFocus()
    await user.type(within(dialog).getByLabelText('Name'), 'Docs Portal')
    expect(within(dialog).getByLabelText('Key')).toHaveValue('DP')
    await user.type(within(dialog).getByLabelText('Description (optional)'), '  Handbook and guides ')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Docs Portal' })).toBeInTheDocument()
    const created = db.projects.find((project) => project.key === 'DP')
    expect(created).toMatchObject({ name: 'Docs Portal', description: 'Handbook and guides', workspace_id: acme.id })
    expect(router.state.location.pathname).toBe(`/w/acme/projects/${created?.id}`)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    // The new project is in the sidebar too, as the current one.
    const sidebar = screen.getByRole('navigation', { name: 'Projects' })
    expect(within(sidebar).getByRole('link', { name: 'Docs Portal' })).toHaveAttribute('aria-current', 'page')
  })

  it('suggests an uppercase key from the name until the user types one', async () => {
    const { user, dialog } = await openCreateDialog()
    const name = within(dialog).getByLabelText('Name')
    const key = within(dialog).getByLabelText('Key')

    await user.type(name, 'Website')
    expect(key).toHaveValue('WEB')
    expect(key).toHaveAccessibleDescription(expect.stringContaining('Task IDs start with it (WEB-1)'))

    await user.clear(key)
    await user.type(key, 'site2')
    expect(key).toHaveValue('SITE2')
    await user.type(name, ' Relaunch')
    expect(key).toHaveValue('SITE2')

    // Emptying the key lets it follow the name again.
    await user.clear(key)
    await user.type(name, ' Now')
    expect(key).toHaveValue('WRN')
  })

  it('validates before sending', async () => {
    const { user, dialog } = await openCreateDialog()
    const count = db.projects.length

    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))

    expect(within(dialog).getByLabelText('Name')).toHaveAccessibleDescription('Enter a project name')
    expect(within(dialog).getByLabelText('Name')).toHaveFocus()
    expect(within(dialog).getByLabelText('Key')).toHaveAccessibleDescription(expect.stringContaining('Enter a project key'))

    await user.type(within(dialog).getByLabelText('Name'), '2026')
    await user.type(within(dialog).getByLabelText('Key'), '1AB')
    expect(within(dialog).getByLabelText('Key')).toHaveAccessibleDescription(
      expect.stringContaining('Use uppercase letters and digits, starting with a letter, like "WEB"'),
    )
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(within(dialog).getByLabelText('Key')).toHaveFocus()
    expect(db.projects).toHaveLength(count)
  })

  it('shows a taken key (409 project_key_taken) on the key field', async () => {
    const { user, dialog } = await openCreateDialog()

    await user.type(within(dialog).getByLabelText('Name'), 'Web')
    expect(within(dialog).getByLabelText('Key')).toHaveValue('WEB')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))

    await waitFor(() =>
      expect(within(dialog).getByLabelText('Key')).toHaveAccessibleDescription(
        expect.stringContaining('This project key is already used in this workspace'),
      ),
    )
    expect(screen.getByRole('dialog', { name: 'Create project' })).toBeInTheDocument()
    expect(db.projects.filter((project) => project.key === 'WEB')).toHaveLength(1)

    // A free key goes through.
    await user.clear(within(dialog).getByLabelText('Key'))
    await user.type(within(dialog).getByLabelText('Key'), 'WEB2')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Web' })).toBeInTheDocument()
  })

  it('shows 422 field errors from the server under their fields', async () => {
    server.use(
      http.post(PROJECTS_URL, () =>
        errorResponse(422, 'validation_error', 'Request validation failed', {
          errors: [{ field: 'name', location: 'body', message: 'Name is reserved' }],
        }),
      ),
    )
    const { user, dialog } = await openCreateDialog()

    await user.type(within(dialog).getByLabelText('Name'), 'Admin')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(within(dialog).getByLabelText('Name')).toHaveAccessibleDescription('Name is reserved'))
  })

  it('after a 403 (demoted meanwhile) refetches my role and hides the manage actions', async () => {
    const { user, dialog } = await openCreateDialog('dana')
    setMockMembership(acme.id, MOCK_USERS.dana.id, 'member')

    await user.type(within(dialog).getByLabelText('Name'), 'Docs')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))

    await waitFor(() => expect(screen.getByText(/^Your role/)).toHaveTextContent('Your role: Member'))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(projectsRegion()).queryByRole('button', { name: 'New project' })).not.toBeInTheDocument()
    expect(db.projects.some((project) => project.name === 'Docs')).toBe(false)
  })

  it('Cancel closes without creating', async () => {
    const { user, dialog } = await openCreateDialog()
    const count = db.projects.length

    await user.type(within(dialog).getByLabelText('Name'), 'Draft')
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(within(projectsRegion()).getByRole('button', { name: 'New project' })).toHaveFocus()
    expect(db.projects).toHaveLength(count)
  })
})

describe('edit project', () => {
  async function openEditDialog(name: string) {
    const user = userEvent.setup()
    renderAs('asha')
    await cardNames()
    await user.click(within(card(name)).getByRole('button', { name: `Edit ${name}` }))
    return { user, dialog: screen.getByRole('dialog', { name: 'Edit project' }) }
  }

  it('renames the project and clears its description', async () => {
    const { user, dialog } = await openEditDialog('Website')
    const name = within(dialog).getByLabelText('Name')
    expect(name).toHaveValue('Website')
    expect(within(dialog).getByLabelText('Description (optional)')).toHaveValue('Marketing site and signup flow')
    expect(dialog).toHaveTextContent('Key: WEB (cannot be changed)')

    await user.clear(name)
    await user.type(name, 'Website v2')
    await user.clear(within(dialog).getByLabelText('Description (optional)'))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(await cardNames()).toEqual(['Mobile App', 'Website v2'])
    expect(card('Website v2')).toHaveTextContent('No description')
    expect(findProject(website.id)).toMatchObject({ name: 'Website v2', description: null, key: 'WEB' })
    expect(within(card('Website v2')).getByRole('button', { name: 'Edit Website v2' })).toHaveFocus()
  })

  it('closes without a request when nothing changed', async () => {
    let patches = 0
    server.use(
      http.patch('/api/projects/:pid', () => {
        patches += 1
      }),
    )
    const { user, dialog } = await openEditDialog('Mobile App')

    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(patches).toBe(0)
  })

  it('validates the name', async () => {
    const { user, dialog } = await openEditDialog('Website')

    await user.clear(within(dialog).getByLabelText('Name'))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(within(dialog).getByLabelText('Name')).toHaveAccessibleDescription('Enter a project name')
    expect(findProject(website.id)?.name).toBe('Website')
  })
})

describe('archive project', () => {
  async function openArchiveDialog(name = 'Website') {
    const user = userEvent.setup()
    const rendered = renderAs('asha')
    await cardNames()
    const button = within(card(name)).getByRole('button', { name: `Archive ${name}` })
    await user.click(button)
    return { ...rendered, user, button, dialog: screen.getByRole('dialog', { name: `Archive ${name}?` }) }
  }

  it('asks for confirmation; Cancel keeps the project', async () => {
    const { user, button, dialog } = await openArchiveDialog()

    expect(within(dialog).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(dialog).getByRole('button', { name: 'Cancel' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(button).toHaveFocus()
    expect(findProject(website.id)?.archived_at).toBeNull()
  })

  it('archives the project: it leaves the grid, a toast confirms and focus moves to the Projects heading', async () => {
    const { user, dialog } = await openArchiveDialog()

    await user.click(within(dialog).getByRole('button', { name: 'Archive project' }))

    expect(await findToast('Archived Website.')).toBeInTheDocument()
    await waitFor(() => expect(screen.getByRole('heading', { level: 2, name: 'Projects' })).toHaveFocus())
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(await cardNames()).toEqual(['Mobile App'])
    expect(findProject(website.id)?.archived_at).toEqual(expect.stringMatching(/Z$/))

    await user.click(screen.getByRole('checkbox', { name: 'Show archived' }))
    await waitFor(async () => expect(await cardNames()).toEqual(['Legacy CRM', 'Mobile App', 'Website']))
    expect(card('Website')).toHaveTextContent('Archived')
  })

  it('keeps the dialog open with the error when it was archived meanwhile (409)', async () => {
    const { user, dialog } = await openArchiveDialog('Mobile App')
    // Someone else archives it first.
    const record = findProject(mobile.id)
    if (record) record.archived_at = '2026-11-22T10:00:00Z'

    await user.click(within(dialog).getByRole('button', { name: 'Archive project' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This project is already archived')
    // The grid catches up behind the dialog.
    await waitFor(async () => expect(await cardNames()).toEqual(['Website']))
    expect(screen.getByRole('dialog', { name: 'Archive Mobile App?' })).toBeInTheDocument()
  })

  it('shows a 403 inside the dialog', async () => {
    server.use(
      http.post('/api/projects/:pid/archive', () =>
        errorResponse(403, 'forbidden', 'Only owners and admins can create, edit or archive projects', { reason: 'insufficient_role' }),
      ),
    )
    const { user, dialog } = await openArchiveDialog()

    await user.click(within(dialog).getByRole('button', { name: 'Archive project' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Only owners and admins can create, edit or archive projects')
    expect(findProject(website.id)?.archived_at).toBeNull()
    expect(findProject(legacy.id)?.archived_at).not.toBeNull()
  })
})
