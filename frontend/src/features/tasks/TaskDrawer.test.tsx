import { fireEvent, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { TaskUpdate } from '../../api/types'
import { findTask, MOCK_PROJECTS, MOCK_TASK_IDS, MOCK_USERS, startMockSession } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'

const { website, legacy } = MOCK_PROJECTS
const ids = MOCK_TASK_IDS
const MISSING_ID = '40000000-0000-4000-8000-0000000000ff'
const BOARD = `/w/acme/projects/${website.id}`

function renderAs(who: keyof typeof MOCK_USERS, route = BOARD) {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route })
}

const card = (title: string) => screen.getByRole('article', { name: title })

async function openFromCard(user: ReturnType<typeof userEvent.setup>, title: string) {
  await user.click(await screen.findByRole('link', { name: title }))
  return screen.findByRole('dialog', { name: title })
}

/** Records the bodies of PATCH /tasks/{tid}, then lets the mock answer. */
function spyOnPatches(): TaskUpdate[] {
  const bodies: TaskUpdate[] = []
  server.use(
    http.patch('/api/tasks/:tid', async ({ request }) => {
      bodies.push((await request.clone().json()) as TaskUpdate)
    }),
  )
  return bodies
}

describe('opening and closing', () => {
  it('opens from a card into ?task=, focuses Close, and closes on Escape back to the card', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('ben')

    const dialog = await openFromCard(user, 'Fix login redirect')

    expect(router.state.location.search).toBe(`?task=${ids.web1}`)
    expect(dialog).toHaveAttribute('aria-modal', 'true')
    expect(within(dialog).getByRole('button', { name: 'Close task details' })).toHaveFocus()
    expect(within(dialog).getByText('WEB-1')).toBeInTheDocument()

    await user.keyboard('{Escape}')

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.search).toBe('')
    expect(within(card('Fix login redirect')).getByRole('link')).toHaveFocus()
  })

  it('opens straight from the URL, so it survives a refresh', async () => {
    renderAs('ben', `${BOARD}?task=${ids.web7}`)

    const dialog = await screen.findByRole('dialog', { name: 'Accessibility audit' })
    expect(within(dialog).getByLabelText('Description')).toHaveValue('Keyboard and screen reader pass over the signup flow.')
  })

  it('closes with the Close button', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('ben', `${BOARD}?task=${ids.web7}&status=in_progress`)

    const dialog = await screen.findByRole('dialog', { name: 'Accessibility audit' })
    await user.click(within(dialog).getByRole('button', { name: 'Close task details' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(router.state.location.search).toBe('?status=in_progress')
  })

  it.each([
    ['an unknown task', MISSING_ID],
    ['a malformed id', 'nope'],
    ['a task of another project', ids.app1],
    ['a task of a workspace I am not in', ids.ops1],
  ])('says "Task not found" for %s', async (_case, taskId) => {
    renderAs('chen', `${BOARD}?task=${taskId}`)

    const dialog = await screen.findByRole('dialog', { name: 'Task not found' })
    expect(within(dialog).getByText(/It does not exist/)).toBeInTheDocument()
  })
})

describe('editing', () => {
  it('saves only the changed fields and updates the board', async () => {
    const user = userEvent.setup()
    const patches = spyOnPatches()
    renderAs('ben')
    const dialog = await openFromCard(user, 'Write onboarding copy')

    const save = within(dialog).getByRole('button', { name: 'Save changes' })
    expect(save).toBeDisabled()

    await user.clear(within(dialog).getByLabelText('Title'))
    await user.type(within(dialog).getByLabelText('Title'), 'Write the onboarding copy')
    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'Urgent')
    await user.selectOptions(within(dialog).getByLabelText('Assignee'), 'Dana Kim')
    fireEvent.change(within(dialog).getByLabelText('Due date'), { target: { value: '2026-12-24' } })
    await user.type(within(dialog).getByLabelText('Description'), 'Three short screens.')
    await user.click(save)

    expect(await within(dialog).findByRole('status')).toHaveTextContent('Changes saved.')
    expect(patches).toEqual([
      {
        title: 'Write the onboarding copy',
        description: 'Three short screens.',
        priority: 'urgent',
        assignee_id: MOCK_USERS.dana.id,
        due_date: '2026-12-24',
      },
    ])
    expect(findTask(ids.web2)).toMatchObject({ title: 'Write the onboarding copy', priority: 'urgent', due_date: '2026-12-24' })
    expect(screen.getByRole('dialog', { name: 'Write the onboarding copy' })).toBeInTheDocument()
    expect(save).toBeDisabled()

    const updated = card('Write the onboarding copy')
    expect(within(updated).getByText('Urgent')).toBeInTheDocument()
    expect(within(updated).getByText('Assigned to Dana Kim')).toBeInTheDocument()
  })

  it('moves the task to another column by changing its status', async () => {
    const user = userEvent.setup()
    renderAs('ben')
    const dialog = await openFromCard(user, 'Write onboarding copy')

    await user.selectOptions(within(dialog).getByLabelText('Status'), 'Done')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await within(dialog).findByRole('status')
    await user.keyboard('{Escape}')

    const done = screen.getByRole('region', { name: 'Done' })
    await waitFor(() => expect(within(done).getByRole('article', { name: 'Write onboarding copy' })).toBeInTheDocument())
  })

  it('clears the due date and unassigns with null', async () => {
    const user = userEvent.setup()
    const patches = spyOnPatches()
    renderAs('ben', `${BOARD}?task=${ids.web1}`)
    const dialog = await screen.findByRole('dialog', { name: 'Fix login redirect' })

    await user.click(within(dialog).getByRole('button', { name: 'Clear due date' }))
    expect(within(dialog).getByLabelText('Due date')).toHaveValue('')
    await user.selectOptions(within(dialog).getByLabelText('Assignee'), 'Unassigned')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await within(dialog).findByRole('status')
    expect(patches).toEqual([{ assignee_id: null, due_date: null }])
    expect(findTask(ids.web1)).toMatchObject({ assignee_id: null, due_date: null })
  })

  it('checks the title before sending', async () => {
    const user = userEvent.setup()
    const patches = spyOnPatches()
    renderAs('ben', `${BOARD}?task=${ids.web1}`)
    const dialog = await screen.findByRole('dialog', { name: 'Fix login redirect' })

    await user.clear(within(dialog).getByLabelText('Title'))
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(within(dialog).getByLabelText('Title')).toHaveAccessibleDescription('Enter a task title')
    expect(within(dialog).getByLabelText('Title')).toHaveFocus()
    expect(patches).toEqual([])
  })

  it('shows a 422 on its field (assignee not a member)', async () => {
    const user = userEvent.setup()
    server.use(
      http.patch('/api/tasks/:tid', () =>
        HttpResponse.json(
          {
            error: {
              code: 'validation_error',
              message: 'Request validation failed',
              details: {
                errors: [{ field: 'assignee_id', location: 'body', message: 'Assignee must be a member of this workspace' }],
              },
            },
          },
          { status: 422 },
        ),
      ),
    )
    renderAs('ben', `${BOARD}?task=${ids.web2}`)
    const dialog = await screen.findByRole('dialog', { name: 'Write onboarding copy' })

    await user.selectOptions(within(dialog).getByLabelText('Assignee'), 'Chen Wei')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(within(dialog).getByLabelText('Assignee')).toHaveAccessibleDescription(
        'Assignee must be a member of this workspace',
      ),
    )
  })

  it('shows a 409 project_archived above the form', async () => {
    const user = userEvent.setup()
    server.use(
      http.patch('/api/tasks/:tid', () =>
        HttpResponse.json(
          {
            error: {
              code: 'conflict',
              message: 'This project is archived, so its tasks are read-only',
              details: { reason: 'project_archived' },
            },
          },
          { status: 409 },
        ),
      ),
    )
    renderAs('ben', `${BOARD}?task=${ids.web2}`)
    const dialog = await screen.findByRole('dialog', { name: 'Write onboarding copy' })

    await user.type(within(dialog).getByLabelText('Title'), '!')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('This project is archived, so its tasks are read-only')
  })
})

describe('read-only details', () => {
  it('shows viewers the details without a form', async () => {
    renderAs('chen', `${BOARD}?task=${ids.web1}`)
    const dialog = await screen.findByRole('dialog', { name: 'Fix login redirect' })

    expect(within(dialog).getByText('You have view-only access to this workspace.')).toBeInTheDocument()
    expect(within(dialog).getByText('Status').nextElementSibling).toHaveTextContent('In Progress')
    expect(within(dialog).getByText('Assignee').nextElementSibling).toHaveTextContent('Ben Okafor')
    expect(within(dialog).getByText('After login users land on /404 instead of the dashboard.')).toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox', { name: 'Title' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('textbox', { name: 'Description' })).not.toBeInTheDocument()
    // The only text box is the comment composer, disabled for viewers (see CommentsSection.test.tsx).
    expect(within(dialog).getByRole('textbox')).toBeDisabled()
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Delete task' })).not.toBeInTheDocument()
  })

  it('makes tasks of an archived project read-only, but admins can still delete them', async () => {
    renderAs('asha', `/w/acme/projects/${legacy.id}?task=${ids.crm1}`)
    const dialog = await screen.findByRole('dialog', { name: 'Export customer data' })

    expect(within(dialog).getByText('This project is archived, so its tasks are read-only.')).toBeInTheDocument()
    expect(within(dialog).getByText('Overdue')).toBeInTheDocument()
    expect(within(dialog).queryByRole('button', { name: 'Save changes' })).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete task' })).toBeInTheDocument()
  })
})

describe('deleting', () => {
  it('is offered to owners and admins only', async () => {
    renderAs('ben', `${BOARD}?task=${ids.web4}`)
    const dialog = await screen.findByRole('dialog', { name: 'Set up analytics' })

    expect(within(dialog).queryByRole('button', { name: 'Delete task' })).not.toBeInTheDocument()
  })

  it('asks first; Cancel goes back, Delete removes the task and closes the drawer', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('dana', `${BOARD}?task=${ids.web4}`)
    const dialog = await screen.findByRole('dialog', { name: 'Set up analytics' })

    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    let confirm = within(dialog).getByRole('group', { name: /Delete WEB-4\?/ })
    expect(within(confirm).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.click(within(confirm).getByRole('button', { name: 'Cancel' }))
    expect(within(dialog).getByRole('button', { name: 'Delete task' })).toHaveFocus()

    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    confirm = within(dialog).getByRole('group', { name: /Delete WEB-4\?/ })
    await user.click(within(confirm).getByRole('button', { name: 'Delete task' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(router.state.location.search).toBe('')
    expect(findTask(ids.web4)).toBeUndefined()
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Set up analytics' })).not.toBeInTheDocument())
  })

  it('shows a server error and keeps the drawer open', async () => {
    const user = userEvent.setup()
    server.use(
      http.delete('/api/tasks/:tid', () =>
        HttpResponse.json(
          { error: { code: 'forbidden', message: 'Only owners and admins can delete tasks', details: {} } },
          { status: 403 },
        ),
      ),
    )
    renderAs('dana', `${BOARD}?task=${ids.web4}`)
    const dialog = await screen.findByRole('dialog', { name: 'Set up analytics' })

    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    const confirm = within(dialog).getByRole('group', { name: /Delete WEB-4\?/ })
    await user.click(within(confirm).getByRole('button', { name: 'Delete task' }))

    expect(await within(confirm).findByRole('alert')).toHaveTextContent('Only owners and admins can delete tasks')
    expect(findTask(ids.web4)).toBeDefined()
  })
})
