// Where focus goes when the element that had it disappears (a removed member, a deleted task, a
// dialog closed by a role change), and the toasts that confirm the main changes.
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { findMembership, findProject, MOCK_PROJECTS, MOCK_TASK_IDS, MOCK_USERS, MOCK_WORKSPACES, setMockMembership, startMockSession } from '../mocks/db'
import { server } from '../mocks/server'
import { renderRoute } from '../test/render'
import { findToast, liveRegionOf, toasts } from '../test/toasts'

const { acme } = MOCK_WORKSPACES
const { website } = MOCK_PROJECTS
const BOARD = `/w/acme/projects/${website.id}`

function renderAs(who: keyof typeof MOCK_USERS, route: string) {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route })
}

describe('focus after the focused element goes away', () => {
  it('removing a member: focus moves to the Members heading, and a toast confirms it', async () => {
    const user = userEvent.setup()
    renderAs('asha', '/w/acme/settings')
    const table = await screen.findByRole('table', { name: 'Members of Acme' })

    await user.click(within(table).getByRole('button', { name: 'Remove Chen Wei' }))
    await user.click(within(screen.getByRole('dialog', { name: 'Remove Chen Wei?' })).getByRole('button', { name: 'Remove member' }))

    const toast = await findToast('Removed Chen Wei from the workspace.')
    expect(liveRegionOf(toast)).toBe('polite')
    await waitFor(() => expect(within(table).queryByRole('rowheader', { name: 'Chen Wei' })).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 2, name: 'Members' })).toHaveFocus()
    expect(findMembership(acme.id, MOCK_USERS.chen.id)).toBeUndefined()
  })

  it('deleting a task from the drawer: focus moves to the Tasks heading, and a toast confirms it', async () => {
    const user = userEvent.setup()
    renderAs('dana', BOARD)
    await user.click(await screen.findByRole('link', { name: 'Set up analytics' }))
    const dialog = await screen.findByRole('dialog', { name: 'Set up analytics' })

    await user.click(within(dialog).getByRole('button', { name: 'Delete task' }))
    const confirm = within(dialog).getByRole('group', { name: /Delete WEB-4\?/ })
    await user.click(within(confirm).getByRole('button', { name: 'Delete task' }))

    expect(await findToast('Deleted WEB-4.')).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    await waitFor(() => expect(screen.queryByRole('article', { name: 'Set up analytics' })).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 2, name: 'Tasks' })).toHaveFocus()
  })

  it('closing the drawer normally still returns focus to the card that opened it', async () => {
    const user = userEvent.setup()
    renderAs('dana', BOARD)
    const link = await screen.findByRole('link', { name: 'Set up analytics' })
    await user.click(link)
    await screen.findByRole('dialog', { name: 'Set up analytics' })

    await user.keyboard('{Escape}')

    expect(screen.getByRole('link', { name: 'Set up analytics' })).toHaveFocus()
  })

  it('an edit dialog closed by a demotion: focus moves to the Projects heading, not the page body', async () => {
    const user = userEvent.setup()
    renderAs('dana', '/w/acme')
    const region = await screen.findByRole('region', { name: 'Projects' })
    await user.click(await within(region).findByRole('button', { name: 'Edit Website' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit project' })
    // Someone demotes Dana meanwhile: saving gets a 403, the role is refetched, the dialog closes
    // and the Edit button that opened it disappears.
    setMockMembership(acme.id, MOCK_USERS.dana.id, 'member')

    await user.clear(within(dialog).getByLabelText('Name'))
    await user.type(within(dialog).getByLabelText('Name'), 'Web')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(within(region).queryByRole('button', { name: 'Edit Website' })).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 2, name: 'Projects' })).toHaveFocus()
    expect(findProject(website.id)?.name).toBe('Website')
  })

  it('a project dialog closed by a demotion on the project page: focus moves to the page heading', async () => {
    const user = userEvent.setup()
    renderAs('dana', BOARD)
    await user.click(await screen.findByRole('button', { name: 'Archive project' }))
    const dialog = screen.getByRole('dialog', { name: 'Archive Website?' })
    setMockMembership(acme.id, MOCK_USERS.dana.id, 'viewer')

    await user.click(within(dialog).getByRole('button', { name: 'Archive project' }))

    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(screen.getByRole('heading', { level: 1, name: 'Website' })).toHaveFocus()
  })
})

describe('toasts for the main changes', () => {
  it('creating a project', async () => {
    const user = userEvent.setup()
    renderAs('asha', '/w/acme')
    await user.click(await screen.findByRole('button', { name: 'New project' }))
    const dialog = screen.getByRole('dialog', { name: 'Create project' })
    await user.type(within(dialog).getByLabelText('Name'), 'Billing')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))

    expect(await findToast('Created the project Billing.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'Billing' })).toBeInTheDocument()
  })

  it('editing a project', async () => {
    const user = userEvent.setup()
    renderAs('asha', BOARD)
    await user.click(await screen.findByRole('button', { name: 'Edit project' }))
    const dialog = screen.getByRole('dialog', { name: 'Edit project' })
    await user.clear(within(dialog).getByLabelText('Name'))
    await user.type(within(dialog).getByLabelText('Name'), 'Web')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    expect(await findToast('Saved the changes to Web.')).toBeInTheDocument()
  })

  it('adding a task inline (focus stays in the title box for the next one)', async () => {
    const user = userEvent.setup()
    renderAs('ben', BOARD)
    await user.click(await screen.findByRole('button', { name: 'Add task to In Review' }))
    await user.type(screen.getByLabelText('Title of the new task in In Review'), 'Polish footer{Enter}')

    expect(await findToast('Added WEB-8 to In Review.')).toBeInTheDocument()
    expect(screen.getByLabelText('Title of the new task in In Review')).toHaveFocus()
  })

  it('changing a role', async () => {
    const user = userEvent.setup()
    renderAs('asha', '/w/acme/settings')
    const table = await screen.findByRole('table', { name: 'Members of Acme' })

    await user.selectOptions(within(table).getByRole('combobox', { name: 'Role for Ben Okafor' }), 'Admin')

    expect(await findToast("Changed Ben Okafor's role to Admin.")).toBeInTheDocument()
  })

  it('deleting a comment', async () => {
    const user = userEvent.setup()
    renderAs('ben', `${BOARD}?task=${MOCK_TASK_IDS.web1}`)
    const dialog = await screen.findByRole('dialog', { name: 'Fix login redirect' })
    const mine = await within(dialog).findByRole('article', { name: 'Comment by Ben Okafor' })

    await user.click(within(mine).getByRole('button', { name: 'Delete' }))
    await user.click(within(mine).getByRole('button', { name: 'Delete comment' }))

    expect(await findToast('Deleted the comment.')).toBeInTheDocument()
    await waitFor(() => expect(within(dialog).getByRole('heading', { name: 'Comments (1)' })).toHaveFocus())
  })

  it('creating a workspace', async () => {
    const user = userEvent.setup()
    renderAs('eve', '/')
    const workspaces = await screen.findByRole('region', { name: 'Your workspaces' })
    await user.click(await within(workspaces).findByRole('button', { name: 'Create workspace' }))
    const dialog = screen.getByRole('dialog', { name: 'Create workspace' })
    await user.type(within(dialog).getByLabelText('Name'), 'Eve Studio')
    await user.click(within(dialog).getByRole('button', { name: 'Create workspace' }))

    expect(await findToast('Created the workspace Eve Studio.')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'Eve Studio' })).toBeInTheDocument()
  })
})

describe('errors that would have nowhere to show', () => {
  /** PATCH /tasks/{tid} waits for `release()`, then fails with a 500. */
  function failingSave() {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    server.use(
      http.patch('/api/tasks/:tid', async () => {
        await gate
        return HttpResponse.json({ error: { code: 'internal_error', message: 'Database hiccup', details: {} } }, { status: 500 })
      }),
    )
    return () => release()
  }

  it('a save that fails after the drawer was closed is reported in an error toast', async () => {
    const user = userEvent.setup()
    const release = failingSave()
    renderAs('ben', `${BOARD}?task=${MOCK_TASK_IDS.web1}`)
    const dialog = await screen.findByRole('dialog', { name: 'Fix login redirect' })
    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'Urgent')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await user.click(within(dialog).getByRole('button', { name: 'Close task details' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    release()

    const toast = await findToast('Could not save WEB-1. Database hiccup')
    expect(liveRegionOf(toast)).toBe('assertive')
  })

  it('while the drawer is open, the error shows in the form only (no toast on top)', async () => {
    const user = userEvent.setup()
    const release = failingSave()
    renderAs('ben', `${BOARD}?task=${MOCK_TASK_IDS.web1}`)
    const dialog = await screen.findByRole('dialog', { name: 'Fix login redirect' })
    await user.selectOptions(within(dialog).getByLabelText('Priority'), 'Urgent')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))

    release()

    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Database hiccup')
    expect(toasts().queryByText(/Could not save/)).not.toBeInTheDocument()
  })
})
