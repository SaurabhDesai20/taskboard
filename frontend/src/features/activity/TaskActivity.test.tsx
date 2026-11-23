import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { addDays, formatDateOnly, todayDateOnly } from '../../lib/dates'
import { createTask, MOCK_PROJECTS, MOCK_TASK_IDS, MOCK_USERS, startMockSession } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'

const { website } = MOCK_PROJECTS
const ids = MOCK_TASK_IDS
const ACTIVITY_API = '/api/workspaces/:wid/activity'

function openTask(who: keyof typeof MOCK_USERS, taskId: string) {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route: `/w/acme/projects/${website.id}?task=${taskId}` })
}

/** Records the URLs of the activity requests, then lets the mock answer. */
function spyOnFeedRequests(): URL[] {
  const urls: URL[] = []
  server.use(
    http.get(ACTIVITY_API, ({ request }) => {
      urls.push(new URL(request.url))
    }),
  )
  return urls
}

const messages = (list: HTMLElement) =>
  Array.from(list.querySelectorAll(':scope > li .activity-item__message')).map((item) => item.textContent)

async function openActivityTab(user: ReturnType<typeof userEvent.setup>, title: string) {
  const dialog = await screen.findByRole('dialog', { name: title })
  await user.click(within(dialog).getByRole('tab', { name: 'Activity' }))
  return dialog
}

const WEB1_HISTORY = [
  'Asha Rao edited a comment on WEB-1 Fix login redirect: "Thanks! Can you check Safari too? It may be the same cookie issue."',
  'Asha Rao commented on WEB-1 Fix login redirect: "Thanks! Can you check Safari too?"',
  'Ben Okafor commented on WEB-1 Fix login redirect: "Reproduced on Chrome and Firefox."',
  'Ben Okafor moved WEB-1 Fix login redirect from To Do to In Progress',
  `Asha Rao set the due date of WEB-1 Fix login redirect to ${formatDateOnly(addDays(todayDateOnly(), 9))}`,
  'Asha Rao assigned WEB-1 Fix login redirect to Ben Okafor',
  'Asha Rao created WEB-1 Fix login redirect in To Do',
]

describe('Comments | Activity tabs in the task drawer', () => {
  it('opens on Comments and loads no activity until the Activity tab is chosen', async () => {
    const requests = spyOnFeedRequests()
    openTask('chen', ids.web1)
    const dialog = await screen.findByRole('dialog', { name: 'Fix login redirect' })

    const tablist = within(dialog).getByRole('tablist', { name: 'Comments and activity' })
    const [comments, activity] = within(tablist).getAllByRole('tab')
    expect(comments).toHaveAccessibleName('Comments')
    expect(comments).toHaveAttribute('aria-selected', 'true')
    expect(comments).toHaveAttribute('tabindex', '0')
    expect(activity).toHaveAccessibleName('Activity')
    expect(activity).toHaveAttribute('aria-selected', 'false')
    expect(activity).toHaveAttribute('tabindex', '-1')
    const panel = within(dialog).getByRole('tabpanel', { name: 'Comments' })
    expect(comments).toHaveAttribute('aria-controls', panel.id)
    expect(within(panel).getByRole('region', { name: /^Comments/ })).toBeInTheDocument()
    expect(requests).toHaveLength(0)
  })

  it("shows the task's history, newest first, without links", async () => {
    const user = userEvent.setup()
    const requests = spyOnFeedRequests()
    openTask('chen', ids.web1)

    const dialog = await openActivityTab(user, 'Fix login redirect')

    const panel = within(dialog).getByRole('tabpanel', { name: 'Activity' })
    const list = await within(panel).findByRole('list', { name: 'Activity of WEB-1' })
    expect(messages(list)).toEqual(WEB1_HISTORY)
    expect(within(list).queryByRole('link')).not.toBeInTheDocument()
    expect(within(panel).getByText('No older activity.')).toBeInTheDocument()
    expect(requests[0].searchParams.get('task_id')).toBe(ids.web1)
    // The comments are hidden, not gone.
    expect(within(dialog).queryByRole('tabpanel', { name: 'Comments' })).not.toBeInTheDocument()
    expect(dialog.querySelector('.comments')).not.toBeNull()
  })

  it('moves between tabs with the arrow keys, Home and End', async () => {
    const user = userEvent.setup()
    openTask('ben', ids.web1)
    const dialog = await screen.findByRole('dialog', { name: 'Fix login redirect' })
    const comments = within(dialog).getByRole('tab', { name: 'Comments' })
    const activity = within(dialog).getByRole('tab', { name: 'Activity' })
    comments.focus()

    await user.keyboard('{ArrowRight}')
    expect(activity).toHaveFocus()
    expect(activity).toHaveAttribute('aria-selected', 'true')
    expect(within(dialog).getByRole('tabpanel', { name: 'Activity' })).toBeInTheDocument()

    await user.keyboard('{ArrowRight}')
    expect(comments).toHaveFocus()
    expect(comments).toHaveAttribute('aria-selected', 'true')

    await user.keyboard('{ArrowLeft}')
    expect(activity).toHaveFocus()
    await user.keyboard('{Home}')
    expect(comments).toHaveFocus()
    await user.keyboard('{End}')
    expect(activity).toHaveFocus()
    expect(activity).toHaveAttribute('aria-selected', 'true')
  })

  it('shows changes saved in the drawer in the open Activity tab', async () => {
    const user = userEvent.setup()
    openTask('ben', ids.web1)
    const dialog = await openActivityTab(user, 'Fix login redirect')
    const list = await within(dialog).findByRole('list', { name: 'Activity of WEB-1' })

    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'Urgent')
    await user.selectOptions(within(dialog).getByLabelText('Status'), 'Done')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() =>
      expect(messages(list).slice(0, 2)).toEqual([
        'Ben Okafor moved WEB-1 Fix login redirect from In Progress to Done',
        'Ben Okafor updated the priority of WEB-1 Fix login redirect',
      ]),
    )
    expect(messages(list).slice(2)).toEqual(WEB1_HISTORY)
  })

  it('keeps a comment draft across tabs, and a posted comment shows up in Activity', async () => {
    const user = userEvent.setup()
    openTask('ben', ids.web1)
    const dialog = await screen.findByRole('dialog', { name: 'Fix login redirect' })
    await user.type(within(dialog).getByRole('textbox', { name: 'Add a comment' }), 'Safari too.')

    await user.click(within(dialog).getByRole('tab', { name: 'Activity' }))
    await within(dialog).findByRole('list', { name: 'Activity of WEB-1' })
    await user.click(within(dialog).getByRole('tab', { name: 'Comments' }))
    expect(within(dialog).getByRole('textbox', { name: 'Add a comment' })).toHaveValue('Safari too.')

    await user.click(within(dialog).getByRole('button', { name: 'Post comment' }))
    await within(dialog).findByRole('heading', { name: 'Comments (3)' })
    await user.click(within(dialog).getByRole('tab', { name: 'Activity' }))

    const list = within(dialog).getByRole('list', { name: 'Activity of WEB-1' })
    await waitFor(() => expect(messages(list)[0]).toBe('Ben Okafor commented on WEB-1 Fix login redirect: "Safari too."'))
  })

  it('says when a task has no activity', async () => {
    const user = userEvent.setup()
    const task = createTask({
      project_id: website.id,
      workspace_id: website.workspace_id,
      title: 'Quiet task',
      description: null,
      status: 'todo',
      priority: 'low',
      position: 9000,
      assignee_id: null,
      due_date: null,
      created_by: MOCK_USERS.asha.id,
    })
    openTask('ben', task.id)

    const dialog = await openActivityTab(user, 'Quiet task')

    expect(await within(dialog).findByText('No activity yet.')).toBeInTheDocument()
  })

  it('shows a load error with Try again', async () => {
    const user = userEvent.setup()
    let failing = true
    server.use(
      http.get(ACTIVITY_API, () =>
        failing
          ? HttpResponse.json({ error: { code: 'internal_error', message: 'Server exploded', details: {} } }, { status: 500 })
          : undefined,
      ),
    )
    openTask('ben', ids.web1)
    const dialog = await openActivityTab(user, 'Fix login redirect')

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Could not load the activity. Server exploded')
    failing = false
    await user.click(within(dialog).getByRole('button', { name: 'Try again' }))

    const list = await within(dialog).findByRole('list', { name: 'Activity of WEB-1' })
    expect(messages(list)).toEqual(WEB1_HISTORY)
  })
})
