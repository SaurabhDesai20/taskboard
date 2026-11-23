// Keeps the workspace and member mocks honest: they must answer like contract 1.10, 3.3 and 3.4.
import { beforeEach, describe, expect, it } from 'vitest'
import type { Member, Workspace } from '../../api/types'
import { MOCK_USERS, MOCK_WORKSPACES, startMockSession } from '../db'

const { asha, ben, chen, dana, eve } = MOCK_USERS
const { acme, globex } = MOCK_WORKSPACES
const MISSING_ID = '20000000-0000-4000-8000-0000000000ff'

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

async function expectError(response: Response, status: number, code: string, reason?: string) {
  expect(response.status).toBe(status)
  const body = await json<{ error: { code: string; message: string; details: Record<string, unknown> } }>(
    response,
  )
  expect(body.error.code).toBe(code)
  expect(body.error.message).not.toBe('')
  if (reason) expect(body.error.details.reason).toBe(reason)
  return body.error
}

const as = (user: { id: string }) => startMockSession(user.id)

describe('GET /workspaces', () => {
  it('lists my workspaces ordered by name, with my role', async () => {
    as(asha)
    const response = await call('GET', '/workspaces')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual([
      { ...acme, my_role: 'owner' },
      { ...globex, my_role: 'member' },
    ])
  })

  it('returns an empty list for a user without workspaces, and 401 when logged out', async () => {
    expect((await call('GET', '/workspaces')).status).toBe(401)
    as(eve)
    expect(await (await call('GET', '/workspaces')).json()).toEqual([])
  })
})

describe('POST /workspaces', () => {
  beforeEach(() => as(eve))

  it('creates a workspace with an explicit slug; the creator becomes owner', async () => {
    const response = await call('POST', '/workspaces', { name: '  Initech ', slug: 'initech-hq' })

    expect(response.status).toBe(201)
    const created = await json<Workspace>(response)
    expect(created).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      name: 'Initech',
      slug: 'initech-hq',
      created_by: eve.id,
      created_at: expect.stringMatching(/Z$/),
      my_role: 'owner',
    })
    expect(await json<Workspace[]>(await call('GET', '/workspaces'))).toEqual([created])
  })

  it('derives the slug from the name and appends -2, -3 when it is taken', async () => {
    const slugs: string[] = []
    for (const body of [{ name: 'Acme!' }, { name: 'ACME', slug: null }, { name: 'Café Bar' }]) {
      const response = await call('POST', '/workspaces', body)
      expect(response.status).toBe(201)
      slugs.push((await json<Workspace>(response)).slug)
    }
    expect(slugs).toEqual(['acme-2', 'acme-3', 'caf-bar'])
  })

  it('rejects a taken explicit slug with 409 slug_taken', async () => {
    await expectError(await call('POST', '/workspaces', { name: 'Other', slug: 'acme' }), 409, 'conflict', 'slug_taken')
  })

  it('lists every invalid field in a 422', async () => {
    const response = await call('POST', '/workspaces', { name: ' ', slug: 'Not A Slug' })
    const error = await expectError(response, 422, 'validation_error')
    expect((error.details.errors as { field: string }[]).map((entry) => entry.field)).toEqual(['name', 'slug'])
  })
})

describe('GET/PATCH/DELETE /workspaces/{wid}', () => {
  it('returns the workspace to members and 404 to everyone else', async () => {
    as(chen)
    expect(await (await call('GET', `/workspaces/${acme.id}`)).json()).toEqual({ ...acme, my_role: 'viewer' })
    await expectError(await call('GET', `/workspaces/${globex.id}`), 404, 'not_found')
    await expectError(await call('GET', `/workspaces/${MISSING_ID}`), 404, 'not_found')
    await expectError(await call('GET', '/workspaces/not-a-uuid'), 422, 'validation_error')
  })

  it('lets only owners rename; non-members get 404', async () => {
    as(dana)
    await expectError(await call('PATCH', `/workspaces/${acme.id}`, { name: 'X' }), 403, 'forbidden', 'insufficient_role')
    await expectError(await call('PATCH', `/workspaces/${globex.id}`, { name: 'X' }), 404, 'not_found')

    as(asha)
    await expectError(await call('PATCH', `/workspaces/${acme.id}`, { name: null }), 422, 'validation_error')
    const response = await call('PATCH', `/workspaces/${acme.id}`, { name: ' Acme Inc ', slug: 'ignored' })
    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...acme, name: 'Acme Inc', my_role: 'owner' })
    expect(await (await call('PATCH', `/workspaces/${acme.id}`, {})).json()).toMatchObject({ name: 'Acme Inc' })
  })

  it('lets only owners delete, then the workspace is gone', async () => {
    as(dana)
    await expectError(await call('DELETE', `/workspaces/${acme.id}`), 403, 'forbidden', 'insufficient_role')

    as(asha)
    const response = await call('DELETE', `/workspaces/${acme.id}`)
    expect(response.status).toBe(204)
    expect(await response.text()).toBe('')
    await expectError(await call('GET', `/workspaces/${acme.id}`), 404, 'not_found')
    await expectError(await call('GET', `/workspaces/${acme.id}/members`), 404, 'not_found')
  })

  it('requires the CSRF header on mutations', async () => {
    as(asha)
    const response = await fetch(new URL(`/api/workspaces/${acme.id}`, window.location.origin), {
      method: 'DELETE',
    })
    await expectError(response, 403, 'forbidden', 'csrf')
  })
})

describe('GET /workspaces/{wid}/members', () => {
  it('orders members by role, then name', async () => {
    as(chen)
    const members = await json<Member[]>(await call('GET', `/workspaces/${acme.id}/members`))

    expect(members.map((member) => [member.name, member.role])).toEqual([
      [asha.name, 'owner'],
      [dana.name, 'admin'],
      [ben.name, 'member'],
      [chen.name, 'viewer'],
    ])
    expect(members[0]).toEqual({
      user_id: asha.id,
      email: asha.email,
      name: asha.name,
      role: 'owner',
      joined_at: '2026-11-22T09:05:00Z',
    })
  })

  it('answers 404 to non-members', async () => {
    as(eve)
    await expectError(await call('GET', `/workspaces/${acme.id}/members`), 404, 'not_found')
  })
})

describe('POST /workspaces/{wid}/members', () => {
  const add = (body: unknown) => call('POST', `/workspaces/${acme.id}/members`, body)

  it('lets an admin add an existing user by email (any case) as member or viewer', async () => {
    as(dana)
    const response = await add({ email: ' EVE@example.com ', role: 'viewer' })

    expect(response.status).toBe(201)
    expect(await response.json()).toEqual({
      user_id: eve.id,
      email: eve.email,
      name: eve.name,
      role: 'viewer',
      joined_at: expect.stringMatching(/Z$/),
    })
  })

  it('answers each failure with the contract status and reason', async () => {
    as(ben)
    await expectError(await add({ email: eve.email, role: 'member' }), 403, 'forbidden', 'insufficient_role')

    as(dana)
    await expectError(await add({ email: eve.email, role: 'admin' }), 403, 'forbidden', 'protected_member')
    const noUser = await expectError(await add({ email: 'nobody@example.com', role: 'member' }), 422, 'validation_error')
    expect(noUser.details.errors).toEqual([{ field: 'email', location: 'body', message: 'No user with this email' }])
    await expectError(await add({ email: ben.email, role: 'member' }), 409, 'conflict', 'already_member')
    await expectError(await add({ email: 'nope', role: 'boss' }), 422, 'validation_error')

    as(asha)
    expect((await add({ email: eve.email, role: 'owner' })).status).toBe(201)
  })
})

describe('PATCH /workspaces/{wid}/members/{uid}', () => {
  const patch = (uid: string, role: string) => call('PATCH', `/workspaces/${acme.id}/members/${uid}`, { role })

  it('lets owners change any other role, including granting owner', async () => {
    as(asha)
    const response = await patch(ben.id, 'admin')
    expect(response.status).toBe(200)
    expect(await response.json()).toMatchObject({ user_id: ben.id, role: 'admin' })
    expect((await patch(dana.id, 'owner')).status).toBe(200)
  })

  it('applies the own-role, protected-member and not-found rules', async () => {
    as(asha)
    await expectError(await patch(asha.id, 'admin'), 403, 'forbidden', 'own_role')
    await expectError(await patch(eve.id, 'member'), 404, 'not_found')
    await expectError(await patch(ben.id, 'boss'), 422, 'validation_error')

    as(dana)
    expect((await patch(ben.id, 'viewer')).status).toBe(200)
    await expectError(await patch(asha.id, 'member'), 403, 'forbidden', 'protected_member')
    await expectError(await patch(chen.id, 'admin'), 403, 'forbidden', 'protected_member')

    as(ben)
    await expectError(await patch(chen.id, 'member'), 403, 'forbidden', 'insufficient_role')
  })

  it('treats role as optional: {} returns the member unchanged, null is a 422', async () => {
    as(dana)
    const unchanged = await call('PATCH', `/workspaces/${acme.id}/members/${ben.id}`, {})
    expect(unchanged.status).toBe(200)
    expect(await unchanged.json()).toMatchObject({ user_id: ben.id, role: 'member' })
    await expectError(await call('PATCH', `/workspaces/${acme.id}/members/${ben.id}`, { role: null }), 422, 'validation_error')
    // The permission checks still apply to an empty body.
    await expectError(await call('PATCH', `/workspaces/${acme.id}/members/${asha.id}`, {}), 403, 'forbidden', 'protected_member')
  })

  it('uses the contract messages for protected members', async () => {
    as(dana)
    expect((await expectError(await patch(asha.id, 'member'), 403, 'forbidden')).message).toBe(
      'Only owners can change or remove owners and admins',
    )
    expect((await expectError(await patch(ben.id, 'owner'), 403, 'forbidden')).message).toBe(
      'Only owners can grant the admin or owner role',
    )
  })
})

describe('ordering is case-insensitive', () => {
  it('sorts workspaces and members by lowercased name', async () => {
    as(asha)
    await call('POST', '/workspaces', { name: 'beta' })
    const names = (await json<Workspace[]>(await call('GET', '/workspaces'))).map((workspace) => workspace.name)
    expect(names).toEqual(['Acme', 'beta', 'Globex'])
  })
})

describe('DELETE /workspaces/{wid}/members/{uid}', () => {
  const remove = (uid: string) => call('DELETE', `/workspaces/${acme.id}/members/${uid}`)

  it('lets any member leave, except the last owner', async () => {
    as(chen)
    expect((await remove(chen.id)).status).toBe(204)
    await expectError(await call('GET', `/workspaces/${acme.id}`), 404, 'not_found')

    as(asha)
    const lastOwner = await expectError(await remove(asha.id), 409, 'conflict', 'last_owner')
    expect(lastOwner.message).toBe('You are the only owner. Make another member an owner before leaving the workspace')
    expect((await call('PATCH', `/workspaces/${acme.id}/members/${ben.id}`, { role: 'owner' })).status).toBe(200)
    expect((await remove(asha.id)).status).toBe(204)
  })

  it('lets admins remove only members and viewers, and owners remove anyone', async () => {
    as(ben)
    await expectError(await remove(chen.id), 403, 'forbidden', 'insufficient_role')

    as(dana)
    await expectError(await remove(asha.id), 403, 'forbidden', 'protected_member')
    expect((await remove(chen.id)).status).toBe(204)
    await expectError(await remove(chen.id), 404, 'not_found')

    as(asha)
    expect((await remove(dana.id)).status).toBe(204)
  })
})
