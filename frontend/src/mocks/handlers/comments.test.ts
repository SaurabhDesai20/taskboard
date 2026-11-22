// Keeps the comment mocks honest: they must answer like contract 1.6, 1.10 and 3.7.
import { describe, expect, it } from 'vitest'
import type { CommentPage, CommentRead, Task } from '../../api/types'
import {
  commentsOf,
  createComment,
  findComment,
  MOCK_COMMENT_IDS,
  MOCK_PROJECTS,
  MOCK_TASK_IDS,
  MOCK_USERS,
  startMockSession,
} from '../db'

const { asha, ben, chen, dana, eve } = MOCK_USERS
const tasks = MOCK_TASK_IDS
const comments = MOCK_COMMENT_IDS
const MISSING_ID = '50000000-0000-4000-8000-0000000000ff'
const HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'taskboard' }

function call(method: string, path: string, body?: unknown) {
  return fetch(new URL(`/api${path}`, window.location.origin), {
    method,
    headers: method === 'GET' ? {} : HEADERS,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
}

async function json<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

interface ErrorBody {
  error: { code: string; message: string; details: { reason?: string; errors?: { field: string; location: string }[] } }
}

async function expectError(response: Response, status: number, code: string, reason?: string) {
  expect(response.status).toBe(status)
  const body = await json<ErrorBody>(response)
  expect(body.error.code).toBe(code)
  expect(body.error.message).not.toBe('')
  if (reason) expect(body.error.details.reason).toBe(reason)
  return body.error
}

async function expectFieldError(response: Response, field: string, location = 'body') {
  const error = await expectError(response, 422, 'validation_error')
  expect(error.details.errors).toContainEqual(expect.objectContaining({ field, location }))
}

/** A 403 with the exact reason and message of the contract's 403 table (3.7). */
async function expectForbidden(response: Response, reason: string, message: string) {
  const error = await expectError(response, 403, 'forbidden', reason)
  expect(error.message).toBe(message)
}

// Contract 3.7, 403 table.
const FORBIDDEN = {
  create: 'Only owners, admins and members can comment',
  viewerChange: 'Only owners, admins and members can edit or delete their comments',
  editNotAuthor: 'Only the author can edit this comment',
  deleteNotAuthor: "Only owners and admins can delete other people's comments",
}

const as = (user: { id: string }) => startMockSession(user.id)
const bodies = (page: CommentPage) => page.items.map((comment) => comment.body)
const commentCount = async (taskId: string) => (await json<Task>(await call('GET', `/tasks/${taskId}`))).comment_count

/** Adds `count` comments to WEB-2 one minute apart, numbered from 1. */
function seedThread(count: number) {
  const start = Date.parse('2026-11-20T08:00:00Z')
  for (let n = 1; n <= count; n += 1) {
    createComment({
      taskId: tasks.web2,
      authorId: ben.id,
      body: `Comment ${n}`,
      createdAt: new Date(start + n * 60_000).toISOString(),
    })
  }
}

describe('GET /tasks/{tid}/comments', () => {
  it('lists the comments oldest first, in the contract shape, for any member', async () => {
    as(chen)
    const response = await call('GET', `/tasks/${tasks.web1}/comments`)
    expect(response.status).toBe(200)
    const page = await json<CommentPage>(response)
    expect(page.next_cursor).toBeNull()
    expect(page.items).toHaveLength(2)
    expect(page.items[0]).toEqual({
      id: comments.web1Ben,
      task_id: tasks.web1,
      author: { id: ben.id, name: 'Ben Okafor' },
      body: 'Reproduced on Chrome and Firefox.',
      created_at: expect.any(String),
      edited_at: null,
    })
    expect(page.items[1]).toMatchObject({ id: comments.web1Asha, edited_at: expect.any(String) })
    expect(page.items[0].created_at < page.items[1].created_at).toBe(true)
    expect(await json<CommentPage>(await call('GET', `/tasks/${tasks.web2}/comments`))).toEqual({
      items: [],
      next_cursor: null,
    })
  })

  it('pages with limit and an opaque cursor until next_cursor is null', async () => {
    as(ben)
    seedThread(45)

    const first = await json<CommentPage>(await call('GET', `/tasks/${tasks.web2}/comments`))
    expect(first.items).toHaveLength(20)
    expect(first.items[0].body).toBe('Comment 1')
    expect(first.next_cursor).toEqual(expect.any(String))

    const second = await json<CommentPage>(
      await call('GET', `/tasks/${tasks.web2}/comments?limit=20&cursor=${encodeURIComponent(first.next_cursor ?? '')}`),
    )
    expect(bodies(second)[0]).toBe('Comment 21')

    const last = await json<CommentPage>(
      await call('GET', `/tasks/${tasks.web2}/comments?limit=100&cursor=${encodeURIComponent(second.next_cursor ?? '')}`),
    )
    expect(bodies(last)).toEqual(['Comment 41', 'Comment 42', 'Comment 43', 'Comment 44', 'Comment 45'])
    expect(last.next_cursor).toBeNull()

    const exact = await json<CommentPage>(await call('GET', `/tasks/${tasks.web2}/comments?limit=45`))
    expect(exact.items).toHaveLength(45)
    expect(exact.next_cursor).toBeNull()
  })

  it('keeps its place when comments are added or deleted between pages', async () => {
    as(ben)
    seedThread(3)
    const first = await json<CommentPage>(await call('GET', `/tasks/${tasks.web2}/comments?limit=2`))
    expect(bodies(first)).toEqual(['Comment 1', 'Comment 2'])

    await call('DELETE', `/comments/${first.items[1].id}`)
    await call('POST', `/tasks/${tasks.web2}/comments`, { body: 'Newest' })

    const next = await json<CommentPage>(
      await call('GET', `/tasks/${tasks.web2}/comments?limit=2&cursor=${first.next_cursor ?? ''}`),
    )
    expect(bodies(next)).toEqual(['Comment 3', 'Newest'])
  })

  it.each([
    ['limit=0', 'limit'],
    ['limit=101', 'limit'],
    ['limit=ten', 'limit'],
    ['cursor=not-a-cursor', 'cursor'],
  ])('rejects %s with a 422 on the query', async (query, field) => {
    as(ben)
    await expectFieldError(await call('GET', `/tasks/${tasks.web1}/comments?${query}`), field, 'query')
  })

  it('answers 404 for a missing task or one of a workspace I am not in, 422 for a malformed id', async () => {
    as(eve)
    await expectError(await call('GET', `/tasks/${tasks.web1}/comments`), 404, 'not_found')
    as(ben)
    await expectError(await call('GET', `/tasks/40000000-0000-4000-8000-0000000000ff/comments`), 404, 'not_found')
    await expectFieldError(await call('GET', '/tasks/nope/comments'), 'tid', 'path')
  })
})

describe('POST /tasks/{tid}/comments', () => {
  it('creates a trimmed comment by the caller, last in the thread, and counts it on the task', async () => {
    as(ben)
    const response = await call('POST', `/tasks/${tasks.web1}/comments`, { body: '  Fixed in\nthe next build.  ' })
    expect(response.status).toBe(201)
    const comment = await json<CommentRead>(response)
    expect(comment).toEqual({
      id: expect.any(String),
      task_id: tasks.web1,
      author: { id: ben.id, name: 'Ben Okafor' },
      body: 'Fixed in\nthe next build.',
      created_at: expect.any(String),
      edited_at: null,
    })
    expect(commentsOf(tasks.web1).map((item) => item.id).at(-1)).toBe(comment.id)
    expect(await commentCount(tasks.web1)).toBe(3)
  })

  it('is closed to viewers (403) and to non-members (404)', async () => {
    as(chen)
    await expectForbidden(await call('POST', `/tasks/${tasks.web1}/comments`, { body: 'Hi' }), 'insufficient_role', FORBIDDEN.create)
    as(eve)
    await expectError(await call('POST', `/tasks/${tasks.web1}/comments`, { body: 'Hi' }), 404, 'not_found')
  })

  it.each([
    ['a blank body', { body: '   ' }],
    ['a body over 5000 characters', { body: 'x'.repeat(5001) }],
    ['no body', {}],
    ['a null body', { body: null }],
  ])('rejects %s with a 422', async (_case, body) => {
    as(ben)
    await expectFieldError(await call('POST', `/tasks/${tasks.web1}/comments`, body), 'body')
  })

  it('accepts exactly 5000 characters', async () => {
    as(ben)
    expect((await call('POST', `/tasks/${tasks.web1}/comments`, { body: 'x'.repeat(5000) })).status).toBe(201)
  })

  it('answers 409 project_archived in an archived project', async () => {
    as(asha)
    await expectError(
      await call('POST', `/tasks/${tasks.crm1}/comments`, { body: 'Too late' }),
      409,
      'conflict',
      'project_archived',
    )
    expect(MOCK_PROJECTS.legacy.archived_at).not.toBeNull()
  })
})

describe('PATCH /comments/{cid}', () => {
  const patch = (commentId: string, body: unknown) => call('PATCH', `/comments/${commentId}`, body)

  it('lets the author edit and sets edited_at', async () => {
    as(ben)
    const response = await patch(comments.web1Ben, { body: ' Reproduced everywhere. ' })
    expect(response.status).toBe(200)
    const comment = await json<CommentRead>(response)
    expect(comment).toMatchObject({ id: comments.web1Ben, body: 'Reproduced everywhere.', edited_at: expect.any(String) })
    expect(findComment(comments.web1Ben)?.body).toBe('Reproduced everywhere.')
  })

  it('returns the comment unchanged, edited_at included, for {} or the current body', async () => {
    as(ben)
    const before = { ...findComment(comments.web1Ben) }
    for (const body of [{}, { body: 'Reproduced on Chrome and Firefox.' }, { body: '  Reproduced on Chrome and Firefox.\n' }]) {
      const response = await patch(comments.web1Ben, body)
      expect(response.status).toBe(200)
      expect(await json<CommentRead>(response)).toMatchObject({
        body: 'Reproduced on Chrome and Firefox.',
        edited_at: null,
      })
    }
    expect(findComment(comments.web1Ben)).toEqual(before)
  })

  it("is author-only: admins and owners get 403 not_author on other people's comments", async () => {
    for (const user of [asha, dana]) {
      as(user)
      await expectForbidden(await patch(comments.web1Ben, { body: 'Edited by someone else' }), 'not_author', FORBIDDEN.editNotAuthor)
    }
    expect(findComment(comments.web1Ben)?.edited_at).toBeNull()
  })

  it('refuses viewers with insufficient_role, even on a comment they wrote before being demoted', async () => {
    const own = createComment({ taskId: tasks.web1, authorId: chen.id, body: 'Written while a member' })
    as(chen)
    await expectForbidden(await patch(own.id, { body: 'x' }), 'insufficient_role', FORBIDDEN.viewerChange)
    await expectForbidden(await patch(comments.web1Ben, { body: 'x' }), 'insufficient_role', FORBIDDEN.viewerChange)
    // The role check comes before body validation.
    await expectForbidden(await patch(own.id, { body: '' }), 'insufficient_role', FORBIDDEN.viewerChange)
  })

  it.each([
    ['a blank body', { body: '' }],
    ['a null body', { body: null }],
    ['a body over 5000 characters', { body: 'x'.repeat(5001) }],
  ])('rejects %s with a 422, before checking the author', async (_case, body) => {
    as(ben)
    await expectFieldError(await patch(comments.web1Ben, body), 'body')
    as(dana)
    await expectFieldError(await patch(comments.web1Ben, body), 'body')
  })

  it('checks the author before the archived project, then answers 409 for any body, even {}', async () => {
    const archived = createComment({ taskId: tasks.crm1, authorId: asha.id, body: 'Before the archive' })
    as(dana)
    await expectForbidden(await patch(archived.id, { body: 'After' }), 'not_author', FORBIDDEN.editNotAuthor)
    as(asha)
    for (const body of [{ body: 'After' }, { body: 'Before the archive' }, {}]) {
      await expectError(await patch(archived.id, body), 409, 'conflict', 'project_archived')
    }
    expect(findComment(archived.id)).toMatchObject({ body: 'Before the archive', edited_at: null })
  })

  it('answers 404 for unknown or hidden comments and 422 for a malformed id', async () => {
    as(asha)
    await expectError(await patch(MISSING_ID, { body: 'x' }), 404, 'not_found')
    as(eve)
    // A non-member gets 404 even with an invalid body.
    await expectError(await patch(comments.web1Ben, { body: '' }), 404, 'not_found')
    await expectFieldError(await patch('nope', { body: 'x' }), 'cid', 'path')
  })
})

describe('DELETE /comments/{cid}', () => {
  const remove = (commentId: string) => call('DELETE', `/comments/${commentId}`)

  it('lets the author delete their comment and drops it from the count', async () => {
    as(ben)
    expect((await remove(comments.web1Ben)).status).toBe(204)
    expect(findComment(comments.web1Ben)).toBeUndefined()
    expect(await commentCount(tasks.web1)).toBe(1)
    await expectError(await remove(comments.web1Ben), 404, 'not_found')
  })

  it("lets admins and owners delete anyone's comment, also in an archived project", async () => {
    as(dana)
    expect((await remove(comments.web1Asha)).status).toBe(204)
    const archived = createComment({ taskId: tasks.crm1, authorId: dana.id, body: 'Old note' })
    as(asha)
    expect((await remove(archived.id)).status).toBe(204)
  })

  it("refuses members on other people's comments with not_author", async () => {
    as(ben)
    await expectForbidden(await remove(comments.web1Asha), 'not_author', FORBIDDEN.deleteNotAuthor)
    expect(findComment(comments.web1Asha)).toBeDefined()
  })

  it('refuses viewers with insufficient_role, even on their own comment, and non-members with 404', async () => {
    const own = createComment({ taskId: tasks.web1, authorId: chen.id, body: 'Written while a member' })
    as(chen)
    await expectForbidden(await remove(own.id), 'insufficient_role', FORBIDDEN.viewerChange)
    await expectForbidden(await remove(comments.web1Asha), 'insufficient_role', FORBIDDEN.viewerChange)
    as(eve)
    await expectError(await remove(comments.web1Asha), 404, 'not_found')
    expect(findComment(own.id)).toBeDefined()
    expect(findComment(comments.web1Asha)).toBeDefined()
  })

  it('goes with its task', async () => {
    as(asha)
    expect((await call('DELETE', `/tasks/${tasks.web1}`)).status).toBe(204)
    expect(commentsOf(tasks.web1)).toEqual([])
  })
})
