import { screen } from '@testing-library/react'
import { http, HttpResponse } from 'msw'
import type { RouteObject } from 'react-router'
import { describe, expect, it } from 'vitest'
import type { Action } from '../../lib/permissions'
import { MOCK_USERS, startMockSession } from '../../mocks/db'
import { server } from '../../mocks/server'
import { renderRoute } from '../../test/render'
import { Can } from './Can'

function Probe({ action }: { action: Action }) {
  return (
    <Can action={action} fallback={<p>fallback for {action}</p>}>
      <p>allowed: {action}</p>
    </Can>
  )
}

const probeElement = (
  <>
    <Probe action="workspace.view" />
    <Probe action="task.write" />
    <Probe action="member.manage" />
    <Probe action="workspace.manage" />
  </>
)

const routes: RouteObject[] = [
  { path: '/w/:slug/*', element: probeElement },
  { path: '*', element: probeElement },
]

describe('<Can>', () => {
  it.each([
    ['asha', ['workspace.view', 'task.write', 'member.manage', 'workspace.manage'], []],
    ['dana', ['workspace.view', 'task.write', 'member.manage'], ['workspace.manage']],
    ['ben', ['workspace.view', 'task.write'], ['member.manage', 'workspace.manage']],
    ['chen', ['workspace.view'], ['task.write', 'member.manage', 'workspace.manage']],
  ] as const)('follows the role of %s in the current workspace', async (who, allowed, denied) => {
    startMockSession(MOCK_USERS[who].id)
    renderRoute({ route: '/w/acme/settings', routes })

    expect(await screen.findByText('allowed: workspace.view')).toBeInTheDocument()
    for (const action of allowed) expect(screen.getByText(`allowed: ${action}`)).toBeInTheDocument()
    for (const action of denied) {
      expect(screen.getByText(`fallback for ${action}`)).toBeInTheDocument()
      expect(screen.queryByText(`allowed: ${action}`)).not.toBeInTheDocument()
    }
  })

  it('uses the role of the workspace in the URL (Asha is a member of Globex)', async () => {
    startMockSession(MOCK_USERS.asha.id)
    renderRoute({ route: '/w/globex', routes })

    expect(await screen.findByText('allowed: task.write')).toBeInTheDocument()
    expect(screen.getByText('fallback for member.manage')).toBeInTheDocument()
  })

  it('allows nothing while the role is loading', async () => {
    let release: () => void = () => {}
    const gate = new Promise<void>((resolve) => {
      release = resolve
    })
    let requests = 0
    server.use(
      http.get('/api/workspaces', async () => {
        requests += 1
        await gate
        return HttpResponse.json([])
      }),
    )
    startMockSession(MOCK_USERS.asha.id)
    renderRoute({ route: '/w/acme', routes })

    await screen.findByText('fallback for workspace.view')
    expect(requests).toBe(1)
    release()
  })

  it('allows nothing for a workspace the user is not in (Chen and Globex)', async () => {
    startMockSession(MOCK_USERS.chen.id)
    const { queryClient } = renderRoute({ route: '/w/globex', routes })

    await screen.findByText('fallback for workspace.view')
    await expect.poll(() => queryClient.isFetching()).toBe(0)
    expect(screen.queryByText(/^allowed/)).not.toBeInTheDocument()
  })

  it('allows nothing outside a workspace route', async () => {
    startMockSession(MOCK_USERS.asha.id)
    const { queryClient } = renderRoute({ route: '/elsewhere', routes })

    await expect.poll(() => queryClient.isFetching()).toBe(0)
    expect(screen.getByText('fallback for workspace.view')).toBeInTheDocument()
    expect(screen.queryByText(/^allowed/)).not.toBeInTheDocument()
  })
})
