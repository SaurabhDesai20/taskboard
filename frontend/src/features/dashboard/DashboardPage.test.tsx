import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { MyTask } from '../../api/types'
import { addDays, todayDateOnly } from '../../lib/dates'
import { MOCK_PROJECTS, MOCK_TASK_IDS, MOCK_USERS, MOCK_WORKSPACES, startMockSession } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'
import { DASHBOARD_TASK_LIMIT } from '../tasks/MyDueTasks'

const { website, operations } = MOCK_PROJECTS
const ids = MOCK_TASK_IDS

function renderDashboardAs(who: keyof typeof MOCK_USERS) {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route: '/' })
}

const group = (name: string) => screen.getByRole('region', { name })

/** The task keys in a dashboard group, top to bottom. */
const keysIn = (name: string) =>
  within(group(name))
    .queryAllByRole('article')
    .map((article) => article.querySelector('.task-card__key')?.textContent)

async function tasksLoaded() {
  await waitFor(() => expect(screen.getByRole('region', { name: 'Overdue' })).toBeInTheDocument())
}

/** A task assigned to me, as `GET /me/tasks` returns it. */
function myTask(n: number, dueDate: string): MyTask {
  return {
    id: `40000000-0000-4000-8000-${String(100 + n).padStart(12, '0')}`,
    project_id: website.id,
    workspace_id: MOCK_WORKSPACES.acme.id,
    number: 100 + n,
    key: `WEB-${100 + n}`,
    title: `Old chore ${n}`,
    description: null,
    status: 'todo',
    priority: 'low',
    position: 1024 * n,
    assignee: { id: MOCK_USERS.asha.id, name: MOCK_USERS.asha.name },
    due_date: dueDate,
    comment_count: 0,
    created_by: MOCK_USERS.asha.id,
    created_at: '2026-11-22T09:00:00Z',
    updated_at: '2026-11-22T09:00:00Z',
    project: { id: website.id, name: website.name, key: website.key },
    workspace: { id: MOCK_WORKSPACES.acme.id, name: 'Acme', slug: 'acme' },
  }
}

describe('dashboard', () => {
  it('shows my overdue and due-this-week tasks above my workspaces', async () => {
    renderDashboardAs('asha')

    expect(await screen.findByRole('heading', { level: 1, name: 'Dashboard' })).toBeInTheDocument()
    await tasksLoaded()
    // Open tasks only, from every workspace; archived projects (CRM-1) are left out by the server.
    expect(keysIn('Overdue')).toEqual(['WEB-3', 'OPS-1'])
    expect(keysIn('Due this week')).toEqual(['WEB-5'])
    expect(group('Overdue').querySelector('.board-column__count')).toHaveTextContent('2 tasks')
    // Later and undated tasks are on My Tasks only.
    expect(screen.queryByText('Accessibility audit')).not.toBeInTheDocument()
    expect(screen.queryByText('Push notifications')).not.toBeInTheDocument()

    const rotate = within(group('Overdue')).getByRole('article', { name: 'Rotate API keys' })
    expect(within(rotate).getByText('Overdue')).toBeInTheDocument()
    expect(within(rotate).getByRole('link', { name: 'Rotate API keys' })).toHaveAttribute(
      'href',
      `/w/globex/projects/${operations.id}?task=${ids.ops1}`,
    )
    expect(screen.getByRole('link', { name: 'All my tasks' })).toHaveAttribute('href', '/me/tasks')

    // Tasks first, then the workspaces.
    const myTasks = screen.getByRole('region', { name: 'My tasks' })
    const workspaces = screen.getByRole('region', { name: 'Your workspaces' })
    expect(myTasks.compareDocumentPosition(workspaces) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(await within(workspaces).findByRole('link', { name: /Acme/ })).toBeInTheDocument()
    expect(document.title).toBe('Dashboard · TaskBoard')
  })

  it('keeps the heading levels in order: h1, then h2 sections, h3 groups, h4 tasks', async () => {
    renderDashboardAs('asha')
    await tasksLoaded()

    const main = screen.getByRole('main')
    expect(within(main).getByRole('heading', { level: 1 })).toHaveTextContent('Dashboard')
    expect(within(main).getAllByRole('heading', { level: 2 }).map((heading) => heading.textContent)).toEqual([
      'My tasks',
      'Your workspaces',
    ])
    expect(within(group('Due this week')).getByRole('heading', { level: 4, name: 'Review signup form' })).toBeInTheDocument()
  })

  it('opens a task on its board with the drawer open', async () => {
    const user = userEvent.setup()
    const { router } = renderDashboardAs('asha')
    await tasksLoaded()

    await user.click(within(group('Due this week')).getByRole('link', { name: 'Review signup form' }))

    expect(await screen.findByRole('dialog', { name: 'Review signup form' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe(`/w/acme/projects/${website.id}`)
    expect(router.state.location.search).toBe(`?task=${ids.web5}`)
  })

  it('says when nothing is overdue or due this week', async () => {
    renderDashboardAs('eve')
    await tasksLoaded()

    expect(within(group('Overdue')).getByText('Nothing overdue')).toBeInTheDocument()
    expect(within(group('Due this week')).getByText('Nothing due in the next 7 days')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'No workspaces yet' })).toBeInTheDocument()
  })

  it(`lists ${DASHBOARD_TASK_LIMIT} tasks per group and links to the rest`, async () => {
    const overdue = Array.from({ length: DASHBOARD_TASK_LIMIT + 2 }, (_, n) => myTask(n, addDays(todayDateOnly(), -3)))
    server.use(http.get('/api/me/tasks', () => HttpResponse.json(overdue)))
    renderDashboardAs('asha')
    await tasksLoaded()

    expect(keysIn('Overdue')).toHaveLength(DASHBOARD_TASK_LIMIT)
    expect(group('Overdue').querySelector('.board-column__count')).toHaveTextContent(`${DASHBOARD_TASK_LIMIT + 2} tasks`)
    expect(within(group('Overdue')).getByRole('link', { name: 'See 2 more in My tasks' })).toHaveAttribute(
      'href',
      '/me/tasks',
    )
  })

  it('shows a skeleton while loading, then an error with a retry', async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get(
        '/api/me/tasks',
        async () => {
          await gate
          return HttpResponse.json({ error: { code: 'internal_error', message: 'Boom', details: {} } }, { status: 500 })
        },
        { once: true },
      ),
    )
    renderDashboardAs('asha')

    const myTasks = await screen.findByRole('region', { name: 'My tasks' })
    expect(within(myTasks).getByRole('status')).toHaveTextContent('Loading your tasks...')
    release()

    expect(await within(myTasks).findByRole('alert')).toHaveTextContent('Could not load your tasks. Boom')
    await user.click(within(myTasks).getByRole('button', { name: 'Try again' }))
    await tasksLoaded()
    expect(keysIn('Overdue')).toEqual(['WEB-3', 'OPS-1'])
  })
})
