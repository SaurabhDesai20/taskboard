import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MOCK_USERS, startMockSession } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'

function renderAs(who: keyof typeof MOCK_USERS, route: string) {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route })
}

const failOnce = () =>
  server.use(
    http.get(
      '/api/workspaces',
      () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom', details: {} } }, { status: 500 }),
      { once: true },
    ),
  )

describe('home: the workspace list', () => {
  it('lists my workspaces, ordered by name, with my role and a link to each', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('asha', '/')

    const main = screen.getByRole('main')
    const acme = await within(main).findByRole('link', { name: /Acme/ })
    expect(acme).toHaveTextContent('Acme/w/acmeOwner')
    const links = within(main).getAllByRole('link')
    expect(links.map((link) => link.getAttribute('href'))).toEqual(['/w/acme', '/w/globex'])
    expect(links[1]).toHaveTextContent('Member')
    expect(within(main).getByRole('button', { name: 'Create workspace' })).toBeInTheDocument()

    await user.click(acme)
    expect(router.state.location.pathname).toBe('/w/acme')
  })

  it('shows an empty state with a create call to action, which creates and opens the workspace', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('eve', '/')

    const main = screen.getByRole('main')
    expect(await within(main).findByRole('heading', { name: 'No workspaces yet' })).toBeInTheDocument()
    await user.click(within(main).getByRole('button', { name: 'Create workspace' }))
    const dialog = screen.getByRole('dialog', { name: 'Create workspace' })
    await user.type(within(dialog).getByLabelText('Name'), 'Eve Studio')
    await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Eve Studio' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/w/eve-studio')
  })

  it('shows a loading state while the list loads', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('/api/workspaces', async () => {
        await gate
        return HttpResponse.json([])
      }),
    )
    renderAs('asha', '/')

    expect(await screen.findByText('Loading your workspaces...')).toBeInTheDocument()
    release()
    expect(await screen.findByRole('heading', { name: 'No workspaces yet' })).toBeInTheDocument()
  })

  it('shows an error with a retry', async () => {
    const user = userEvent.setup()
    failOnce()
    renderAs('asha', '/')

    const main = screen.getByRole('main')
    expect(await within(main).findByRole('alert')).toHaveTextContent('Could not load your workspaces. Boom')
    await user.click(within(main).getByRole('button', { name: 'Try again' }))

    expect(await within(main).findByRole('link', { name: /Acme/ })).toBeInTheDocument()
  })
})

describe('workspace pages (/w/:slug)', () => {
  it('shows the overview: name, my role, navigation and an empty Projects section', async () => {
    renderAs('asha', '/w/acme')

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument()
    expect(screen.getByText(/^Your role/)).toHaveTextContent('Your role: Owner')
    const nav = screen.getByRole('navigation', { name: 'Workspace' })
    expect(within(nav).getByRole('link', { name: 'Overview' })).toHaveAttribute('aria-current', 'page')
    expect(within(nav).getByRole('link', { name: 'Settings' })).toHaveAttribute('href', '/w/acme/settings')
    const projects = screen.getByRole('region', { name: 'Projects' })
    expect(within(projects).getByText('No projects yet')).toBeInTheDocument()
    expect(within(projects).getByText('Projects you create in Acme will be listed here.')).toBeInTheDocument()
  })

  it('words the empty Projects section for roles that cannot create projects', async () => {
    renderAs('chen', '/w/acme')

    const projects = await screen.findByRole('region', { name: 'Projects' })
    expect(screen.getByText(/^Your role/)).toHaveTextContent('Your role: Viewer')
    expect(within(projects).getByText('Projects that admins and owners create will be listed here.')).toBeInTheDocument()
  })

  it.each([
    ['an unknown slug', 'asha', '/w/nope'],
    ['a workspace the user is not in', 'chen', '/w/globex/settings'],
  ] as const)('shows "Workspace not found" for %s', async (_case, who, route) => {
    renderAs(who, route)

    expect(await screen.findByRole('heading', { level: 1, name: 'Workspace not found' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Back to your workspaces' })).toHaveAttribute('href', '/')
  })

  it('shows an error with a retry when the workspace list fails', async () => {
    const user = userEvent.setup()
    failOnce()
    renderAs('asha', '/w/acme')

    const main = screen.getByRole('main')
    expect(await within(main).findByRole('alert')).toHaveTextContent('Could not load the workspace. Boom')
    await user.click(within(main).getByRole('button', { name: 'Try again' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'Acme' })).toBeInTheDocument()
  })

  it('shows the 404 page for unknown paths inside a workspace', async () => {
    renderAs('asha', '/w/acme/unknown')

    expect(await screen.findByRole('heading', { name: 'Page not found' })).toBeInTheDocument()
  })
})
