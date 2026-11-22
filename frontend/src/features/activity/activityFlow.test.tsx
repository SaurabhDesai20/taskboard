// End to end through the UI and the MSW mock: actions taken in the app appear in the activity
// feed with readable messages. The query client keeps data fresh for 30 s like the app's, so a
// feed that was already loaded only shows the new entries if the mutations invalidate it.
import { QueryClient } from '@tanstack/react-query'
import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { MOCK_USERS, startMockSession } from '../../mocks/db'
import { renderRoute } from '../../test/render'

function appLikeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: { queries: { retry: false, staleTime: 30_000 }, mutations: { retry: false } },
  })
}

function renderAs(who: keyof typeof MOCK_USERS, route: string) {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route, queryClient: appLikeQueryClient() })
}

const messages = (list: HTMLElement) =>
  Array.from(list.querySelectorAll(':scope > li .activity-item__message')).map((item) => item.textContent)

const feedList = (workspaceName = 'Acme') => screen.findByRole('list', { name: `Activity in ${workspaceName}` })

async function openActivityTab(user: ReturnType<typeof userEvent.setup>) {
  const nav = screen.getByRole('navigation', { name: 'Workspace' })
  await user.click(within(nav).getByRole('link', { name: 'Activity' }))
  return feedList()
}

describe('activity flow', () => {
  it('a task edited and commented on from the feed shows up at the top of the feed', async () => {
    const user = userEvent.setup()
    const { router } = renderAs('asha', '/w/acme/activity')
    const before = messages(await feedList())

    // The feed links to the task: its drawer opens on the board.
    await user.click(screen.getAllByRole('link', { name: 'WEB-2 Write onboarding copy' })[0])
    const dialog = await screen.findByRole('dialog', { name: 'Write onboarding copy' })
    await user.selectOptions(within(dialog).getByLabelText('Status'), 'In Progress')
    await user.selectOptions(within(dialog).getByLabelText('Assignee'), 'Dana Kim')
    await user.clear(within(dialog).getByLabelText('Due date'))
    await user.type(within(dialog).getByLabelText('Due date'), '2026-12-24')
    await user.click(within(dialog).getByRole('button', { name: 'Save changes' }))
    await within(dialog).findByText('Changes saved.')

    await user.type(within(dialog).getByRole('textbox', { name: 'Add a comment' }), 'Copy is ready\nfor review.')
    await user.click(within(dialog).getByRole('button', { name: 'Post comment' }))
    await within(dialog).findByRole('heading', { name: 'Comments (1)' })
    await user.click(within(dialog).getByRole('button', { name: 'Close task details' }))

    // Back to the feed through the breadcrumbs and the workspace tabs.
    await user.click(screen.getByRole('link', { name: 'Acme' }))
    const list = await openActivityTab(user)

    expect(router.state.location.pathname).toBe('/w/acme/activity')
    await waitFor(() =>
      expect(messages(list).slice(0, 4)).toEqual([
        'Asha Rao commented on WEB-2 Write onboarding copy: "Copy is ready for review."',
        'Asha Rao moved WEB-2 Write onboarding copy from To Do to In Progress',
        expect.stringMatching(/^Asha Rao set the due date of WEB-2 Write onboarding copy to /),
        'Asha Rao assigned WEB-2 Write onboarding copy to Dana Kim',
      ]),
    )
    expect(messages(list).slice(4, 8)).toEqual(before.slice(0, 4))
  })

  it('member and workspace changes in the settings show up in a feed that was already loaded', async () => {
    const user = userEvent.setup()
    renderAs('asha', '/w/acme/activity')
    await feedList()

    const nav = screen.getByRole('navigation', { name: 'Workspace' })
    await user.click(within(nav).getByRole('link', { name: 'Settings' }))
    const form = await screen.findByRole('form', { name: 'Add a member' })
    await user.type(within(form).getByLabelText('Email'), 'eve@example.com')
    await user.selectOptions(within(form).getByLabelText('Role'), 'Viewer')
    await user.click(within(form).getByRole('button', { name: 'Add member' }))
    await within(form).findByText('Added Eve Santos as Viewer.')
    await user.selectOptions(screen.getByRole('combobox', { name: 'Role for Ben Okafor' }), 'Admin')
    await waitFor(() => expect(screen.getByRole('combobox', { name: 'Role for Ben Okafor' })).toHaveValue('admin'))

    const list = await openActivityTab(user)

    await waitFor(() =>
      expect(messages(list).slice(0, 2)).toEqual([
        "Asha Rao changed Ben Okafor's role from Member to Admin",
        'Asha Rao added Eve Santos as Viewer',
      ]),
    )
  })

  it('a created project shows up, and the project filter finds it', async () => {
    const user = userEvent.setup()
    renderAs('asha', '/w/acme/activity')
    await feedList()

    const nav = screen.getByRole('navigation', { name: 'Workspace' })
    await user.click(within(nav).getByRole('link', { name: 'Overview' }))
    await user.click(await screen.findByRole('button', { name: 'New project' }))
    const dialog = await screen.findByRole('dialog', { name: 'Create project' })
    await user.type(within(dialog).getByLabelText('Name'), 'Billing')
    await user.clear(within(dialog).getByLabelText('Key'))
    await user.type(within(dialog).getByLabelText('Key'), 'BIL')
    await user.click(within(dialog).getByRole('button', { name: 'Create project' }))
    // Creating a project opens it.
    await screen.findByRole('heading', { level: 1, name: 'Billing' })

    await user.click(screen.getByRole('link', { name: 'Acme' }))
    const list = await openActivityTab(user)
    await waitFor(() => expect(messages(list)[0]).toBe('Asha Rao created project Billing (BIL)'))

    await user.selectOptions(screen.getByRole('combobox', { name: 'Project' }), 'Billing')
    await waitFor(() =>
      expect(messages(screen.getByRole('list', { name: 'Activity in Acme' }))).toEqual([
        'Asha Rao created project Billing (BIL)',
      ]),
    )
  })
})
