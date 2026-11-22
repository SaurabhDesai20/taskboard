import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { TaskMoveRequest } from '../../api/types'
import { addDays, formatDateOnly, todayDateOnly } from '../../lib/dates'
import { columnKeys, findProject, MOCK_PROJECTS, MOCK_TASK_IDS, MOCK_USERS, startMockSession, tasksOf } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'
import { findToast, liveRegionOf } from '../../test/toasts'

const { website, legacy } = MOCK_PROJECTS
const ids = MOCK_TASK_IDS

function renderBoardAs(who: keyof typeof MOCK_USERS, projectId: string = website.id) {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route: `/w/acme/projects/${projectId}` })
}

const column = (name: string) => screen.getByRole('region', { name })

/** The task keys shown in a column, top to bottom. */
function keysIn(name: string): string[] {
  return within(column(name))
    .queryAllByRole('article')
    .map((card) => card.querySelector('.task-card__key')?.textContent ?? '')
}

function countIn(name: string): string | null | undefined {
  return column(name).querySelector('.board-column__count')?.textContent
}

const card = (title: string) => screen.getByRole('article', { name: title })

async function boardLoaded() {
  await waitFor(() => expect(keysIn('To Do').length).toBeGreaterThan(0))
}

describe('board', () => {
  it('shows the four columns with their counts and the cards in position order', async () => {
    renderBoardAs('ben')
    await boardLoaded()

    const tasks = screen.getByRole('region', { name: 'Tasks' })
    expect(within(tasks).getAllByRole('heading', { level: 3 }).map((heading) => heading.firstChild?.textContent)).toEqual([
      'To Do',
      'In Progress',
      'In Review',
      'Done',
    ])
    expect(keysIn('To Do')).toEqual(['WEB-2', 'WEB-3', 'WEB-4'])
    expect(keysIn('In Progress')).toEqual(['WEB-1', 'WEB-7'])
    expect(keysIn('In Review')).toEqual(['WEB-5'])
    expect(keysIn('Done')).toEqual(['WEB-6'])
    expect(countIn('To Do')).toBe('3 tasks')
    expect(countIn('In Review')).toBe('1 task')
  })

  it('shows key, title, priority, assignee and due date on a card; the title opens the drawer', async () => {
    renderBoardAs('ben')
    await boardLoaded()

    const fix = card('Fix login redirect')
    expect(within(fix).getByText('WEB-1')).toBeInTheDocument()
    expect(within(fix).getByText('High')).toHaveTextContent('Priority: High')
    expect(within(fix).getByText('BO')).toHaveAttribute('title', 'Ben Okafor')
    expect(within(fix).getByText('Assigned to Ben Okafor')).toBeInTheDocument()
    expect(within(fix).getByText(formatDateOnly(addDays(todayDateOnly(), 9)))).toBeInTheDocument()
    expect(within(fix).getByRole('link', { name: 'Fix login redirect' })).toHaveAttribute('href', `/w/acme/projects/${website.id}?task=${ids.web1}`)
    expect(within(card('Write onboarding copy')).getByText('Unassigned')).toBeInTheDocument()
  })

  it('marks overdue cards: due before today and not done', async () => {
    renderBoardAs('ben')
    await boardLoaded()

    const overdue = card('Design pricing page')
    expect(overdue).toHaveClass('task-card--overdue')
    expect(within(overdue).getByText('Overdue')).toBeInTheDocument()
    // Due today is not overdue yet; a done task is never overdue.
    for (const title of ['Review signup form', 'Launch announcement', 'Set up analytics']) {
      expect(card(title)).not.toHaveClass('task-card--overdue')
      expect(within(card(title)).queryByText('Overdue')).not.toBeInTheDocument()
    }
  })

  it('shows loading, then an error with a retry', async () => {
    const user = userEvent.setup()
    server.use(
      http.get(
        '/api/projects/:pid/tasks',
        () => HttpResponse.json({ error: { code: 'internal_error', message: 'Boom', details: {} } }, { status: 500 }),
        { once: true },
      ),
    )
    renderBoardAs('ben')

    const tasks = await screen.findByRole('region', { name: 'Tasks' })
    expect(await within(tasks).findByRole('alert')).toHaveTextContent('Could not load the tasks. Boom')
    await user.click(within(tasks).getByRole('button', { name: 'Try again' }))
    await boardLoaded()
  })

  it('shows empty columns for a project without tasks', async () => {
    const project = findProject(website.id)
    if (!project) throw new Error('seed changed')
    for (const task of tasksOf(website.id)) task.project_id = 'gone'
    renderBoardAs('ben')

    await waitFor(() => expect(within(column('To Do')).getByText('No tasks')).toBeInTheDocument())
    expect(countIn('Done')).toBe('0 tasks')
  })
})

describe('permissions', () => {
  it.each(['asha', 'dana', 'ben'] as const)('%s (member and up) can move and add tasks', async (who) => {
    renderBoardAs(who)
    await boardLoaded()

    expect(screen.getAllByRole('button', { name: /^Move WEB-/ })).toHaveLength(7)
    expect(screen.getAllByRole('button', { name: /^Add task to / })).toHaveLength(4)
  })

  it('gives viewers a read-only board: no dragging, moving or adding', async () => {
    renderBoardAs('chen')
    await boardLoaded()

    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Add task/ })).not.toBeInTheDocument()
    expect(document.querySelector('.board-column__item--movable')).toBeNull()
    // The cards still open the drawer.
    expect(within(card('Fix login redirect')).getByRole('link')).toBeInTheDocument()
  })

  it('makes an archived project read-only for everyone, with the banner', async () => {
    renderBoardAs('asha', legacy.id)

    expect(await screen.findByRole('note')).toHaveTextContent('This project is read-only')
    await waitFor(() => expect(keysIn('To Do')).toEqual(['CRM-1']))
    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Add task/ })).not.toBeInTheDocument()
    // Overdue still shows on a read-only board.
    expect(within(card('Export customer data')).getByText('Overdue')).toBeInTheDocument()
  })
})

describe('creating a task inline', () => {
  it('adds a task at the end of the column; Enter submits and the form stays open for the next one', async () => {
    const user = userEvent.setup()
    renderBoardAs('ben')
    await boardLoaded()

    await user.click(screen.getByRole('button', { name: 'Add task to In Review' }))
    const input = screen.getByLabelText('Title of the new task in In Review')
    expect(input).toHaveFocus()

    await user.type(input, '  Polish footer {Enter}')

    await waitFor(() => expect(keysIn('In Review')).toEqual(['WEB-5', 'WEB-8']))
    expect(card('Polish footer')).toBeInTheDocument()
    expect(columnKeys(website.id).in_review).toEqual(['WEB-5', 'WEB-8'])
    expect(input).toHaveValue('')
    expect(input).toHaveFocus()
    expect(countIn('In Review')).toBe('2 tasks')
  })

  it('requires a title', async () => {
    const user = userEvent.setup()
    renderBoardAs('ben')
    await boardLoaded()

    await user.click(screen.getByRole('button', { name: 'Add task to To Do' }))
    await user.keyboard('{Enter}')

    expect(screen.getByLabelText('Title of the new task in To Do')).toHaveAccessibleDescription('Enter a task title')
    expect(keysIn('To Do')).toHaveLength(3)
  })

  it('closes on Escape and gives focus back to "Add task"', async () => {
    const user = userEvent.setup()
    renderBoardAs('ben')
    await boardLoaded()

    await user.click(screen.getByRole('button', { name: 'Add task to Done' }))
    await user.type(screen.getByLabelText('Title of the new task in Done'), 'Draft')
    await user.keyboard('{Escape}')

    expect(screen.queryByLabelText('Title of the new task in Done')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add task to Done' })).toHaveFocus()
  })

  it('shows a server error', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/projects/:pid/tasks', () =>
        HttpResponse.json(
          { error: { code: 'forbidden', message: 'Only owners, admins and members can create tasks', details: {} } },
          { status: 403 },
        ),
      ),
    )
    renderBoardAs('ben')
    await boardLoaded()

    await user.click(screen.getByRole('button', { name: 'Add task to To Do' }))
    await user.type(screen.getByLabelText('Title of the new task in To Do'), 'Nope{Enter}')

    expect(await within(column('To Do')).findByRole('alert')).toHaveTextContent('Only owners, admins and members')
  })
})

describe('moving with the keyboard menu', () => {
  async function chooseMove(user: ReturnType<typeof userEvent.setup>, key: string, option: string) {
    await user.click(screen.getByRole('button', { name: `Move ${key}` }))
    const menu = screen.getByRole('list', { name: `Move ${key}` })
    await user.click(within(menu).getByRole('button', { name: option }))
  }

  it('lists the moves for a card and closes on Escape', async () => {
    const user = userEvent.setup()
    renderBoardAs('ben')
    await boardLoaded()

    const toggle = screen.getByRole('button', { name: 'Move WEB-2' })
    await user.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')
    const menu = screen.getByRole('list', { name: 'Move WEB-2' })
    expect(within(menu).getAllByRole('button').map((button) => button.textContent)).toEqual([
      'Move down',
      'Move to top of In Progress',
      'Move to bottom of In Progress',
      'Move to top of In Review',
      'Move to bottom of In Review',
      'Move to top of Done',
      'Move to bottom of Done',
    ])

    await user.keyboard('{Escape}')
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    expect(toggle).toHaveFocus()
  })

  it('moves a card to another column, saves the order, and keeps focus on its Move button', async () => {
    const user = userEvent.setup()
    renderBoardAs('ben')
    await boardLoaded()

    await chooseMove(user, 'WEB-2', 'Move to top of In Progress')

    await waitFor(() => expect(keysIn('In Progress')).toEqual(['WEB-2', 'WEB-1', 'WEB-7']))
    expect(keysIn('To Do')).toEqual(['WEB-3', 'WEB-4'])
    await waitFor(() => expect(columnKeys(website.id).in_progress).toEqual(['WEB-2', 'WEB-1', 'WEB-7']))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Move WEB-2' })).toHaveFocus())
    expect(countIn('In Progress')).toBe('3 tasks')
  })

  it('moves a card up and down within its column', async () => {
    const user = userEvent.setup()
    renderBoardAs('ben')
    await boardLoaded()

    await chooseMove(user, 'WEB-4', 'Move up')
    await waitFor(() => expect(keysIn('To Do')).toEqual(['WEB-2', 'WEB-4', 'WEB-3']))
    await waitFor(() => expect(columnKeys(website.id).todo).toEqual(['WEB-2', 'WEB-4', 'WEB-3']))

    await chooseMove(user, 'WEB-2', 'Move down')
    await waitFor(() => expect(keysIn('To Do')).toEqual(['WEB-4', 'WEB-2', 'WEB-3']))
    await waitFor(() => expect(columnKeys(website.id).todo).toEqual(['WEB-4', 'WEB-2', 'WEB-3']))
  })

  it('shows the move at once, then rolls it back and says why when the server fails', async () => {
    const user = userEvent.setup()
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    const sent: TaskMoveRequest[] = []
    server.use(
      http.post('/api/tasks/:tid/move', async ({ request }) => {
        sent.push((await request.json()) as TaskMoveRequest)
        await gate
        return HttpResponse.json(
          { error: { code: 'internal_error', message: 'Database hiccup', details: {} } },
          { status: 500 },
        )
      }),
    )
    renderBoardAs('ben')
    await boardLoaded()

    await chooseMove(user, 'WEB-2', 'Move to bottom of Done')

    // Optimistic: the card is in Done before the server has answered.
    await waitFor(() => expect(keysIn('Done')).toEqual(['WEB-6', 'WEB-2']))
    expect(keysIn('To Do')).toEqual(['WEB-3', 'WEB-4'])
    expect(sent).toEqual([{ status: 'done', after_task_id: ids.web6, before_task_id: null }])

    release()

    const toast = await findToast('Could not move WEB-2. Database hiccup')
    expect(liveRegionOf(toast)).toBe('assertive')
    await waitFor(() => expect(keysIn('To Do')).toEqual(['WEB-2', 'WEB-3', 'WEB-4']))
    expect(keysIn('Done')).toEqual(['WEB-6'])
    expect(columnKeys(website.id).todo).toEqual(['WEB-2', 'WEB-3', 'WEB-4'])
  })

  it('rolls back when the project was archived meanwhile, and the board turns read-only', async () => {
    const user = userEvent.setup()
    renderBoardAs('asha')
    await boardLoaded()
    const project = findProject(website.id)
    if (!project) throw new Error('seed changed')
    project.archived_at = '2026-11-22T12:00:00Z'

    await chooseMove(user, 'WEB-3', 'Move to top of Done')

    expect(await findToast(/^Could not move WEB-3\. This project is archived/)).toBeInTheDocument()
    await waitFor(() => expect(keysIn('To Do')).toEqual(['WEB-2', 'WEB-3', 'WEB-4']))
    expect(await screen.findByRole('note')).toHaveTextContent('This project is read-only')
    await waitFor(() => expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument())
  })
})

describe('loading', () => {
  it('shows a board-shaped skeleton (one placeholder column per shown status) while the tasks load', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.get('/api/projects/:pid/tasks', async () => {
        await gate
        return undefined
      }),
    )
    startMockSession(MOCK_USERS.ben.id)
    renderRoute({ route: `/w/acme/projects/${website.id}?status=todo&status=done` })

    const tasks = await screen.findByRole('region', { name: 'Tasks' })
    const status = await within(tasks).findByRole('status')
    expect(status).toHaveTextContent('Loading tasks...')
    expect(status.querySelectorAll('.board-column')).toHaveLength(2)
    // Placeholders are not real columns: no regions, cards or buttons yet.
    expect(within(tasks).queryByRole('region')).not.toBeInTheDocument()

    release()
    await waitFor(() => expect(keysIn('To Do')).toEqual(['WEB-2', 'WEB-3', 'WEB-4']))
    expect(within(tasks).queryByText('Loading tasks...')).not.toBeInTheDocument()
  })
})
