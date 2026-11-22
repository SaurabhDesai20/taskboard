import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http } from 'msw'
import { describe, expect, it } from 'vitest'
import { todayDateOnly } from '../../lib/dates'
import { MOCK_PROJECTS, MOCK_TASK_IDS, MOCK_USERS, startMockSession } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'

const { website } = MOCK_PROJECTS
const BOARD = `/w/acme/projects/${website.id}`

function renderAs(who: keyof typeof MOCK_USERS, search = '') {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route: `${BOARD}${search}` })
}

/** Records the query string of every task list request, then lets the mock answer. */
function spyOnListRequests(): string[] {
  const searches: string[] = []
  server.use(
    http.get('/api/projects/:pid/tasks', ({ request }) => {
      searches.push(new URL(request.url).search)
    }),
  )
  return searches
}

const filterBar = () => screen.getByRole('search', { name: 'Filter tasks' })
const group = (name: string) => within(filterBar()).getByRole('group', { name })

/** Keys of every card on the board (or row in the list), in order. */
function shownKeys(): string[] {
  return Array.from(document.querySelectorAll('.task-card__key, .task-table__key')).map((element) => element.textContent ?? '')
}

const columnNames = () =>
  within(screen.getByRole('region', { name: 'Tasks' }))
    .queryAllByRole('heading', { level: 3 })
    .map((heading) => heading.firstChild?.textContent)

async function boardLoaded() {
  await waitFor(() => expect(shownKeys().length).toBeGreaterThan(0))
}

describe('filter bar', () => {
  it('filters by status: the URL and the request follow, and only those columns show', async () => {
    const user = userEvent.setup()
    const requests = spyOnListRequests()
    const { router } = renderAs('ben')
    await boardLoaded()

    await user.click(within(group('Status')).getByRole('checkbox', { name: 'Done' }))
    await user.click(within(group('Status')).getByRole('checkbox', { name: 'To Do' }))

    await waitFor(() => expect(router.state.location.search).toBe('?status=todo&status=done'))
    await waitFor(() => expect(shownKeys()).toEqual(['WEB-2', 'WEB-3', 'WEB-4', 'WEB-6']))
    expect(columnNames()).toEqual(['To Do', 'Done'])
    expect(requests).toContain('?status=todo&status=done')
  })

  it('filters by assignee, including Unassigned', async () => {
    const user = userEvent.setup()
    const requests = spyOnListRequests()
    const { router } = renderAs('ben')
    await boardLoaded()

    await user.selectOptions(within(filterBar()).getByLabelText('Assignee'), 'Unassigned')
    await waitFor(() => expect(shownKeys()).toEqual(['WEB-2']))
    expect(router.state.location.search).toBe('?assignee=none')
    expect(requests).toContain('?assignee_id=none')
    expect(within(screen.getByRole('region', { name: 'Done' })).getByText('No matching tasks')).toBeInTheDocument()

    await user.selectOptions(within(filterBar()).getByLabelText('Assignee'), 'Asha Rao')
    await waitFor(() => expect(shownKeys()).toEqual(['WEB-3', 'WEB-7', 'WEB-5']))
    expect(requests).toContain(`?assignee_id=${MOCK_USERS.asha.id}`)
  })

  it('filters by priority and due date', async () => {
    const user = userEvent.setup()
    const requests = spyOnListRequests()
    renderAs('ben')
    await boardLoaded()

    await user.click(within(group('Priority')).getByRole('checkbox', { name: 'High' }))
    await waitFor(() => expect(shownKeys()).toEqual(['WEB-3', 'WEB-1']))

    fireEvent.change(within(filterBar()).getByLabelText('Due on or before'), { target: { value: todayDateOnly() } })
    await waitFor(() => expect(shownKeys()).toEqual(['WEB-3']))
    expect(requests).toContain(`?priority=high&due_before=${todayDateOnly()}`)
  })

  it('searches after a pause in typing', async () => {
    const user = userEvent.setup()
    const requests = spyOnListRequests()
    const { router } = renderAs('ben')
    await boardLoaded()

    await user.type(within(filterBar()).getByLabelText('Search'), 'login ')

    await waitFor(() => expect(router.state.location.search).toBe('?q=login'))
    await waitFor(() => expect(shownKeys()).toEqual(['WEB-1']))
    // The trailing space the user typed stays in the box.
    expect(within(filterBar()).getByLabelText('Search')).toHaveValue('login ')
    // One request for the finished word, none per keystroke.
    expect(requests.filter((search) => search.includes('q='))).toEqual(['?q=login'])
  })

  it('starts from the filters in the URL', async () => {
    renderAs('ben', '?priority=high&q=page&status=todo')
    await boardLoaded()

    expect(shownKeys()).toEqual(['WEB-3'])
    expect(within(group('Priority')).getByRole('checkbox', { name: 'High' })).toBeChecked()
    expect(within(group('Status')).getByRole('checkbox', { name: 'To Do' })).toBeChecked()
    expect(within(filterBar()).getByLabelText('Search')).toHaveValue('page')
    expect(columnNames()).toEqual(['To Do'])
  })

  it('clears every filter at once, keeping the open task', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('ben', `?assignee=none&q=copy&task=${MOCK_TASK_IDS.web2}`)
    const dialog = await screen.findByRole('dialog', { name: 'Write onboarding copy' })
    await user.click(within(dialog).getByRole('button', { name: 'Close task details' }))

    await user.click(within(filterBar()).getByRole('button', { name: 'Clear filters' }))

    expect(router.state.location.search).toBe('')
    await waitFor(() => expect(shownKeys()).toHaveLength(7))
    expect(within(filterBar()).getByLabelText('Search')).toHaveValue('')
    expect(within(filterBar()).getByLabelText('Assignee')).toHaveValue('')
    expect(within(filterBar()).queryByRole('button', { name: 'Clear filters' })).not.toBeInTheDocument()
  })

  it('follows Back and Forward through the URL', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('ben')
    await boardLoaded()
    await user.click(within(screen.getByRole('group', { name: 'View' })).getByRole('button', { name: 'List' }))
    await user.type(within(filterBar()).getByLabelText('Search'), 'audit')
    await waitFor(() => expect(router.state.location.search).toBe('?view=list&q=audit'))

    await router.navigate(-1)

    await waitFor(() => expect(within(filterBar()).getByLabelText('Search')).toHaveValue(''))
    await waitFor(() => expect(shownKeys()).toHaveLength(7))
  })
})

describe('list view', () => {
  it('shows the same filtered tasks as a table, and the toggle lives in the URL', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('ben', '?status=todo&status=in_progress')
    await boardLoaded()
    const toggle = screen.getByRole('group', { name: 'View' })
    expect(within(toggle).getByRole('button', { name: 'Board' })).toHaveAttribute('aria-pressed', 'true')

    await user.click(within(toggle).getByRole('button', { name: 'List' }))

    expect(router.state.location.search).toBe('?status=todo&status=in_progress&view=list')
    expect(within(toggle).getByRole('button', { name: 'List' })).toHaveAttribute('aria-pressed', 'true')
    const table = screen.getByRole('table', { name: 'Tasks' })
    expect(within(table).getAllByRole('columnheader').map((header) => header.textContent)).toEqual([
      'Key',
      'Title',
      'Status',
      'Priority',
      'Assignee',
      'Due',
      'Comments',
    ])
    const rows = within(table).getAllByRole('row').slice(1)
    expect(rows.map((row) => within(row).getAllByRole('cell')[0].textContent)).toEqual([
      'WEB-2',
      'WEB-3',
      'WEB-4',
      'WEB-1',
      'WEB-7',
    ])
    const pricing = rows[1]
    expect(within(pricing).getByText('To Do')).toBeInTheDocument()
    expect(within(pricing).getByText('Asha Rao')).toBeInTheDocument()
    expect(within(pricing).getByText('Overdue')).toBeInTheDocument()
    expect(within(pricing).getAllByRole('cell').at(-1)).toHaveTextContent('0')
    expect(within(rows[3]).getAllByRole('cell').at(-1)).toHaveTextContent('2')
    expect(screen.queryByRole('region', { name: 'To Do' })).not.toBeInTheDocument()
  })

  it('opens the drawer from a row and keeps the view', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('ben', '?view=list')
    const table = await screen.findByRole('table', { name: 'Tasks' })

    await user.click(within(table).getByRole('link', { name: 'Set up analytics' }))

    expect(await screen.findByRole('dialog', { name: 'Set up analytics' })).toBeInTheDocument()
    expect(router.state.location.search).toBe(`?view=list&task=${MOCK_TASK_IDS.web4}`)
  })

  it('says when nothing matches', async () => {
    renderAs('ben', '?view=list&q=nothing-like-this')

    expect(await screen.findByText('No tasks match the filters')).toBeInTheDocument()
    expect(screen.queryByRole('table')).not.toBeInTheDocument()
  })
})
