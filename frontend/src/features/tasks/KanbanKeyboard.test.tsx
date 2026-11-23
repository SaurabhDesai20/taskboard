// The board without a mouse: every move that drag and drop offers can be made from the keyboard
// with a card's Move menu, and focus and announcements keep the user oriented.
import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import { columnKeys, MOCK_PROJECTS, MOCK_USERS, startMockSession, tasksOf } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'
import { findToast, liveRegionOf } from '../../test/toasts'

const { website } = MOCK_PROJECTS

function renderBoardAs(who: keyof typeof MOCK_USERS, query = '') {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route: `/w/acme/projects/${website.id}${query}` })
}

const column = (name: string) => screen.getByRole('region', { name })

function keysIn(name: string): string[] {
  return within(column(name))
    .queryAllByRole('article')
    .map((card) => card.querySelector('.task-card__key')?.textContent ?? '')
}

async function boardLoaded() {
  await waitFor(() => expect(keysIn('To Do').length).toBeGreaterThan(0))
}

const moveButton = (key: string) => screen.getByRole('button', { name: `Move ${key}` })
const menuOptions = (key: string) =>
  within(screen.getByRole('list', { name: `Move ${key}` }))
    .getAllByRole('button')
    .map((button) => button.textContent)

describe('moving cards with the keyboard', () => {
  it('Enter opens the menu, Tab reaches a move, Enter makes it; focus follows the card', async () => {
    const user = userEvent.setup()
    renderBoardAs('ben')
    await boardLoaded()

    act(() => moveButton('WEB-2').focus())
    await user.keyboard('{Enter}')
    expect(moveButton('WEB-2')).toHaveAttribute('aria-expanded', 'true')

    await user.tab()
    expect(screen.getByRole('button', { name: 'Move down' })).toHaveFocus()
    await user.tab()
    expect(screen.getByRole('button', { name: 'Move to top of In Progress' })).toHaveFocus()
    await user.keyboard('{Enter}')

    await waitFor(() => expect(keysIn('In Progress')).toEqual(['WEB-2', 'WEB-1', 'WEB-7']))
    // The card now lives in another column; its Move button has focus again, menu closed.
    await waitFor(() => expect(moveButton('WEB-2')).toHaveFocus())
    expect(moveButton('WEB-2')).toHaveAttribute('aria-expanded', 'false')
    // Screen readers hear where it went.
    expect(screen.getByText('Moved WEB-2 to In Progress.')).toHaveAttribute('aria-live', 'polite')
    await waitFor(() => expect(columnKeys(website.id).in_progress).toEqual(['WEB-2', 'WEB-1', 'WEB-7']))
  })

  it('Space works like Enter, and a card can be moved twice in a row without the mouse', async () => {
    const user = userEvent.setup()
    renderBoardAs('ben')
    await boardLoaded()

    act(() => moveButton('WEB-4').focus())
    await user.keyboard(' ')
    await user.tab()
    expect(screen.getByRole('button', { name: 'Move up' })).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(keysIn('To Do')).toEqual(['WEB-2', 'WEB-4', 'WEB-3']))
    expect(moveButton('WEB-4')).toHaveFocus()

    await user.keyboard(' ')
    await user.tab()
    await user.keyboard('{Enter}')
    await waitFor(() => expect(keysIn('To Do')).toEqual(['WEB-4', 'WEB-2', 'WEB-3']))
    await waitFor(() => expect(columnKeys(website.id).todo).toEqual(['WEB-4', 'WEB-2', 'WEB-3']))
  })

  it('offers only the moves that fit where the card is', async () => {
    const user = userEvent.setup()
    renderBoardAs('ben')
    await boardLoaded()

    // Top of its column: no "Move up".
    await user.click(moveButton('WEB-2'))
    expect(menuOptions('WEB-2')).not.toContain('Move up')
    expect(menuOptions('WEB-2')).toContain('Move down')
    await user.keyboard('{Escape}')

    // Alone in its column: only other columns.
    await user.click(moveButton('WEB-5'))
    expect(menuOptions('WEB-5')).toEqual([
      'Move to top of To Do',
      'Move to bottom of To Do',
      'Move to top of In Progress',
      'Move to bottom of In Progress',
      'Move to top of Done',
      'Move to bottom of Done',
    ])
  })

  it('offers "Move to <column>" for an empty column', async () => {
    const user = userEvent.setup()
    for (const task of tasksOf(website.id)) if (task.status === 'done') task.status = 'todo'
    renderBoardAs('ben')
    await boardLoaded()
    await waitFor(() => expect(keysIn('Done')).toEqual([]))

    act(() => moveButton('WEB-1').focus())
    await user.keyboard('{Enter}')
    expect(menuOptions('WEB-1')).toContain('Move to Done')
    expect(menuOptions('WEB-1')).not.toContain('Move to top of Done')
  })

  it('Escape in the menu, or Tab out of it, closes it and leaves focus on the card', async () => {
    const user = userEvent.setup()
    renderBoardAs('ben')
    await boardLoaded()

    act(() => moveButton('WEB-3').focus())
    await user.keyboard('{Enter}')
    await user.tab()
    await user.keyboard('{Escape}')
    expect(moveButton('WEB-3')).toHaveAttribute('aria-expanded', 'false')
    expect(moveButton('WEB-3')).toHaveFocus()
    // Escape closed the menu only, nothing else (no drawer was open, the board is still there).
    expect(keysIn('To Do')).toEqual(['WEB-2', 'WEB-3', 'WEB-4'])

    await user.keyboard('{Enter}')
    const options = menuOptions('WEB-3').length
    for (let index = 0; index < options + 1; index += 1) await user.tab()
    expect(moveButton('WEB-3')).toHaveAttribute('aria-expanded', 'false')
  })

  it('a refused move snaps back, says why in an error toast and keeps focus on the card', async () => {
    const user = userEvent.setup()
    server.use(
      http.post('/api/tasks/:tid/move', () =>
        HttpResponse.json({ error: { code: 'internal_error', message: 'Database hiccup', details: {} } }, { status: 500 }),
      ),
    )
    renderBoardAs('ben')
    await boardLoaded()

    act(() => moveButton('WEB-2').focus())
    await user.keyboard('{Enter}')
    await user.tab()
    await user.tab()
    await user.keyboard('{Enter}')

    const toast = await findToast('Could not move WEB-2. Database hiccup')
    expect(liveRegionOf(toast)).toBe('assertive')
    await waitFor(() => expect(keysIn('To Do')).toEqual(['WEB-2', 'WEB-3', 'WEB-4']))
    expect(moveButton('WEB-2')).toHaveFocus()
  })

  it('viewers get no Move buttons and no drag handles, but can still open every card from the keyboard', async () => {
    const user = userEvent.setup()
    const { router } = renderBoardAs('chen')
    await boardLoaded()

    expect(screen.queryByRole('button', { name: /^Move / })).not.toBeInTheDocument()
    act(() => within(column('To Do')).getAllByRole('link')[0].focus())
    await user.keyboard('{Enter}')

    expect(await screen.findByRole('dialog', { name: 'Write onboarding copy' })).toBeInTheDocument()
    expect(router.state.location.search).toMatch(/^\?task=/)
  })
})
