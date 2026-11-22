// Keeps the activity mock honest: the feed must answer like contract 1.6, 1.10 and 3.8, and every
// mutation handler must record the entries (and metadata shapes) of the contract's table.
import { describe, expect, it } from 'vitest'
import type { ActivityPage, ActivityRead, Task } from '../../api/types'
import {
  activityOf,
  db,
  MOCK_COMMENT_IDS,
  MOCK_PROJECTS,
  MOCK_TASK_IDS,
  MOCK_USERS,
  MOCK_WORKSPACES,
  recordActivity,
  startMockSession,
} from '../db'

const { asha, ben, chen, dana, eve } = MOCK_USERS
const { acme, globex } = MOCK_WORKSPACES
const { website, legacy, operations } = MOCK_PROJECTS
const tasks = MOCK_TASK_IDS
const HEADERS = { 'Content-Type': 'application/json', 'X-Requested-With': 'taskboard' }
const WEB1_REF = { id: tasks.web1, key: 'WEB-1', title: 'Fix login redirect' }
const WEBSITE_REF = { id: website.id, name: 'Website', key: 'WEB' }

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

async function feed(query = '', workspaceId: string = acme.id): Promise<ActivityPage> {
  const response = await call('GET', `/workspaces/${workspaceId}/activity${query}`)
  expect(response.status).toBe(200)
  return json<ActivityPage>(response)
}

/** Follows `next_cursor` to the end. */
async function wholeFeed(query = '', workspaceId: string = acme.id): Promise<ActivityRead[]> {
  const items: ActivityRead[] = []
  let cursor: string | null = null
  do {
    const separator = query ? '&' : '?'
    const page: ActivityPage = await feed(cursor ? `${query}${separator}cursor=${encodeURIComponent(cursor)}` : query, workspaceId)
    items.push(...page.items)
    cursor = page.next_cursor
  } while (cursor)
  return items
}

/** The newest entries of Acme (as the API returns them), newest first. */
async function newest(count: number, workspaceId: string = acme.id): Promise<ActivityRead[]> {
  return (await feed(`?limit=${count}`, workspaceId)).items
}

async function expectFieldError(response: Response, field: string, location: string) {
  expect(response.status).toBe(422)
  const body = await json<{ error: { code: string; details: { errors: { field: string; location: string }[] } } }>(response)
  expect(body.error.code).toBe('validation_error')
  expect(body.error.details.errors).toContainEqual(expect.objectContaining({ field, location }))
}

const as = (user: { id: string }) => startMockSession(user.id)
const actions = (items: ActivityRead[]) => items.map((item) => item.action)
const isNewestFirst = (items: ActivityRead[]) =>
  items.every(
    (item, index) =>
      index === 0 ||
      items[index - 1].created_at > item.created_at ||
      (items[index - 1].created_at === item.created_at && items[index - 1].id > item.id),
  )

describe('GET /workspaces/{wid}/activity', () => {
  it('returns entries with every documented field, newest first', async () => {
    as(chen)
    const page = await feed()

    expect(page.items).toHaveLength(20)
    expect(isNewestFirst(page.items)).toBe(true)
    expect(Object.keys(page.items[0]).sort()).toEqual(
      [
        'action',
        'actor',
        'created_at',
        'entity_id',
        'entity_type',
        'id',
        'metadata',
        'project_id',
        'task_id',
        'workspace_id',
      ].sort(),
    )
    expect(page.items[0]).toMatchObject({
      workspace_id: acme.id,
      project_id: website.id,
      task_id: tasks.web7,
      actor: { id: asha.id, name: 'Asha Rao' },
      action: 'task.updated',
      entity_type: 'task',
      entity_id: tasks.web7,
      metadata: { task: { id: tasks.web7, key: 'WEB-7', title: 'Accessibility audit' }, changed_fields: ['description'] },
    })
  })

  it('pages with next_cursor without skipping or repeating, null on the last page', async () => {
    as(asha)
    const first = await feed('?limit=10')
    expect(first.items).toHaveLength(10)
    expect(first.next_cursor).toEqual(expect.any(String))

    const all = await wholeFeed('?limit=10')
    expect(all).toHaveLength(activityOf(acme.id).length)
    expect(new Set(all.map((item) => item.id)).size).toBe(all.length)
    expect(isNewestFirst(all)).toBe(true)

    // A last page exactly `limit` long still has a null cursor.
    const exact = await feed(`?limit=${all.length}`)
    expect(exact.items).toHaveLength(all.length)
    expect(exact.next_cursor).toBeNull()
  })

  it('keeps a cursor valid while entries are added: older pages stay the same', async () => {
    as(asha)
    const first = await feed('?limit=5')
    recordActivity({
      workspace_id: acme.id,
      project_id: null,
      task_id: null,
      actor_id: asha.id,
      action: 'workspace.renamed',
      entity_type: 'workspace',
      entity_id: acme.id,
      metadata: { before: { name: 'Acme' }, after: { name: 'Acme Inc' } },
    })
    const second = await feed(`?limit=5&cursor=${first.next_cursor}`)
    const expected = activityOf(acme.id).slice(6, 11).map((entry) => entry.id)
    expect(second.items.map((item) => item.id)).toEqual(expected)
  })

  it('filters by project, task and actor, combined with AND', async () => {
    as(asha)
    const byProject = await wholeFeed(`?project_id=${website.id}`)
    expect(byProject.length).toBeGreaterThan(0)
    expect(byProject.every((item) => item.project_id === website.id)).toBe(true)

    const byTask = await wholeFeed(`?task_id=${tasks.web1}`)
    expect(actions(byTask)).toEqual([
      'comment.edited',
      'comment.created',
      'comment.created',
      'task.moved',
      'task.due_date_changed',
      'task.assigned',
      'task.created',
    ])

    const byActor = await wholeFeed(`?actor_id=${dana.id}`)
    expect(byActor.map((item) => item.actor.id)).toEqual(byActor.map(() => dana.id))
    expect(actions(byActor)).toEqual(['comment.created', 'task.created', 'project.created'])

    const both = await wholeFeed(`?project_id=${website.id}&actor_id=${ben.id}`)
    expect(actions(both)).toEqual(['comment.created', 'comment.created', 'task.moved'])
  })

  it('matches nothing (never 404) for ids of another workspace or unknown ids', async () => {
    as(asha)
    expect(await feed(`?project_id=${operations.id}`)).toEqual({ items: [], next_cursor: null })
    expect(await feed(`?task_id=${tasks.ops1}`)).toEqual({ items: [], next_cursor: null })
    expect(await feed(`?actor_id=${eve.id}`)).toEqual({ items: [], next_cursor: null })
  })

  it('is per workspace', async () => {
    as(asha)
    const items = await wholeFeed('', globex.id)
    expect(items).toHaveLength(6)
    expect(items.every((item) => item.workspace_id === globex.id)).toBe(true)
  })

  it('422s on bad limits, cursors and filter ids', async () => {
    as(asha)
    const path = `/workspaces/${acme.id}/activity`
    await expectFieldError(await call('GET', `${path}?limit=0`), 'limit', 'query')
    await expectFieldError(await call('GET', `${path}?limit=101`), 'limit', 'query')
    await expectFieldError(await call('GET', `${path}?limit=ten`), 'limit', 'query')
    await expectFieldError(await call('GET', `${path}?cursor=`), 'cursor', 'query')
    await expectFieldError(await call('GET', `${path}?cursor=nope`), 'cursor', 'query')
    await expectFieldError(await call('GET', `${path}?project_id=nope`), 'project_id', 'query')
    await expectFieldError(await call('GET', `${path}?task_id=1`), 'task_id', 'query')
    await expectFieldError(await call('GET', `${path}?actor_id=x`), 'actor_id', 'query')
  })

  it('404s for non-members (any role may read), 401s when logged out', async () => {
    as(eve)
    expect((await call('GET', `/workspaces/${acme.id}/activity`)).status).toBe(404)
    as(chen)
    expect((await call('GET', `/workspaces/${globex.id}/activity`)).status).toBe(404)
    expect((await call('GET', `/workspaces/${acme.id}/activity`)).status).toBe(200)
    db.sessionUserId = null
    expect((await call('GET', `/workspaces/${acme.id}/activity`)).status).toBe(401)
  })
})

describe('mutations record activity (contract 3.8 table)', () => {
  it('workspace created and renamed; an unchanged name records nothing', async () => {
    as(eve)
    const created = await json<{ id: string }>(await call('POST', '/workspaces', { name: 'Initech' }))
    expect(await newest(1, created.id)).toEqual([
      expect.objectContaining({
        action: 'workspace.created',
        entity_type: 'workspace',
        entity_id: created.id,
        project_id: null,
        task_id: null,
        actor: { id: eve.id, name: 'Eve Santos' },
        metadata: { name: 'Initech' },
      }),
    ])

    await call('PATCH', `/workspaces/${created.id}`, { name: 'Initech' })
    await call('PATCH', `/workspaces/${created.id}`, {})
    await call('PATCH', `/workspaces/${created.id}`, { name: 'Initech Inc' })
    const items = await wholeFeed('', created.id)
    expect(actions(items)).toEqual(['workspace.renamed', 'workspace.created'])
    expect(items[0].metadata).toEqual({ before: { name: 'Initech' }, after: { name: 'Initech Inc' } })
  })

  it('member added, role changed (not for the same role), removed and left', async () => {
    as(asha)
    await call('POST', `/workspaces/${acme.id}/members`, { email: 'eve@example.com', role: 'viewer' })
    await call('PATCH', `/workspaces/${acme.id}/members/${eve.id}`, { role: 'viewer' })
    await call('PATCH', `/workspaces/${acme.id}/members/${eve.id}`, { role: 'member' })
    await call('DELETE', `/workspaces/${acme.id}/members/${eve.id}`)
    as(ben)
    await call('DELETE', `/workspaces/${acme.id}/members/${ben.id}`)

    as(asha)
    const [left, removed, changed, added] = await newest(4)
    const eveRef = { id: eve.id, name: 'Eve Santos' }
    expect(added).toMatchObject({
      action: 'member.added',
      entity_type: 'member',
      entity_id: eve.id,
      actor: { id: asha.id },
      metadata: { user: eveRef, role: 'viewer' },
    })
    expect(changed).toMatchObject({
      action: 'member.role_changed',
      entity_id: eve.id,
      metadata: { user: eveRef, before: { role: 'viewer' }, after: { role: 'member' } },
    })
    expect(removed).toMatchObject({
      action: 'member.removed',
      actor: { id: asha.id },
      metadata: { user: eveRef, role: 'member', self_removal: false },
    })
    expect(left).toMatchObject({
      action: 'member.removed',
      actor: { id: ben.id },
      entity_id: ben.id,
      metadata: { user: { id: ben.id, name: 'Ben Okafor' }, role: 'member', self_removal: true },
    })
  })

  it('project created, updated (changed fields only, no description values) and archived', async () => {
    as(dana)
    const project = await json<{ id: string }>(
      await call('POST', `/workspaces/${acme.id}/projects`, { name: 'Billing', key: 'BIL', description: 'Invoices' }),
    )
    const ref = { id: project.id, name: 'Billing', key: 'BIL' }
    await call('PATCH', `/projects/${project.id}`, { name: 'Billing', description: 'Invoices' })
    await call('PATCH', `/projects/${project.id}`, { description: 'Invoices and refunds' })
    await call('PATCH', `/projects/${project.id}`, { name: 'Payments', description: null })
    await call('POST', `/projects/${project.id}/archive`)

    const items = await wholeFeed(`?project_id=${project.id}`)
    expect(actions(items)).toEqual(['project.archived', 'project.updated', 'project.updated', 'project.created'])
    const [archived, renamed, described, created] = items
    expect(created).toMatchObject({ entity_type: 'project', entity_id: project.id, task_id: null, metadata: { project: ref } })
    expect(described.metadata).toEqual({ project: ref, changed_fields: ['description'], before: {}, after: {} })
    expect(renamed.metadata).toEqual({
      project: { ...ref, name: 'Payments' },
      changed_fields: ['name', 'description'],
      before: { name: 'Billing' },
      after: { name: 'Payments' },
    })
    expect(archived.metadata).toEqual({ project: { ...ref, name: 'Payments' } })
  })

  it('task created', async () => {
    as(ben)
    const task = await json<Task>(await call('POST', `/projects/${website.id}/tasks`, { title: 'New page', status: 'in_review' }))
    expect(await newest(1)).toEqual([
      expect.objectContaining({
        action: 'task.created',
        entity_type: 'task',
        entity_id: task.id,
        project_id: website.id,
        task_id: task.id,
        actor: { id: ben.id, name: 'Ben Okafor' },
        metadata: { task: { id: task.id, key: task.key, title: 'New page' }, status: 'in_review' },
      }),
    ])
  })

  it('one PATCH records updated, assigned, due date and moved, with the snapshot after the change', async () => {
    as(ben)
    await call('PATCH', `/tasks/${tasks.web1}`, {
      title: 'Fix the login redirect',
      description: 'New text',
      priority: 'urgent',
      assignee_id: dana.id,
      due_date: '2026-12-24',
      status: 'done',
    })
    const items = await wholeFeed(`?task_id=${tasks.web1}&actor_id=${ben.id}`)
    const [moved, due, assigned, updated] = items
    const task = { ...WEB1_REF, title: 'Fix the login redirect' }
    expect(actions(items).slice(0, 4)).toEqual(['task.moved', 'task.due_date_changed', 'task.assigned', 'task.updated'])
    expect(updated.metadata).toEqual({
      task,
      changed_fields: ['title', 'description', 'priority'],
      before: { title: 'Fix login redirect', priority: 'high' },
      after: { title: 'Fix the login redirect', priority: 'urgent' },
    })
    expect(assigned.metadata).toEqual({
      task,
      before: { assignee: { id: ben.id, name: 'Ben Okafor' } },
      after: { assignee: { id: dana.id, name: 'Dana Kim' } },
    })
    expect(due.metadata).toEqual({ task, before: { due_date: expect.any(String) }, after: { due_date: '2026-12-24' } })
    expect(moved.metadata).toEqual({ task, before: { status: 'in_progress' }, after: { status: 'done' } })
  })

  it('a PATCH that changes nothing records nothing; clearing records null values', async () => {
    as(ben)
    const before = db.activity.length
    await call('PATCH', `/tasks/${tasks.web1}`, {})
    await call('PATCH', `/tasks/${tasks.web1}`, { title: 'Fix login redirect', priority: 'high' })
    expect(db.activity.length).toBe(before)

    await call('PATCH', `/tasks/${tasks.web1}`, { assignee_id: null, due_date: null })
    const [due, assigned] = await newest(2)
    expect(assigned.metadata).toEqual({
      task: WEB1_REF,
      before: { assignee: { id: ben.id, name: 'Ben Okafor' } },
      after: { assignee: null },
    })
    expect(due.metadata).toMatchObject({ after: { due_date: null } })
  })

  it('move records task.moved, also within one column', async () => {
    as(ben)
    await call('POST', `/tasks/${tasks.web1}/move`, { status: 'in_review' })
    await call('POST', `/tasks/${tasks.web4}/move`, { status: 'todo', before_task_id: tasks.web2 })
    const [reordered, moved] = await newest(2)
    expect(moved.metadata).toEqual({ task: WEB1_REF, before: { status: 'in_progress' }, after: { status: 'in_review' } })
    expect(reordered.metadata).toEqual({
      task: { id: tasks.web4, key: 'WEB-4', title: 'Set up analytics' },
      before: { status: 'todo' },
      after: { status: 'todo' },
    })
  })

  it('a move that leaves the task in the same place records nothing', async () => {
    as(ben)
    const move = { status: 'todo', before_task_id: tasks.web2 }
    expect((await call('POST', `/tasks/${tasks.web4}/move`, move)).status).toBe(200)
    const [first] = await newest(1)
    expect(first.action).toBe('task.moved')

    expect((await call('POST', `/tasks/${tasks.web4}/move`, move)).status).toBe(200)
    const [latest] = await newest(1)
    expect(latest.id).toBe(first.id)
  })

  it('task deleted: the entries stay with their snapshots, unlinked from the task', async () => {
    as(asha)
    await call('DELETE', `/tasks/${tasks.web1}`)
    const [deleted] = await newest(1)
    expect(deleted).toMatchObject({
      action: 'task.deleted',
      entity_type: 'task',
      entity_id: tasks.web1,
      project_id: website.id,
      task_id: null,
      metadata: { task: WEB1_REF },
    })
    expect(await feed(`?task_id=${tasks.web1}`)).toEqual({ items: [], next_cursor: null })
    const history = (await wholeFeed()).filter((item) => (item.metadata.task as { id?: string } | undefined)?.id === tasks.web1)
    expect(history.length).toBeGreaterThan(5)
    expect(history.every((item) => item.task_id === null)).toBe(true)
  })

  it('comment created, edited (not when unchanged) and deleted', async () => {
    as(ben)
    const body = `${'Long comment '.repeat(20)}end`
    const comment = await json<{ id: string }>(await call('POST', `/tasks/${tasks.web1}/comments`, { body }))
    await call('PATCH', `/comments/${comment.id}`, { body })
    await call('PATCH', `/comments/${comment.id}`, { body: 'Short now' })
    as(asha)
    await call('DELETE', `/comments/${comment.id}`)

    const [deleted, edited, created] = await newest(3)
    expect(created).toMatchObject({
      action: 'comment.created',
      entity_type: 'comment',
      entity_id: comment.id,
      project_id: website.id,
      task_id: tasks.web1,
      actor: { id: ben.id },
      metadata: { task: WEB1_REF, excerpt: body.slice(0, 140) },
    })
    expect(created.metadata.excerpt).toHaveLength(140)
    expect(edited.metadata).toEqual({ task: WEB1_REF, excerpt: 'Short now' })
    expect(deleted).toMatchObject({ action: 'comment.deleted', actor: { id: asha.id }, metadata: { task: WEB1_REF } })
  })

  it('a rejected request records nothing', async () => {
    const before = db.activity.length
    as(chen)
    expect((await call('POST', `/projects/${website.id}/tasks`, { title: 'Nope' })).status).toBe(403)
    expect((await call('POST', `/tasks/${tasks.web1}/comments`, { body: 'Nope' })).status).toBe(403)
    as(ben)
    expect((await call('POST', `/projects/${legacy.id}/tasks`, { title: 'Nope' })).status).toBe(409)
    expect((await call('PATCH', `/tasks/${tasks.web1}`, { title: '' })).status).toBe(422)
    expect((await call('PATCH', `/projects/${website.id}`, { name: 'Nope' })).status).toBe(403)
    expect((await call('DELETE', `/comments/${MOCK_COMMENT_IDS.web5Dana}`)).status).toBe(403)
    expect(db.activity.length).toBe(before)
  })

  it('deleting a workspace deletes its activity', async () => {
    as(asha)
    await call('DELETE', `/workspaces/${acme.id}`)
    expect(activityOf(acme.id)).toEqual([])
    expect(activityOf(globex.id)).toHaveLength(6)
  })
})

describe('seeded history', () => {
  it('matches the seeded data: the newest comment entries point at the seeded comments', async () => {
    as(asha)
    const items = await wholeFeed()
    expect(items).toHaveLength(25)
    const commentIds = items.filter((item) => item.entity_type === 'comment').map((item) => item.entity_id)
    expect(new Set(commentIds)).toEqual(new Set(Object.values(MOCK_COMMENT_IDS)))
    expect(items.at(-1)).toMatchObject({ action: 'workspace.created', metadata: { name: 'Acme' } })
    expect(items.find((item) => item.action === 'project.created' && item.project_id === website.id)?.metadata).toEqual({
      project: WEBSITE_REF,
    })
  })
})
