// The role x action matrix (PLAN.md section 4, contract 1.10) as the UI shows it: for each role in
// Acme, which controls are visible or enabled on the board, in the task drawer and its comments,
// on the project pages and in the workspace settings. The expectations are written out by hand
// (not derived from lib/permissions.ts), so a slip in the helper or in a component shows up here.
import { screen, waitFor, within } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { MOCK_PROJECTS, MOCK_TASK_IDS, MOCK_USERS, startMockSession } from '../mocks/db'
import { renderRoute } from '../test/render'

const { website } = MOCK_PROJECTS
const BOARD = `/w/acme/projects/${website.id}`

type Who = 'asha' | 'dana' | 'ben' | 'chen'

interface Expected {
  role: string
  board: { moveButtons: number; addButtons: number }
  drawer: {
    editForm: boolean
    deleteTask: boolean
    canComment: boolean
    /** Buttons on Asha's and on Ben's comment of WEB-1. */
    onAshasComment: string[]
    onBensComment: string[]
  }
  projects: { create: boolean; manageCards: boolean; manageHeader: boolean }
  settings: {
    rename: boolean
    addMember: boolean
    roleDropdowns: string[]
    removeButtons: string[]
    deleteWorkspace: boolean
    leaveEnabled: boolean
  }
}

const MATRIX: Record<Who, Expected> = {
  asha: {
    role: 'owner',
    board: { moveButtons: 7, addButtons: 4 },
    drawer: { editForm: true, deleteTask: true, canComment: true, onAshasComment: ['Edit', 'Delete'], onBensComment: ['Delete'] },
    projects: { create: true, manageCards: true, manageHeader: true },
    settings: {
      rename: true,
      addMember: true,
      roleDropdowns: ['Dana Kim', 'Ben Okafor', 'Chen Wei'],
      removeButtons: ['Dana Kim', 'Ben Okafor', 'Chen Wei'],
      deleteWorkspace: true,
      // The only owner cannot leave.
      leaveEnabled: false,
    },
  },
  dana: {
    role: 'admin',
    board: { moveButtons: 7, addButtons: 4 },
    drawer: { editForm: true, deleteTask: true, canComment: true, onAshasComment: ['Delete'], onBensComment: ['Delete'] },
    projects: { create: true, manageCards: true, manageHeader: true },
    settings: {
      rename: false,
      addMember: true,
      // Admins manage members and viewers only.
      roleDropdowns: ['Ben Okafor', 'Chen Wei'],
      removeButtons: ['Ben Okafor', 'Chen Wei'],
      deleteWorkspace: false,
      leaveEnabled: true,
    },
  },
  ben: {
    role: 'member',
    board: { moveButtons: 7, addButtons: 4 },
    drawer: { editForm: true, deleteTask: false, canComment: true, onAshasComment: [], onBensComment: ['Edit', 'Delete'] },
    projects: { create: false, manageCards: false, manageHeader: false },
    settings: {
      rename: false,
      addMember: false,
      roleDropdowns: [],
      removeButtons: [],
      deleteWorkspace: false,
      leaveEnabled: true,
    },
  },
  chen: {
    role: 'viewer',
    board: { moveButtons: 0, addButtons: 0 },
    drawer: { editForm: false, deleteTask: false, canComment: false, onAshasComment: [], onBensComment: [] },
    projects: { create: false, manageCards: false, manageHeader: false },
    settings: {
      rename: false,
      addMember: false,
      roleDropdowns: [],
      removeButtons: [],
      deleteWorkspace: false,
      leaveEnabled: true,
    },
  },
}

const ROLES = (Object.keys(MATRIX) as Who[]).map((who) => ({ who, ...MATRIX[who] }))

function renderAs(who: Who, route: string) {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route })
}

const buttonLabels = (element: HTMLElement) =>
  within(element)
    .queryAllByRole('button')
    .map((button) => button.textContent)

describe.each(ROLES)('$who ($role)', ({ who, board, drawer, projects, settings }) => {
  it('board: moving, dragging and adding tasks', async () => {
    renderAs(who, BOARD)
    const toDo = await screen.findByRole('region', { name: 'To Do' })
    await waitFor(() => expect(within(toDo).getAllByRole('article').length).toBeGreaterThan(0))

    expect(screen.queryAllByRole('button', { name: /^Move WEB-/ })).toHaveLength(board.moveButtons)
    expect(screen.queryAllByRole('button', { name: /^Add task to / })).toHaveLength(board.addButtons)
    expect(document.querySelectorAll('.board-column__item--movable')).toHaveLength(board.moveButtons)
    // Everyone can open a task.
    expect(within(toDo).getAllByRole('link').length).toBeGreaterThan(0)
    // Project management in the header.
    expect(Boolean(screen.queryByRole('button', { name: 'Edit project' }))).toBe(projects.manageHeader)
    expect(Boolean(screen.queryByRole('button', { name: 'Archive project' }))).toBe(projects.manageHeader)
  })

  it('task drawer and comments: editing, deleting, commenting', async () => {
    renderAs(who, `${BOARD}?task=${MOCK_TASK_IDS.web1}`)
    const dialog = await screen.findByRole('dialog', { name: 'Fix login redirect' })
    const ashas = await within(dialog).findByRole('article', { name: 'Comment by Asha Rao' })
    const bens = within(dialog).getByRole('article', { name: 'Comment by Ben Okafor' })

    expect(Boolean(within(dialog).queryByRole('textbox', { name: 'Title' }))).toBe(drawer.editForm)
    expect(Boolean(within(dialog).queryByRole('button', { name: 'Save changes' }))).toBe(drawer.editForm)
    expect(Boolean(within(dialog).queryByText('You have view-only access to this workspace.'))).toBe(!drawer.editForm)
    expect(Boolean(within(dialog).queryByRole('button', { name: 'Delete task' }))).toBe(drawer.deleteTask)

    const composer = within(dialog).getByRole('textbox', { name: 'Add a comment' })
    if (drawer.canComment) {
      expect(composer).toBeEnabled()
      expect(within(dialog).getByRole('button', { name: 'Post comment' })).toBeEnabled()
    } else {
      expect(composer).toBeDisabled()
      expect(composer).toHaveAccessibleDescription(/view-only access/)
      expect(within(dialog).getByRole('button', { name: 'Post comment' })).toBeDisabled()
    }
    expect(buttonLabels(ashas)).toEqual(drawer.onAshasComment)
    expect(buttonLabels(bens)).toEqual(drawer.onBensComment)
  })

  it('projects grid: creating, editing and archiving', async () => {
    renderAs(who, '/w/acme')
    const region = await screen.findByRole('region', { name: 'Projects' })
    await within(region).findByRole('article', { name: 'Website' })

    expect(Boolean(within(region).queryByRole('button', { name: 'New project' }))).toBe(projects.create)
    for (const name of ['Website', 'Mobile App']) {
      expect(Boolean(within(region).queryByRole('button', { name: `Edit ${name}` }))).toBe(projects.manageCards)
      expect(Boolean(within(region).queryByRole('button', { name: `Archive ${name}` }))).toBe(projects.manageCards)
    }
  })

  it('settings: renaming, members and deleting', async () => {
    renderAs(who, '/w/acme/settings')
    const table = await screen.findByRole('table', { name: 'Members of Acme' })

    expect(Boolean(screen.queryByRole('form', { name: 'Rename workspace' }))).toBe(settings.rename)
    expect(Boolean(screen.queryByRole('form', { name: 'Add a member' }))).toBe(settings.addMember)
    expect(
      within(table)
        .queryAllByRole('combobox')
        .map((select) => select.getAttribute('aria-label')?.replace('Role for ', '')),
    ).toEqual(settings.roleDropdowns)
    expect(
      within(table)
        .queryAllByRole('button', { name: /^Remove / })
        .map((button) => button.textContent?.replace('Remove ', '')),
    ).toEqual(settings.removeButtons)
    expect(Boolean(screen.queryByRole('button', { name: 'Delete workspace' }))).toBe(settings.deleteWorkspace)
    const leave = within(table).getByRole('button', { name: 'Leave workspace' })
    if (settings.leaveEnabled) expect(leave).toBeEnabled()
    else expect(leave).toBeDisabled()
  })
})
