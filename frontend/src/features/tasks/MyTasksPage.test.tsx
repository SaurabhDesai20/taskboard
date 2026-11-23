import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { MOCK_PROJECTS, MOCK_TASK_IDS, MOCK_USERS, startMockSession } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'

const { website, operations } = MOCK_PROJECTS
const ids = MOCK_TASK_IDS

function renderAs(who: keyof typeof MOCK_USERS, route = '/me/tasks') {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route })
}

/** The sections shown, each with its task keys. */
function groups() {
  return screen.queryAllByRole('region').map((section) => [
    section.querySelector('h2 span')?.textContent,
    within(section)
      .queryAllByRole('article')
      .map((article) => article.querySelector('.task-card__key')?.textContent),
  ])
}

describe('My tasks', () => {
  it('is linked from the header', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('asha', '/')

    await user.click(await screen.findByRole('link', { name: 'My tasks' }))

    expect(await screen.findByRole('heading', { level: 1, name: 'My tasks' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/me/tasks')
    expect(screen.getByRole('link', { name: 'My tasks' })).toHaveAttribute('aria-current', 'page')
  })

  it('groups my open tasks across workspaces: Overdue, Due this week, Later, No due date', async () => {
    renderAs('asha')

    await waitFor(() =>
      expect(groups()).toEqual([
        ['Overdue', ['WEB-3', 'OPS-1']],
        ['Due this week', ['WEB-5']],
        ['Later', ['WEB-7']],
        ['No due date', ['APP-1']],
      ]),
    )
    // Archived projects are left out by the server.
    expect(screen.queryByText('Export customer data')).not.toBeInTheDocument()

    const overdue = screen.getByRole('region', { name: 'Overdue' })
    expect(overdue.querySelector('.board-column__count')).toHaveTextContent('2 tasks')
    const rotate = within(overdue).getByRole('article', { name: 'Rotate API keys' })
    expect(within(rotate).getByText('Operations · Globex · To Do')).toBeInTheDocument()
    expect(within(rotate).getByText('Overdue')).toBeInTheDocument()
    expect(within(rotate).getByText('Urgent')).toBeInTheDocument()
    expect(within(rotate).getByRole('link', { name: 'Rotate API keys' })).toHaveAttribute(
      'href',
      `/w/globex/projects/${operations.id}?task=${ids.ops1}`,
    )
    expect(screen.getByRole('link', { name: 'Design pricing page' })).toHaveAttribute(
      'href',
      `/w/acme/projects/${website.id}?task=${ids.web3}`,
    )
  })

  it('asks the server for open tasks only', async () => {
    const searches: string[] = []
    server.use(
      http.get('/api/me/tasks', ({ request }) => {
        searches.push(new URL(request.url).search)
      }),
    )
    renderAs('ben')

    await waitFor(() => expect(groups().length).toBeGreaterThan(0))
    expect(searches).toEqual(['?status=todo&status=in_progress&status=in_review'])
    expect(screen.queryByText('Launch announcement')).not.toBeInTheDocument()
  })

  it('opens a task on its board with the drawer open', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('asha')

    await user.click(await screen.findByRole('link', { name: 'Rotate API keys' }))

    expect(await screen.findByRole('dialog', { name: 'Rotate API keys' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/w/globex/projects/${operations.id}`)
    expect(screen.getByRole('heading', { level: 1, name: 'Operations' })).toBeInTheDocument()
  })

  it('shows a task assigned on a board', async () => {
    const user = userEvent.setup()
    renderAs('asha', `/w/acme/projects/${website.id}?task=${ids.web2}`)
    const dialog = await screen.findByRole('dialog', { name: 'Write onboarding copy' })
    await waitFor(() => expect(within(dialog).getByRole('option', { name: 'Asha Rao' })).toBeInTheDocument())

    await user.selectOptions(within(dialog).getByLabelText('Assignee'), 'Asha Rao')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await within(dialog).findByRole('status')
    await user.keyboard('{Escape}')
    await user.click(screen.getByRole('link', { name: 'My tasks' }))

    const noDueDate = await screen.findByRole('region', { name: 'No due date' })
    expect(await within(noDueDate).findByRole('link', { name: 'Write onboarding copy' })).toBeInTheDocument()
    expect(within(noDueDate).getByRole('link', { name: 'Push notifications' })).toBeInTheDocument()
  })

  it('has an empty state', async () => {
    renderAs('eve')

    expect(await screen.findByText('Nothing assigned to you')).toBeInTheDocument()
    expect(screen.queryAllByRole('region')).toEqual([])
  })

  it('shows an error with a retry', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(
        '/api/me/tasks',
        () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom', details: {} } }, { status: 500 }),
        { once: true },
      ),
    )
    renderAs('asha')

    expect(await screen.findByRole('alert')).toHaveTextContent('Could not load your tasks. Boom')
    await user.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('region', { name: 'Overdue' })).toBeInTheDocument()
  })
})
