import { cleanup, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { findProject, MOCK_PROJECTS, MOCK_USERS, startMockSession } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'

const { website, mobile, legacy, operations } = MOCK_PROJECTS
const MISSING_ID = '30000000-0000-4000-8000-0000000000ff'

function renderProjectAs(who: keyof typeof MOCK_USERS, projectId: string, slug = 'acme') {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route: `/w/${slug}/projects/${projectId}` })
}

const breadcrumbs = () => screen.getByRole('navigation', { name: 'Breadcrumb' })
const sidebar = () => screen.getByRole('navigation', { name: 'Projects' })

/** The sidebar's project links (name only; the key is hidden from the accessible name). */
function sidebarProjects() {
  return within(sidebar())
    .getAllByRole('link')
    .filter((link) => link.textContent !== 'All projects')
    .map((link) => [link.querySelector('.project-sidebar__name')?.textContent, link.getAttribute('aria-current')])
}

describe('project layout', () => {
  it('shows breadcrumbs, the sidebar with the current project, the header and the task board', async () => {
    renderProjectAs('ben', website.id)

    expect(await screen.findByRole('heading', { level: 1, name: 'Website' })).toBeInTheDocument()

    const crumbs = breadcrumbs()
    expect(within(crumbs).getByRole('link', { name: 'Workspaces' })).toHaveAttribute('href', '/')
    expect(within(crumbs).getByRole('link', { name: 'Acme' })).toHaveAttribute('href', '/w/acme')
    expect(within(crumbs).getByText('Website')).toHaveAttribute('aria-current', 'page')
    expect(within(crumbs).getAllByRole('listitem').map((item) => item.textContent)).toEqual([
      'Workspaces',
      'Acme',
      'Website',
    ])

    await waitFor(() =>
      expect(sidebarProjects()).toEqual([
        ['Mobile App', null],
        ['Website', 'page'],
      ]),
    )
    expect(within(sidebar()).getByRole('link', { name: 'All projects' })).toHaveAttribute('href', '/w/acme')

    expect(screen.getByText('Marketing site and signup flow')).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1 }).parentElement).toHaveTextContent('WebsiteKey: WEB')
    expect(screen.queryByRole('note')).not.toBeInTheDocument()
    const tasks = screen.getByRole('region', { name: 'Tasks' })
    expect(await within(tasks).findByRole('region', { name: 'To Do' })).toBeInTheDocument()
  })

  it('moves between projects from the sidebar', async () => {
    const user = userEvent.setup()
    const { router } = renderProjectAs('chen', website.id)
    await screen.findByRole('heading', { level: 1, name: 'Website' })

    await user.click(await within(sidebar()).findByRole('link', { name: 'Mobile App' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Mobile App' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/w/acme/projects/${mobile.id}`)
    expect(within(breadcrumbs()).getByText('Mobile App')).toHaveAttribute('aria-current', 'page')
    expect(sidebarProjects()).toEqual([
      ['Mobile App', 'page'],
      ['Website', null],
    ])
  })

  it('goes back to the workspace from the breadcrumbs', async () => {
    const user = userEvent.setup()
    const { router } = renderProjectAs('chen', website.id)
    await screen.findByRole('heading', { level: 1, name: 'Website' })

    await user.click(within(breadcrumbs()).getByRole('link', { name: 'Acme' }))

    expect(await screen.findByRole('region', { name: 'Projects' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/w/acme')
  })

  it('shows a read-only banner for an archived project, listed under "Archived" in the sidebar', async () => {
    renderProjectAs('asha', legacy.id)

    expect(await screen.findByRole('heading', { level: 1, name: 'Legacy CRM' })).toBeInTheDocument()
    const banner = screen.getByRole('note')
    expect(banner).toHaveTextContent(/^Archived on .+\. This project is read-only: its tasks and comments cannot be changed\.$/)
    // Archived projects cannot be archived again; they can still be renamed.
    expect(screen.getByRole('button', { name: 'Edit project' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive project' })).not.toBeInTheDocument()

    const archivedList = await within(sidebar()).findByRole('list', { name: 'Archived' })
    expect(within(archivedList).getByRole('link', { name: 'Legacy CRM' })).toHaveAttribute('aria-current', 'page')
    await waitFor(() =>
      expect(sidebarProjects()).toEqual([
        ['Mobile App', null],
        ['Website', null],
        ['Legacy CRM', 'page'],
      ]),
    )
  })

  // The archived project is not in the sidebar's (active) list, which would otherwise stand in
  // for the project while it loads or after a failed load.
  it('shows a loading state, then the project', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('/api/projects/:pid', async () => {
        await gate
        return HttpResponse.json(legacy)
      }),
    )
    renderProjectAs('chen', legacy.id)

    expect(await screen.findByText('Loading project...')).toBeInTheDocument()
    release()
    expect(await screen.findByRole('heading', { level: 1, name: 'Legacy CRM' })).toBeInTheDocument()
  })

  it('shows an error with a retry when the project fails to load', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(
        '/api/projects/:pid',
        () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom', details: {} } }, { status: 500 }),
        { once: true },
      ),
    )
    renderProjectAs('chen', legacy.id)

    const main = screen.getByRole('main')
    expect(await within(main).findByRole('alert')).toHaveTextContent('Could not load the project. Boom')
    await user.click(within(main).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Legacy CRM' })).toBeInTheDocument()
  })
})

describe('project not found', () => {
  it.each([
    ['an unknown id', 'asha', MISSING_ID],
    ['a malformed id', 'asha', 'not-a-uuid'],
    ['a project of a workspace I am not in', 'chen', operations.id],
    ['a project of another of my workspaces', 'asha', operations.id],
  ] as const)('shows "Project not found" inside the layout for %s', async (_case, who, projectId) => {
    renderProjectAs(who, projectId)

    expect(await screen.findByRole('heading', { level: 1, name: 'Project not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to Acme' })).toHaveAttribute('href', '/w/acme')
    expect(within(breadcrumbs()).getByText('Project not found')).toHaveAttribute('aria-current', 'page')
    // The sidebar still offers the workspace's projects, none of them current.
    await waitFor(() =>
      expect(sidebarProjects()).toEqual([
        ['Mobile App', null],
        ['Website', null],
      ]),
    )
    expect(screen.queryByRole('region', { name: 'Tasks' })).not.toBeInTheDocument()
  })

  it('shows "Workspace not found" for a workspace I am not in', async () => {
    renderProjectAs('chen', operations.id, 'globex')

    expect(await screen.findByRole('heading', { level: 1, name: 'Workspace not found' })).toBeInTheDocument()
  })
})

describe('managing from the project page', () => {
  it.each(['asha', 'dana'] as const)('%s (owner/admin) gets Edit and Archive', async (who) => {
    renderProjectAs(who, website.id)

    await screen.findByRole('heading', { level: 1, name: 'Website' })
    expect(screen.getByRole('button', { name: 'Edit project' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Archive project' })).toBeInTheDocument()
  })

  it.each(['ben', 'chen'] as const)('%s (member/viewer) gets a read-only page', async (who) => {
    renderProjectAs(who, website.id)

    await screen.findByRole('heading', { level: 1, name: 'Website' })
    expect(screen.queryByRole('button', { name: 'Edit project' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Archive project' })).not.toBeInTheDocument()
  })

  it('archives the project: the banner appears and takes focus, the sidebar moves it under "Archived"', async () => {
    const user = userEvent.setup()
    renderProjectAs('dana', website.id)
    await user.click(await screen.findByRole('button', { name: 'Archive project' }))
    const dialog = screen.getByRole('dialog', { name: 'Archive Website?' })

    await user.click(within(dialog).getByRole('button', { name: 'Archive project' }))

    const banner = await screen.findByRole('note')
    expect(banner).toHaveTextContent('This project is read-only')
    await waitFor(() => expect(banner).toHaveFocus())
    expect(screen.queryByRole('button', { name: 'Archive project' })).not.toBeInTheDocument()
    expect(findProject(website.id)?.archived_at).not.toBeNull()
    await waitFor(() =>
      expect(sidebarProjects()).toEqual([
        ['Mobile App', null],
        ['Website', 'page'],
      ]),
    )
    expect(within(sidebar()).getByRole('list', { name: 'Archived' })).toHaveTextContent('Website')
  })

  it('edits the project: header, breadcrumbs and sidebar follow', async () => {
    const user = userEvent.setup()
    renderProjectAs('asha', website.id)
    await user.click(await screen.findByRole('button', { name: 'Edit project' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit project' })

    await user.clear(within(dialog).getByLabelText('Name'))
    await user.type(within(dialog).getByLabelText('Name'), 'Storefront')
    await user.clear(within(dialog).getByLabelText('Description (optional)'))
    await user.type(within(dialog).getByLabelText('Description (optional)'), 'Shop pages')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Storefront' })).toBeInTheDocument()
    expect(screen.getByText('Shop pages')).toBeInTheDocument()
    expect(within(breadcrumbs()).getByText('Storefront')).toHaveAttribute('aria-current', 'page')
    await waitFor(() =>
      expect(sidebarProjects()).toEqual([
        ['Mobile App', null],
        ['Storefront', 'page'],
      ]),
    )
    expect(screen.getByRole('button', { name: 'Edit project' })).toHaveFocus()
  })

  it('shows server errors in the edit dialog', async () => {
    const user = userEvent.setup()
    server.use(
      http.patch('/api/projects/:pid', () =>
        HttpResponse.json(
          { error: { code: 'not_found', message: 'Project not found', details: {} } },
          { status: 404 },
        ),
      ),
    )
    renderProjectAs('asha', mobile.id)
    await user.click(await screen.findByRole('button', { name: 'Edit project' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit project' })

    await user.type(within(dialog).getByLabelText('Name'), ' 2')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Project not found')
  })
})

describe('sidebar on smaller screens', () => {
  it('collapses and expands from its heading button, and remembers the choice', async () => {
    const user = userEvent.setup()
    renderProjectAs('ben', website.id)
    await screen.findByRole('heading', { level: 1, name: 'Website' })
    const toggle = within(sidebar()).getByRole('button', { name: 'Projects' })
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    expect(document.getElementById(toggle.getAttribute('aria-controls') ?? '')).toBeVisible()

    await user.click(toggle)

    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(within(sidebar()).queryByRole('link', { name: 'All projects' })).not.toBeInTheDocument()
    // The board is unaffected.
    expect(screen.getByRole('region', { name: 'Tasks' })).toBeInTheDocument()

    cleanup()
    renderProjectAs('ben', website.id)
    await screen.findByRole('heading', { level: 1, name: 'Website' })
    const again = within(sidebar()).getByRole('button', { name: 'Projects' })
    expect(again).toHaveAttribute('aria-expanded', 'false')
    await user.click(again)
    expect(await within(sidebar()).findByRole('link', { name: 'All projects' })).toBeInTheDocument()
  })

  it('puts the project heading first, then the sidebar and the board (heading order)', async () => {
    renderProjectAs('ben', website.id)
    await screen.findByRole('region', { name: 'To Do' })

    const headings = screen.getAllByRole('heading').map((heading) => [heading.tagName, heading.textContent])
    expect(headings.slice(0, 3)).toEqual([
      ['H1', 'Website'],
      ['H2', 'Projects'],
      ['H2', 'Tasks'],
    ])
  })
})
