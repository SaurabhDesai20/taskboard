import type { QueryClient } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import { ApiError } from '../../api/client'
import type { Workspace } from '../../api/types'
import { AppProviders } from '../../app/providers'
import { MOCK_USERS, MOCK_WORKSPACES, startMockSession } from '../../mocks/db'
import { createTestQueryClient } from '../../test/render'
import { useWorkspace, workspaceKeys } from './hooks'

const { acme, globex } = MOCK_WORKSPACES

function renderUseWorkspace(id: string, queryClient: QueryClient = createTestQueryClient()) {
  const wrapper = ({ children }: { children: ReactNode }) => (
    <AppProviders queryClient={queryClient}>{children}</AppProviders>
  )
  return renderHook(() => useWorkspace(id), { wrapper })
}

describe('useWorkspace', () => {
  it('fetches one workspace with my role', async () => {
    startMockSession(MOCK_USERS.chen.id)
    const { result } = renderUseWorkspace(acme.id)

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual({ ...acme, my_role: 'viewer' })
  })

  it('fails with 404 for a workspace I am not in', async () => {
    startMockSession(MOCK_USERS.chen.id)
    const { result } = renderUseWorkspace(globex.id)

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(result.current.error).toBeInstanceOf(ApiError)
    expect((result.current.error as ApiError).status).toBe(404)
  })

  it('starts from the cached workspace list, then refreshes it', async () => {
    startMockSession(MOCK_USERS.asha.id)
    const queryClient = createTestQueryClient()
    const cached: Workspace = { ...acme, name: 'Acme (cached)', my_role: 'owner' }
    queryClient.setQueryData<Workspace[]>(workspaceKeys.list(), [cached])

    const { result } = renderUseWorkspace(acme.id, queryClient)

    expect(result.current.data).toEqual(cached)
    await waitFor(() => expect(result.current.data?.name).toBe('Acme'))
  })
})
