// Keeps the project mocks honest: they must answer like contract 1.10 and 3.5.
import { describe, expect, it } from 'vitest'
import type { Project } from '../../api/types'
import { deleteWorkspace, findProject, MOCK_PROJECTS, MOCK_USERS, MOCK_WORKSPACES, startMockSession } from '../db'

const { asha, ben, chen, dana, eve } = MOCK_USERS
const { acme, globex } = MOCK_WORKSPACES
const { website, mobile, legacy, operations } = MOCK_PROJECTS
const MISSING_ID = '30000000-0000-4000-8000-0000000000ff'

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
const names = (projects: Project[]) => projects.map((project) => project.name)

describe('GET /workspaces/{wid}/projects', () => {
  it('lists active projects ordered by name, to any member', async () => {
    as(chen)
    const response = await call('GET', `/workspaces/${acme.id}/projects`)

    expect(response.status).toBe(200)
    const projects = await json<Project[]>(response)
    expect(projects).toEqual([mobile, website])
  })

  it('includes archived projects with include_archived=true', async () => {
    as(chen)
    const all = await json<Project[]>(await call('GET', `/workspaces/${acme.id}/projects?include_archived=true`))
    expect(names(all)).toEqual(['Legacy CRM', 'Mobile App', 'Website'])
    expect(all[0]).toEqual(legacy)

    const active = await json<Project[]>(await call('GET', `/workspaces/${acme.id}/projects?include_archived=false`))
    expect(names(active)).toEqual(['Mobile App', 'Website'])
    await expectError(await call('GET', `/workspaces/${acme.id}/projects?include_archived=maybe`), 422, 'validation_error')
  })

  it('answers 404 to non-members and 401 when logged out', async () => {
    expect((await call('GET', `/workspaces/${acme.id}/projects`)).status).toBe(401)
    as(chen)
    await expectError(await call('GET', `/workspaces/${globex.id}/projects`), 404, 'not_found')
  })
})

describe('POST /workspaces/{wid}/projects', () => {
  const create = (body: unknown, wid: string = acme.id) => call('POST', `/workspaces/${wid}/projects`, body)

  it('lets admins and owners create a project (trimmed, description optional)', async () => {
    as(dana)
    const response = await create({ name: '  Docs ', key: ' DOC ', description: '  Handbook ' })

    expect(response.status).toBe(201)
    const created = await json<Project>(response)
    expect(created).toEqual({
      id: expect.stringMatching(/^[0-9a-f-]{36}$/),
      workspace_id: acme.id,
      name: 'Docs',
      key: 'DOC',
      description: 'Handbook',
      archived_at: null,
      created_by: dana.id,
      created_at: expect.stringMatching(/Z$/),
    })

    as(asha)
    expect(await json<Project>(await create({ name: 'Ops', key: 'OPS' }))).toMatchObject({ description: null })
  })

  it('answers each failure with the contract status and reason, in order', async () => {
    as(eve)
    await expectError(await create({}), 404, 'not_found')

    as(ben)
    await expectError(await create({ name: 'X', key: 'XX' }), 403, 'forbidden', 'insufficient_role')
    as(chen)
    await expectError(await create({}), 403, 'forbidden', 'insufficient_role')

    as(asha)
    const invalid = await expectError(await create({ name: ' ', key: 'web', description: 'x'.repeat(2001) }), 422, 'validation_error')
    expect((invalid.details.errors as { field: string }[]).map((entry) => entry.field)).toEqual(['name', 'key', 'description'])
    await expectError(await create({ name: 'Another', key: 'WEB' }), 409, 'conflict', 'project_key_taken')
    // Archived projects keep their key.
    await expectError(await create({ name: 'Another', key: 'CRM' }), 409, 'conflict', 'project_key_taken')
  })

  it('uses the contract messages for 403, 409 and 404', async () => {
    as(ben)
    expect((await expectError(await create({ name: 'X', key: 'XX' }), 403, 'forbidden')).message).toBe(
      'Only owners and admins can create, edit or archive projects',
    )
    as(asha)
    expect((await expectError(await create({ name: 'X', key: 'WEB' }), 409, 'conflict')).message).toBe(
      'This project key is already used in this workspace',
    )
    expect((await expectError(await call('POST', `/projects/${legacy.id}/archive`), 409, 'conflict')).message).toBe(
      'This project is already archived',
    )
    expect((await expectError(await call('GET', `/projects/${MISSING_ID}`), 404, 'not_found')).message).toBe(
      'Project not found',
    )
  })

  it('orders by name case-insensitively, then by key', async () => {
    as(asha)
    await create({ name: 'website', key: 'AAA' })
    await create({ name: 'beta', key: 'BETA' })
    const projects = await json<Project[]>(await call('GET', `/workspaces/${acme.id}/projects`))
    expect(projects.map((project) => `${project.name}/${project.key}`)).toEqual([
      'beta/BETA',
      'Mobile App/APP',
      'website/AAA',
      'Website/WEB',
    ])
  })

  it('makes keys unique per workspace only', async () => {
    as(asha)
    expect((await create({ name: 'Acme ops', key: operations.key })).status).toBe(201)
  })
})

describe('GET /projects/{pid}', () => {
  it('returns a project, archived ones included, to members of its workspace', async () => {
    as(chen)
    expect(await json<Project>(await call('GET', `/projects/${website.id}`))).toEqual(website)
    expect(await json<Project>(await call('GET', `/projects/${legacy.id}`))).toEqual(legacy)
  })

  it('answers 404 for other workspaces and unknown ids, 422 for malformed ids', async () => {
    as(chen)
    await expectError(await call('GET', `/projects/${operations.id}`), 404, 'not_found')
    await expectError(await call('GET', `/projects/${MISSING_ID}`), 404, 'not_found')
    const malformed = await expectError(await call('GET', '/projects/not-a-uuid'), 422, 'validation_error')
    expect(malformed.details.errors).toEqual([{ field: 'pid', location: 'path', message: 'Input should be a valid UUID' }])
  })
})

describe('PATCH /projects/{pid}', () => {
  const patch = (body: unknown, pid: string = website.id) => call('PATCH', `/projects/${pid}`, body)

  it('changes the name and description; the key is ignored', async () => {
    as(dana)
    const response = await patch({ name: ' Website v2 ', description: null, key: 'NEW' })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ...website, name: 'Website v2', description: null })
    expect(await json<Project>(await patch({}))).toMatchObject({ name: 'Website v2', key: 'WEB' })
  })

  it('applies the 404, 403 and 422 rules', async () => {
    as(eve)
    await expectError(await patch({ name: 'X' }), 404, 'not_found')
    as(ben)
    await expectError(await patch({ name: 'X' }), 403, 'forbidden', 'insufficient_role')
    as(asha)
    await expectError(await patch({ name: 'X' }, operations.id), 403, 'forbidden', 'insufficient_role')
    await expectError(await patch({ name: null }), 422, 'validation_error')
    await expectError(await patch({ description: 'x'.repeat(2001) }), 422, 'validation_error')
    expect(findProject(website.id)?.name).toBe('Website')
  })
})

describe('POST /projects/{pid}/archive', () => {
  const archive = (pid: string = website.id) => call('POST', `/projects/${pid}/archive`)

  it('archives once, then answers 409 already_archived', async () => {
    as(asha)
    const response = await archive()

    expect(response.status).toBe(200)
    const archived = await json<Project>(response)
    expect(archived).toEqual({ ...website, archived_at: expect.stringMatching(/Z$/) })
    await expectError(await archive(), 409, 'conflict', 'already_archived')
    const active = await json<Project[]>(await call('GET', `/workspaces/${acme.id}/projects`))
    expect(names(active)).toEqual(['Mobile App'])
  })

  it('needs project.manage and membership', async () => {
    as(chen)
    await expectError(await archive(), 403, 'forbidden', 'insufficient_role')
    as(eve)
    await expectError(await archive(), 404, 'not_found')
  })

  it('requires the CSRF header', async () => {
    as(asha)
    const response = await fetch(new URL(`/api/projects/${website.id}/archive`, window.location.origin), {
      method: 'POST',
    })
    await expectError(response, 403, 'forbidden', 'csrf')
  })
})

describe('deleting a workspace', () => {
  it('deletes its projects', () => {
    deleteWorkspace(acme.id)
    expect(findProject(website.id)).toBeUndefined()
    expect(findProject(operations.id)).toBeDefined()
  })
})
