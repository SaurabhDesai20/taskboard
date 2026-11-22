import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { http, HttpResponse } from 'msw'
import { describe, expect, it } from 'vitest'
import type { CommentCreate } from '../../api/types'
import { formatDateTime, formatRelativeTime } from '../../lib/dates'
import {
  commentsOf,
  createComment,
  findComment,
  MOCK_COMMENT_IDS,
  MOCK_PROJECTS,
  MOCK_TASK_IDS,
  MOCK_USERS,
  MOCK_WORKSPACES,
  setMockMembership,
  startMockSession,
} from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'
import { ARCHIVED_REASON, VIEWER_REASON } from './access'

const { website, legacy } = MOCK_PROJECTS
const tasks = MOCK_TASK_IDS
const { ben, asha } = MOCK_USERS

type Who = keyof typeof MOCK_USERS

function renderTask(who: Who, taskId: string, projectId: string = website.id) {
  startMockSession(MOCK_USERS[who].id)
  return renderRoute({ route: `/w/acme/projects/${projectId}?task=${taskId}` })
}

/** The drawer of `title` and its comment section, once the comments have loaded. */
async function openThread(title: string) {
  const dialog = await screen.findByRole('dialog', { name: title })
  const thread = within(dialog).getByRole('region', { name: /^Comments/ })
  await waitFor(() => expect(within(thread).queryByText('Loading comments...')).not.toBeInTheDocument())
  return { dialog, thread }
}

const commentsIn = (thread: HTMLElement) => within(thread).queryAllByRole('article', { name: /^Comment by / })
const bodyOf = (comment: HTMLElement) => comment.querySelector('.comment__body')?.textContent
const actionsOf = (comment: HTMLElement) => within(comment).queryAllByRole('button').map((button) => button.textContent)
const composer = (thread: HTMLElement) => within(thread).getByRole('textbox', { name: 'Add a comment' })
const postButton = (thread: HTMLElement) => within(thread).getByRole('button', { name: 'Post comment' })
const boardCard = (title: string) => screen.getByRole('article', { name: title })

/** The thread's comment by `author` (the only one, or the `index`th). */
function commentBy(thread: HTMLElement, author: string, index = 0): HTMLElement {
  return within(thread).getAllByRole('article', { name: `Comment by ${author}` })[index]
}

/**
 * Holds requests matching `method path` until the returned function is called; then `answer`
 * replies, or the regular mock handler does when there is none.
 */
function holdRequests(method: 'post' | 'patch' | 'delete', path: string, answer?: () => Response) {
  let release = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  server.use(
    http[method](path, async () => {
      await gate
      return answer?.()
    }),
  )
  return () => release()
}

function errorAnswer(status: number, code: string, message: string, details: Record<string, unknown> = {}) {
  return () => HttpResponse.json({ error: { code, message, details } }, { status })
}

/** Records the bodies of POST /tasks/{tid}/comments, then lets the mock answer. */
function spyOnPosts(): CommentCreate[] {
  const bodies: CommentCreate[] = []
  server.use(
    http.post('/api/tasks/:tid/comments', async ({ request }) => {
      bodies.push((await request.clone().json()) as CommentCreate)
    }),
  )
  return bodies
}

/** Adds `count` comments by Ben to WEB-2, a minute apart, numbered from 1. */
function seedLongThread(count: number) {
  const start = Date.now() - 2 * 24 * 60 * 60_000
  for (let n = 1; n <= count; n += 1) {
    createComment({
      taskId: tasks.web2,
      authorId: ben.id,
      body: `Note ${n}`,
      createdAt: new Date(start + n * 60_000).toISOString(),
    })
  }
}

describe('thread', () => {
  it('shows author, relative time with the exact time, "(edited)" and the body with its line breaks', async () => {
    renderTask('chen', tasks.web1)
    const { thread } = await openThread('Fix login redirect')

    expect(within(thread).getByRole('heading', { name: 'Comments (2)' })).toBeInTheDocument()
    const [first, second] = commentsIn(thread)
    expect(commentsIn(thread)).toHaveLength(2)

    const benComment = findComment(MOCK_COMMENT_IDS.web1Ben)
    expect(within(first).getByText('Ben Okafor')).toBeInTheDocument()
    expect(bodyOf(first)).toBe('Reproduced on Chrome and Firefox.')
    const time = first.querySelector('time')
    expect(time).toHaveAttribute('datetime', benComment?.created_at)
    expect(time).toHaveAttribute('title', formatDateTime(benComment?.created_at ?? ''))
    expect(time).toHaveTextContent(formatRelativeTime(benComment?.created_at ?? ''))
    expect(within(first).queryByText('(edited)')).not.toBeInTheDocument()

    const ashaComment = findComment(MOCK_COMMENT_IDS.web1Asha)
    expect(within(second).getByText('Asha Rao')).toBeInTheDocument()
    expect(bodyOf(second)).toBe('Thanks! Can you check Safari too?\nIt may be the same cookie issue.')
    expect(within(second).getByText('(edited)')).toHaveAttribute(
      'title',
      `Edited ${formatDateTime(ashaComment?.edited_at ?? '')}`,
    )
  })

  it('shows bodies as plain text, never as HTML', async () => {
    const body = '<img src=x onerror="alert(1)"> <b>bold</b> <script>alert(2)</script>'
    createComment({ taskId: tasks.web2, authorId: ben.id, body })
    renderTask('ben', tasks.web2)
    const { thread } = await openThread('Write onboarding copy')

    expect(bodyOf(commentsIn(thread)[0])).toBe(body)
    expect(thread.querySelector('img, b, script')).toBeNull()
  })

  it('says when there are no comments yet', async () => {
    renderTask('ben', tasks.web2)
    const { thread } = await openThread('Write onboarding copy')

    expect(within(thread).getByText('No comments yet.')).toBeInTheDocument()
    expect(within(thread).getByRole('heading', { name: 'Comments (0)' })).toBeInTheDocument()
    expect(within(thread).queryByRole('button', { name: 'Load more comments' })).not.toBeInTheDocument()
  })

  it('shows a load error with Try again', async () => {
    const user = userEvent.setup()
    server.use(
      http.get('/api/tasks/:tid/comments', errorAnswer(500, 'internal_error', 'The server had a problem')),
    )
    renderTask('ben', tasks.web1)
    const dialog = await screen.findByRole('dialog', { name: 'Fix login redirect' })
    const thread = within(dialog).getByRole('region', { name: /^Comments/ })

    expect(await within(thread).findByRole('alert')).toHaveTextContent(
      'Could not load the comments. The server had a problem',
    )
    server.resetHandlers()
    await user.click(within(thread).getByRole('button', { name: 'Try again' }))

    await waitFor(() => expect(commentsIn(thread)).toHaveLength(2))
    expect(within(thread).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('loads 20 comments at a time, oldest first, and the next page with next_cursor', async () => {
    const user = userEvent.setup()
    seedLongThread(23)
    const requests: URL[] = []
    server.use(
      http.get('/api/tasks/:tid/comments', ({ request }) => {
        requests.push(new URL(request.url))
      }),
    )
    renderTask('ben', tasks.web2)
    const { thread } = await openThread('Write onboarding copy')

    expect(commentsIn(thread).map(bodyOf)).toEqual(Array.from({ length: 20 }, (_, index) => `Note ${index + 1}`))
    expect(within(thread).getByRole('heading', { name: 'Comments (23)' })).toBeInTheDocument()
    expect(requests).toHaveLength(1)
    expect(requests[0].searchParams.get('limit')).toBe('20')
    expect(requests[0].searchParams.has('cursor')).toBe(false)

    await user.click(within(thread).getByRole('button', { name: 'Load more comments' }))

    await waitFor(() => expect(commentsIn(thread)).toHaveLength(23))
    expect(commentsIn(thread).slice(-3).map(bodyOf)).toEqual(['Note 21', 'Note 22', 'Note 23'])
    expect(requests).toHaveLength(2)
    expect(requests[1].searchParams.get('cursor')).toEqual(expect.any(String))
    expect(within(thread).queryByRole('button', { name: 'Load more comments' })).not.toBeInTheDocument()
  })

  it('shows a comment posted before the last page loaded once, at its place', async () => {
    const user = userEvent.setup()
    seedLongThread(21)
    renderTask('ben', tasks.web2)
    const { thread } = await openThread('Write onboarding copy')

    await user.type(composer(thread), 'Newest note')
    await user.click(postButton(thread))
    await waitFor(() => expect(commentsIn(thread).map(bodyOf).at(-1)).toBe('Newest note'))
    await waitFor(() => expect(within(thread).queryByText('Posting...')).not.toBeInTheDocument())

    await user.click(within(thread).getByRole('button', { name: 'Load more comments' }))

    await waitFor(() => expect(commentsIn(thread)).toHaveLength(22))
    expect(commentsIn(thread).slice(-2).map(bodyOf)).toEqual(['Note 21', 'Newest note'])
  })
})

describe('composer', () => {
  it.each<[Who, string]>([
    ['asha', 'owner'],
    ['dana', 'admin'],
    ['ben', 'member'],
  ])('is open to %s (%s)', async (who) => {
    renderTask(who, tasks.web2)
    const { thread } = await openThread('Write onboarding copy')

    expect(composer(thread)).toBeEnabled()
    expect(composer(thread)).toHaveAccessibleDescription('Press Ctrl+Enter (Cmd+Enter on a Mac) to post.')
    expect(postButton(thread)).toBeEnabled()
  })

  it('is disabled for viewers, and says why', async () => {
    renderTask('chen', tasks.web1)
    const { thread } = await openThread('Fix login redirect')

    expect(composer(thread)).toBeDisabled()
    expect(composer(thread)).toHaveAccessibleDescription(VIEWER_REASON)
    expect(postButton(thread)).toBeDisabled()
  })

  it('is disabled in an archived project, even for the owner, and says why', async () => {
    renderTask('asha', tasks.crm1, legacy.id)
    const { thread } = await openThread('Export customer data')

    expect(composer(thread)).toBeDisabled()
    expect(composer(thread)).toHaveAccessibleDescription(ARCHIVED_REASON)
    expect(postButton(thread)).toBeDisabled()
  })

  it('checks the text before posting: not empty, at most 5000 characters', async () => {
    const user = userEvent.setup()
    const posts = spyOnPosts()
    renderTask('ben', tasks.web2)
    const { thread } = await openThread('Write onboarding copy')

    await user.type(composer(thread), '   ')
    await user.click(postButton(thread))
    expect(composer(thread)).toHaveAccessibleDescription(expect.stringContaining('Enter a comment'))
    expect(composer(thread)).toHaveFocus()
    expect(composer(thread)).toHaveAttribute('aria-invalid', 'true')

    await user.paste('x'.repeat(5001))
    expect(composer(thread)).toHaveAccessibleDescription(
      expect.stringContaining('Comment must be at most 5000 characters (it has 5001)'),
    )
    await user.click(postButton(thread))

    expect(posts).toEqual([])
    expect(within(thread).getByText('No comments yet.')).toBeInTheDocument()
  })

  it('posts optimistically: the comment shows at once, then the server copy replaces it', async () => {
    const user = userEvent.setup()
    const release = holdRequests('post', '/api/tasks/:tid/comments')
    renderTask('ben', tasks.web1)
    const { thread } = await openThread('Fix login redirect')
    expect(within(boardCard('Fix login redirect')).getByText('2 comments')).toBeInTheDocument()

    await user.type(composer(thread), '  Shipping a fix today.{Enter}Will check Safari too.  ')
    await user.click(postButton(thread))

    // At once, before the server has answered.
    await waitFor(() => expect(commentsIn(thread)).toHaveLength(3))
    const pending = commentsIn(thread)[2]
    expect(pending).toHaveAccessibleName('Comment by Ben Okafor')
    expect(bodyOf(pending)).toBe('Shipping a fix today.\nWill check Safari too.')
    expect(within(pending).getByText('Posting...')).toBeInTheDocument()
    expect(within(pending).getByText('just now')).toBeInTheDocument()
    expect(within(pending).queryByRole('button')).not.toBeInTheDocument()
    expect(composer(thread)).toHaveValue('')
    expect(commentsOf(tasks.web1)).toHaveLength(2)

    release()

    await waitFor(() => expect(within(thread).queryByText('Posting...')).not.toBeInTheDocument())
    expect(commentsIn(thread)).toHaveLength(3)
    const saved = commentsOf(tasks.web1)[2]
    expect(saved.body).toBe('Shipping a fix today.\nWill check Safari too.')
    expect(commentsIn(thread)[2].querySelector('time')).toHaveAttribute('datetime', saved.created_at)
    expect(actionsOf(commentsIn(thread)[2])).toEqual(['Edit', 'Delete'])
    expect(within(thread).getByRole('heading', { name: 'Comments (3)' })).toBeInTheDocument()
    // The card on the board behind the drawer counts it too.
    await waitFor(() => expect(within(boardCard('Fix login redirect')).getByText('3 comments')).toBeInTheDocument())
  })

  it('posts with Ctrl+Enter or Cmd+Enter, sending the trimmed text', async () => {
    const user = userEvent.setup()
    const posts = spyOnPosts()
    renderTask('ben', tasks.web2)
    const { thread } = await openThread('Write onboarding copy')
    expect(within(boardCard('Write onboarding copy')).queryByText(/comments?$/)).not.toBeInTheDocument()

    await user.type(composer(thread), ' First ')
    await user.keyboard('{Control>}{Enter}{/Control}')
    await waitFor(() => expect(commentsOf(tasks.web2)).toHaveLength(1))
    await user.type(composer(thread), 'Second')
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    await waitFor(() => expect(commentsOf(tasks.web2)).toHaveLength(2))

    expect(posts).toEqual([{ body: 'First' }, { body: 'Second' }])
    await waitFor(() => expect(commentsIn(thread).map(bodyOf)).toEqual(['First', 'Second']))
    await waitFor(() => expect(within(boardCard('Write onboarding copy')).getByText('2 comments')).toBeInTheDocument())
  })

  it('takes the comment back out, shows the error and returns the text when the server refuses it', async () => {
    const user = userEvent.setup()
    const release = holdRequests(
      'post',
      '/api/tasks/:tid/comments',
      errorAnswer(409, 'conflict', 'This project is archived, so its comments are read-only', {
        reason: 'project_archived',
      }),
    )
    renderTask('ben', tasks.web1)
    const { thread } = await openThread('Fix login redirect')

    await user.type(composer(thread), 'This will fail')
    await user.click(postButton(thread))
    await waitFor(() => expect(commentsIn(thread)).toHaveLength(3))
    expect(within(thread).getByText('Posting...')).toBeInTheDocument()

    release()

    expect(await within(thread).findByRole('alert')).toHaveTextContent(
      'Your comment was not posted. This project is archived, so its comments are read-only',
    )
    expect(commentsIn(thread).map(bodyOf)).toEqual([
      'Reproduced on Chrome and Firefox.',
      'Thanks! Can you check Safari too?\nIt may be the same cookie issue.',
    ])
    expect(composer(thread)).toHaveValue('This will fail')
    expect(within(thread).getByRole('heading', { name: 'Comments (2)' })).toBeInTheDocument()
    expect(within(boardCard('Fix login redirect')).getByText('2 comments')).toBeInTheDocument()
  })

  it('shows a 422 from the server on the field', async () => {
    const user = userEvent.setup()
    server.use(
      http.post(
        '/api/tasks/:tid/comments',
        errorAnswer(422, 'validation_error', 'Request validation failed', {
          errors: [{ field: 'body', location: 'body', message: 'String should have at most 5000 characters' }],
        }),
      ),
    )
    renderTask('ben', tasks.web2)
    const { thread } = await openThread('Write onboarding copy')

    await user.type(composer(thread), 'Too long for the server')
    await user.click(postButton(thread))

    await waitFor(() =>
      expect(composer(thread)).toHaveAccessibleDescription(
        expect.stringContaining('String should have at most 5000 characters'),
      ),
    )
    expect(composer(thread)).toHaveValue('Too long for the server')
    expect(within(thread).getByText('No comments yet.')).toBeInTheDocument()
  })
})

describe('editing and deleting', () => {
  it.each<[Who, string[], string[]]>([
    // who, actions on Ben's comment, actions on Asha's comment
    ['ben', ['Edit', 'Delete'], []],
    ['asha', ['Delete'], ['Edit', 'Delete']],
    ['dana', ['Delete'], ['Delete']],
    ['chen', [], []],
  ])('%s sees the allowed actions', async (who, onBens, onAshas) => {
    renderTask(who, tasks.web1)
    const { thread } = await openThread('Fix login redirect')

    expect(actionsOf(commentBy(thread, 'Ben Okafor'))).toEqual(onBens)
    expect(actionsOf(commentBy(thread, 'Asha Rao'))).toEqual(onAshas)
  })

  it('offers deleting but not editing in an archived project', async () => {
    const old = createComment({ taskId: tasks.crm1, authorId: asha.id, body: 'Exported to the new CRM.' })
    renderTask('asha', tasks.crm1, legacy.id)
    const { thread } = await openThread('Export customer data')

    expect(actionsOf(commentBy(thread, 'Asha Rao'))).toEqual(['Delete'])
    expect(findComment(old.id)).toBeDefined()
  })

  it('edits my comment inline; Escape leaves the edit, not the drawer', async () => {
    const user = userEvent.setup()
    renderTask('ben', tasks.web1)
    const { dialog, thread } = await openThread('Fix login redirect')
    const mine = commentBy(thread, 'Ben Okafor')

    await user.click(within(mine).getByRole('button', { name: 'Edit' }))
    const box = within(mine).getByRole('textbox', { name: 'Edit comment' })
    expect(box).toHaveFocus()
    expect(box).toHaveValue('Reproduced on Chrome and Firefox.')
    await user.keyboard('{Escape}')

    expect(dialog).toBeInTheDocument()
    expect(within(mine).queryByRole('textbox')).not.toBeInTheDocument()
    expect(within(mine).getByRole('button', { name: 'Edit' })).toHaveFocus()

    await user.click(within(mine).getByRole('button', { name: 'Edit' }))
    await user.clear(within(mine).getByRole('textbox', { name: 'Edit comment' }))
    await user.type(within(mine).getByRole('textbox', { name: 'Edit comment' }), 'Reproduced on{Enter}every browser.')
    await user.click(within(mine).getByRole('button', { name: 'Save' }))

    await waitFor(() => expect(bodyOf(mine)).toBe('Reproduced on\nevery browser.'))
    expect(within(mine).getByText('(edited)')).toBeInTheDocument()
    expect(within(mine).getByRole('button', { name: 'Edit' })).toHaveFocus()
    expect(findComment(MOCK_COMMENT_IDS.web1Ben)).toMatchObject({ body: 'Reproduced on\nevery browser.' })
  })

  it('checks the edited text before saving', async () => {
    const user = userEvent.setup()
    renderTask('ben', tasks.web1)
    const { thread } = await openThread('Fix login redirect')
    const mine = commentBy(thread, 'Ben Okafor')

    await user.click(within(mine).getByRole('button', { name: 'Edit' }))
    await user.clear(within(mine).getByRole('textbox', { name: 'Edit comment' }))
    await user.keyboard('{Control>}{Enter}{/Control}')

    expect(within(mine).getByRole('textbox', { name: 'Edit comment' })).toHaveAccessibleDescription('Enter a comment')
    expect(findComment(MOCK_COMMENT_IDS.web1Ben)?.edited_at).toBeNull()
  })

  it.each([
    [403, 'forbidden', 'Only the author can edit this comment', 'not_author'],
    [409, 'conflict', 'This project is archived, so its comments are read-only', 'project_archived'],
  ])('shows a %i (%s) from the server and keeps the edit open', async (status, code, message, reason) => {
    const user = userEvent.setup()
    server.use(http.patch('/api/comments/:cid', errorAnswer(status, code, message, { reason })))
    renderTask('ben', tasks.web1)
    const { thread } = await openThread('Fix login redirect')
    const mine = commentBy(thread, 'Ben Okafor')

    await user.click(within(mine).getByRole('button', { name: 'Edit' }))
    await user.type(within(mine).getByRole('textbox', { name: 'Edit comment' }), ' Also Safari.')
    await user.click(within(mine).getByRole('button', { name: 'Save' }))

    expect(await within(mine).findByRole('alert')).toHaveTextContent(message)
    expect(within(mine).getByRole('textbox', { name: 'Edit comment' })).toHaveValue(
      'Reproduced on Chrome and Firefox. Also Safari.',
    )
  })

  it('deletes my comment after confirming; the thread and the card count follow', async () => {
    const user = userEvent.setup()
    renderTask('ben', tasks.web1)
    const { dialog, thread } = await openThread('Fix login redirect')
    const mine = commentBy(thread, 'Ben Okafor')

    await user.click(within(mine).getByRole('button', { name: 'Delete' }))
    let question = within(mine).getByRole('group', { name: /Delete this comment\?/ })
    expect(within(question).getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(dialog).toBeInTheDocument()
    expect(within(mine).getByRole('button', { name: 'Delete' })).toHaveFocus()

    await user.click(within(mine).getByRole('button', { name: 'Delete' }))
    question = within(mine).getByRole('group', { name: /Delete this comment\?/ })
    await user.click(within(question).getByRole('button', { name: 'Delete comment' }))

    await waitFor(() => expect(commentsIn(thread)).toHaveLength(1))
    expect(findComment(MOCK_COMMENT_IDS.web1Ben)).toBeUndefined()
    expect(within(thread).getByRole('heading', { name: 'Comments (1)' })).toHaveFocus()
    await waitFor(() => expect(within(boardCard('Fix login redirect')).getByText('1 comment')).toBeInTheDocument())
  })

  it("lets admins delete other people's comments", async () => {
    const user = userEvent.setup()
    renderTask('dana', tasks.web1)
    const { thread } = await openThread('Fix login redirect')
    const ashas = commentBy(thread, 'Asha Rao')

    await user.click(within(ashas).getByRole('button', { name: 'Delete' }))
    await user.click(within(ashas).getByRole('button', { name: 'Delete comment' }))

    await waitFor(() => expect(commentsIn(thread).map(bodyOf)).toEqual(['Reproduced on Chrome and Firefox.']))
    expect(findComment(MOCK_COMMENT_IDS.web1Asha)).toBeUndefined()
  })

  it('shows a server error when deleting, keeps the comment and catches up with the new role', async () => {
    const user = userEvent.setup()
    renderTask('ben', tasks.web1)
    const { thread } = await openThread('Fix login redirect')
    const mine = commentBy(thread, 'Ben Okafor')
    // Someone makes Ben a viewer while the drawer is open.
    setMockMembership(MOCK_WORKSPACES.acme.id, ben.id, 'viewer')

    await user.click(within(mine).getByRole('button', { name: 'Delete' }))
    await user.click(within(mine).getByRole('button', { name: 'Delete comment' }))

    expect(await within(mine).findByRole('alert')).toHaveTextContent(
      'Only owners, admins and members can edit or delete their comments',
    )
    expect(commentsIn(thread)).toHaveLength(2)
    expect(findComment(MOCK_COMMENT_IDS.web1Ben)).toBeDefined()
    // The 403 refetched the workspace, so the composer now says why it is closed.
    await waitFor(() => expect(composer(thread)).toHaveAccessibleDescription(VIEWER_REASON))
  })
})
