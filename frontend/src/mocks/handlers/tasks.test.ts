// Keeps the task mocks honest: they must answer like contract 1.10 and 3.6.
import { describe, expect, it } from 'vitest'
import type { MyTask, Task } from '../../api/types'
import { addDays, todayDateOnly } from '../../lib/dates'
import {
  columnKeys,
  findTask,
  MOCK_PROJECTS,
  MOCK_TASK_IDS,
  MOCK_USERS,
  startMockSession,
  tasksOf,
} from '../db'

const { asha, ben, chen, dana, eve } = MOCK_USERS
const { website, mobile, legacy, operations } = MOCK_PROJECTS
const ids = MOCK_TASK_IDS
const MISSING_ID = '40000000-0000-4000-8000-0000000000ff'
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
  return error
}

const as = (user: { id: string }) => startMockSession(user.id)
const keys = (tasks: Task[]) => tasks.map((task) => task.key)
const list = async (query = '', projectId: string = website.id) =>
  keys(await json<Task[]>(await call('GET', `/projects/${projectId}/tasks${query}`)))

describe('GET /projects/{pid}/tasks', () => {
  it('lists every task by status, then position, in the contract shape', async () => {
    as(chen)
    const response = await call('GET', `/projects/${website.id}/tasks`)
    expect(response.status).toBe(200)
    const tasks = await json<Task[]>(response)
    expect(keys(tasks)).toEqual(['WEB-2', 'WEB-3', 'WEB-4', 'WEB-1', 'WEB-7', 'WEB-5', 'WEB-6'])
    expect(tasks.find((task) => task.key === 'WEB-1')).toEqual({
      id: ids.web1,
      project_id: website.id,
      workspace_id: website.workspace_id,
      number: 1,
      key: 'WEB-1',
      title: 'Fix login redirect',
      description: 'After login users land on /404 instead of the dashboard.',
      status: 'in_progress',
      priority: 'high',
      position: 1024,
      assignee: { id: ben.id, name: 'Ben Okafor' },
      due_date: addDays(todayDateOnly(), 9),
      comment_count: 2,
      created_by: asha.id,
      created_at: '2026-11-22T09:20:00Z',
      updated_at: '2026-11-22T09:20:00Z',
    })
  })

  it('filters by repeated status and priority, assignee (or none), due_before and q', async () => {
    as(chen)
    expect(await list('?status=todo&status=done')).toEqual(['WEB-2', 'WEB-3', 'WEB-4', 'WEB-6'])
    expect(await list('?priority=high&priority=urgent')).toEqual(['WEB-3', 'WEB-1', 'WEB-5'])
    expect(await list(`?assignee_id=${asha.id}`)).toEqual(['WEB-3', 'WEB-7', 'WEB-5'])
    expect(await list('?assignee_id=none')).toEqual(['WEB-2'])
    // Inclusive, and tasks without a due date are left out.
    expect(await list(`?due_before=${todayDateOnly()}`)).toEqual(['WEB-3', 'WEB-5', 'WEB-6'])
    // Case-insensitive, in the title or the description.
    expect(await list('?q=LOGIN')).toEqual(['WEB-1'])
    expect(await list('?q=screen%20reader')).toEqual(['WEB-7'])
    expect(await list('?status=todo&assignee_id=none&q=copy')).toEqual(['WEB-2'])
  })

  it('answers 422 for bad filters', async () => {
    as(chen)
    const path = `/projects/${website.id}/tasks`
    // A bad value of a repeatable filter is reported with its index.
    await expectFieldError(await call('GET', `${path}?status=open`), 'status.0', 'query')
    await expectFieldError(await call('GET', `${path}?status=todo&status=open`), 'status.1', 'query')
    await expectFieldError(await call('GET', `${path}?priority=asap`), 'priority.0', 'query')
    await expectFieldError(await call('GET', `${path}?assignee_id=NONE`), 'assignee_id', 'query')
    await expectFieldError(await call('GET', `${path}?assignee_id=ben`), 'assignee_id', 'query')
    await expectFieldError(await call('GET', `${path}?due_before=2026-02-30`), 'due_before', 'query')
    await expectFieldError(await call('GET', `${path}?q=`), 'q', 'query')
    await expectFieldError(await call('GET', `${path}?q=${'x'.repeat(201)}`), 'q', 'query')
  })

  it('answers 404 to non-members and 401 when logged out', async () => {
    expect((await call('GET', `/projects/${website.id}/tasks`)).status).toBe(401)
    as(chen)
    await expectError(await call('GET', `/projects/${operations.id}/tasks`), 404, 'not_found')
  })
})

describe('POST /projects/{pid}/tasks', () => {
  const create = (body: unknown, projectId: string = website.id) => call('POST', `/projects/${projectId}/tasks`, body)

  it('creates with defaults at the end of To Do, with the next number', async () => {
    as(ben)
    const response = await create({ title: '  Add FAQ  ' })
    expect(response.status).toBe(201)
    const task = await json<Task>(response)
    expect(task).toMatchObject({
      number: 8,
      key: 'WEB-8',
      title: 'Add FAQ',
      description: null,
      status: 'todo',
      priority: 'medium',
      position: 4096,
      assignee: null,
      due_date: null,
      comment_count: 0,
      created_by: ben.id,
    })
    expect(columnKeys(website.id).todo).toEqual(['WEB-2', 'WEB-3', 'WEB-4', 'WEB-8'])
  })

  it('takes every field; an empty column starts at 1024', async () => {
    as(asha)
    const task = await json<Task>(
      await create({
        title: 'Ship it',
        description: 'Now',
        status: 'in_review',
        priority: 'urgent',
        assignee_id: chen.id,
        due_date: '2026-12-24',
      }, mobile.id),
    )
    expect(task).toMatchObject({
      key: 'APP-3',
      status: 'in_review',
      priority: 'urgent',
      position: 1024,
      assignee: { id: chen.id, name: 'Chen Wei' },
      due_date: '2026-12-24',
    })
  })

  it('never reuses a number after a delete', async () => {
    as(asha)
    const first = await json<Task>(await create({ title: 'One' }))
    await call('DELETE', `/tasks/${first.id}`)
    expect((await json<Task>(await create({ title: 'Two' }))).number).toBe(first.number + 1)
  })

  it('checks role, body, archive and assignee, in that order', async () => {
    as(chen)
    await expectError(await create({ title: 'x' }), 403, 'forbidden', 'insufficient_role')
    as(ben)
    await expectFieldError(await create({ title: '   ' }), 'title')
    await expectFieldError(await create({}), 'title')
    await expectFieldError(await create({ title: 'x', status: 'open' }), 'status')
    await expectFieldError(await create({ title: 'x', priority: 'asap' }), 'priority')
    await expectFieldError(await create({ title: 'x', due_date: '01/12/2026' }), 'due_date')
    await expectFieldError(await create({ title: 'x'.repeat(201) }), 'title')
    as(asha)
    await expectError(await create({ title: 'x' }, legacy.id), 409, 'conflict', 'project_archived')
    const error = await expectFieldError(await create({ title: 'x', assignee_id: eve.id }), 'assignee_id')
    expect(error.details.errors?.[0]).toMatchObject({ message: 'Assignee must be a member of this workspace' })
  })
})

describe('GET, PATCH and DELETE /tasks/{tid}', () => {
  it('gets one task; 404 for a missing task or a non-member, 422 for a malformed id', async () => {
    as(chen)
    expect((await json<Task>(await call('GET', `/tasks/${ids.web3}`))).key).toBe('WEB-3')
    await expectError(await call('GET', `/tasks/${MISSING_ID}`), 404, 'not_found')
    await expectError(await call('GET', `/tasks/${ids.ops1}`), 404, 'not_found')
    await expectFieldError(await call('GET', '/tasks/nope'), 'tid', 'path')
  })

  it('patches only the fields sent; null clears nullable fields', async () => {
    as(ben)
    const response = await call('PATCH', `/tasks/${ids.web1}`, { priority: 'urgent', assignee_id: null, due_date: '2026-12-03' })
    expect(response.status).toBe(200)
    const task = await json<Task>(response)
    expect(task).toMatchObject({ title: 'Fix login redirect', priority: 'urgent', assignee: null, due_date: '2026-12-03' })
    expect(task.updated_at).not.toBe('2026-11-22T09:20:00Z')

    const cleared = await json<Task>(await call('PATCH', `/tasks/${ids.web1}`, { description: null, due_date: null }))
    expect(cleared).toMatchObject({ description: null, due_date: null })

    const unchanged = await json<Task>(await call('PATCH', `/tasks/${ids.web3}`, {}))
    expect(unchanged.updated_at).toBe('2026-11-22T09:22:00Z')
  })

  it('moves a task to the end of its new column on a status change', async () => {
    as(ben)
    const task = await json<Task>(await call('PATCH', `/tasks/${ids.web2}`, { status: 'in_progress' }))
    expect(task).toMatchObject({ status: 'in_progress', position: 3072 })
    expect(columnKeys(website.id).in_progress).toEqual(['WEB-1', 'WEB-7', 'WEB-2'])
  })

  it('rejects null for non-nullable fields, a non-member assignee, viewers and archived projects', async () => {
    as(ben)
    await expectFieldError(await call('PATCH', `/tasks/${ids.web1}`, { title: null }), 'title')
    await expectFieldError(await call('PATCH', `/tasks/${ids.web1}`, { status: null }), 'status')
    await expectFieldError(await call('PATCH', `/tasks/${ids.web1}`, { assignee_id: eve.id }), 'assignee_id')
    as(chen)
    await expectError(await call('PATCH', `/tasks/${ids.web1}`, { title: 'x' }), 403, 'forbidden', 'insufficient_role')
    as(asha)
    await expectError(await call('PATCH', `/tasks/${ids.crm1}`, { title: 'x' }), 409, 'conflict', 'project_archived')
    await expectError(await call('PATCH', `/tasks/${ids.crm1}`, {}), 409, 'conflict', 'project_archived')
  })

  it('checks only a new assignee, so a task whose assignee left can still be edited', async () => {
    const task = findTask(ids.web1)
    if (!task) throw new Error('seed changed')
    task.assignee_id = eve.id
    as(ben)

    expect((await call('PATCH', `/tasks/${ids.web1}`, { title: 'Still mine', assignee_id: eve.id })).status).toBe(200)
    expect(findTask(ids.web1)).toMatchObject({ title: 'Still mine', assignee_id: eve.id })
  })

  it('deletes for owners and admins only, archived projects included', async () => {
    as(ben)
    await expectError(await call('DELETE', `/tasks/${ids.web1}`), 403, 'forbidden', 'insufficient_role')
    as(dana)
    expect((await call('DELETE', `/tasks/${ids.web1}`)).status).toBe(204)
    expect(findTask(ids.web1)).toBeUndefined()
    as(asha)
    expect((await call('DELETE', `/tasks/${ids.crm1}`)).status).toBe(204)
    await expectError(await call('DELETE', `/tasks/${ids.crm1}`), 404, 'not_found')
  })
})

describe('POST /tasks/{tid}/move', () => {
  const move = (taskId: string, body: unknown) => call('POST', `/tasks/${taskId}/move`, body)

  it.each([
    ['no neighbours: end of the column', { status: 'in_progress' }, 3072, ['WEB-1', 'WEB-7', 'WEB-2']],
    [
      'before X only: top of the column',
      { status: 'in_progress', after_task_id: null, before_task_id: MOCK_TASK_IDS.web1 },
      0,
      ['WEB-2', 'WEB-1', 'WEB-7'],
    ],
    [
      'after Y only: bottom of the column',
      { status: 'in_progress', after_task_id: MOCK_TASK_IDS.web7, before_task_id: null },
      3072,
      ['WEB-1', 'WEB-7', 'WEB-2'],
    ],
    [
      'between Y and X',
      { status: 'in_progress', after_task_id: MOCK_TASK_IDS.web1, before_task_id: MOCK_TASK_IDS.web7 },
      1536,
      ['WEB-1', 'WEB-2', 'WEB-7'],
    ],
    ['after Y in another column', { status: 'done', after_task_id: MOCK_TASK_IDS.web6 }, 2048, null],
  ])('%s', async (_case, body, position, column) => {
    as(ben)
    const response = await move(ids.web2, body)
    expect(response.status).toBe(200)
    const task = await json<Task>(response)
    expect(task).toMatchObject({ id: ids.web2, status: body.status, position })
    if (column) expect(columnKeys(website.id).in_progress).toEqual(column)
  })

  it('reorders within a column', async () => {
    as(ben)
    await move(ids.web4, { status: 'todo', after_task_id: null, before_task_id: ids.web2 })
    expect(columnKeys(website.id).todo).toEqual(['WEB-4', 'WEB-2', 'WEB-3'])
  })

  it('rejects neighbours that are not other tasks of this project in the target status', async () => {
    as(ben)
    // In another status.
    await expectFieldError(await move(ids.web2, { status: 'in_progress', after_task_id: ids.web3 }), 'after_task_id')
    // The moved task itself.
    await expectFieldError(await move(ids.web2, { status: 'todo', before_task_id: ids.web2 }), 'before_task_id')
    // Another project.
    await expectFieldError(await move(ids.web2, { status: 'todo', after_task_id: ids.app1 }), 'after_task_id')
    // Not a task at all, and not a UUID.
    await expectFieldError(await move(ids.web2, { status: 'todo', after_task_id: MISSING_ID }), 'after_task_id')
    await expectFieldError(await move(ids.web2, { status: 'todo', after_task_id: 'x' }), 'after_task_id')
    await expectFieldError(await move(ids.web2, {}), 'status')
    // Both reported when both are wrong.
    const both = await expectFieldError(
      await move(ids.web2, { status: 'todo', after_task_id: MISSING_ID, before_task_id: ids.app1 }),
      'after_task_id',
    )
    expect(both.details.errors?.map((error) => error.field)).toEqual(['after_task_id', 'before_task_id'])
  })

  it('wants before_task_id after after_task_id in the column', async () => {
    as(ben)
    await expectFieldError(
      await move(ids.web1, { status: 'todo', after_task_id: ids.web4, before_task_id: ids.web2 }),
      'before_task_id',
    )
    await expectFieldError(
      await move(ids.web1, { status: 'todo', after_task_id: ids.web3, before_task_id: ids.web3 }),
      'before_task_id',
    )
  })

  it('goes directly after after_task_id (or before before_task_id) when the column changed meanwhile', async () => {
    as(ben)
    // The client thought WEB-2 and WEB-4 were adjacent; WEB-3 sits between them.
    const between = await json<Task>(
      await move(ids.web1, { status: 'todo', after_task_id: ids.web2, before_task_id: ids.web4 }),
    )
    expect(between.position).toBe(1536)
    expect(columnKeys(website.id).todo).toEqual(['WEB-2', 'WEB-1', 'WEB-3', 'WEB-4'])

    // Only before_task_id, but it is not the top of the column any more.
    const before = await json<Task>(await move(ids.web7, { status: 'todo', before_task_id: ids.web4 }))
    expect(before.position).toBe(2560)
    expect(columnKeys(website.id).todo).toEqual(['WEB-2', 'WEB-1', 'WEB-3', 'WEB-7', 'WEB-4'])
  })

  it('rebalances the column, with the moved task in its place, when the gap is too small', async () => {
    as(ben)
    const [web3, web4] = [findTask(ids.web3), findTask(ids.web4)]
    if (!web3 || !web4) throw new Error('seed changed')
    web4.position = web3.position + 1e-7
    const response = await move(ids.web2, { status: 'todo', after_task_id: ids.web3, before_task_id: ids.web4 })

    expect((await json<Task>(response)).position).toBe(2048)
    const positions = tasksOf(website.id)
      .filter((task) => task.status === 'todo')
      .map((task) => [task.number, task.position])
    expect(positions.sort((a, b) => a[0] - b[0])).toEqual([
      [2, 2048],
      [3, 1024],
      [4, 3072],
    ])
    expect(columnKeys(website.id).todo).toEqual(['WEB-3', 'WEB-2', 'WEB-4'])
    // Other columns never change.
    expect(findTask(ids.web1)?.position).toBe(1024)
  })

  it('answers 403 to viewers, 409 in archived projects and 404 to non-members', async () => {
    as(chen)
    await expectError(await move(ids.web2, { status: 'done' }), 403, 'forbidden', 'insufficient_role')
    as(asha)
    await expectError(await move(ids.crm1, { status: 'done' }), 409, 'conflict', 'project_archived')
    as(dana)
    await expectError(await move(ids.ops1, { status: 'done' }), 404, 'not_found')
  })
})

describe('GET /me/tasks', () => {
  it('lists my tasks in all my workspaces by due date (none last), without archived projects', async () => {
    as(asha)
    const response = await call('GET', '/me/tasks')
    expect(response.status).toBe(200)
    const tasks = await json<MyTask[]>(response)
    expect(keys(tasks)).toEqual(['WEB-3', 'OPS-1', 'WEB-5', 'WEB-7', 'APP-1'])
    expect(tasks[1]).toMatchObject({
      key: 'OPS-1',
      assignee: { id: asha.id, name: 'Asha Rao' },
      project: { id: operations.id, name: 'Operations', key: 'OPS' },
      workspace: { id: operations.workspace_id, name: 'Globex', slug: 'globex' },
    })
  })

  it('filters by status and due_before; 422 for bad values; 401 when logged out', async () => {
    expect((await call('GET', '/me/tasks')).status).toBe(401)
    as(ben)
    expect(keys(await json<MyTask[]>(await call('GET', '/me/tasks')))).toEqual(['WEB-6', 'APP-2', 'WEB-1', 'OPS-2'])
    expect(keys(await json<MyTask[]>(await call('GET', '/me/tasks?status=todo&status=in_progress&status=in_review'))))
      .toEqual(['APP-2', 'WEB-1', 'OPS-2'])
    expect(keys(await json<MyTask[]>(await call('GET', `/me/tasks?due_before=${addDays(todayDateOnly(), 5)}`))))
      .toEqual(['WEB-6', 'APP-2'])
    await expectFieldError(await call('GET', '/me/tasks?status=open'), 'status.0', 'query')
    await expectFieldError(await call('GET', '/me/tasks?due_before=soon'), 'due_before', 'query')
  })

  it('is empty for a user without tasks', async () => {
    as(eve)
    expect(await json<MyTask[]>(await call('GET', '/me/tasks'))).toEqual([])
  })
})
