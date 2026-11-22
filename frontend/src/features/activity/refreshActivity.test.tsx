// Every mutation hook refetches the activity feeds of its own workspace (contract 3.8: every
// successful change writes entries), and leaves other workspaces' feeds alone.
import type { QueryKey } from '@tanstack/react-query'
import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { describe, expect, it } from 'vitest'
import type { Task } from '../../api/types'
import { AppProviders } from '../../app/providers'
import {
  findTask,
  MOCK_COMMENT_IDS,
  MOCK_PROJECTS,
  MOCK_TASK_IDS,
  MOCK_USERS,
  MOCK_WORKSPACES,
  startMockSession,
  toTask,
  type MockTaskRecord,
} from '../../mocks/db'
import { createTestQueryClient } from '../../test/render'
import { useCreateComment, useDeleteComment, useUpdateComment } from '../comments/hooks'
import { useAddMember, useChangeMemberRole, useRemoveMember } from '../members/hooks'
import { useArchiveProject, useCreateProject, useUpdateProject } from '../projects/hooks'
import { useCreateTask, useDeleteTask, useMoveTask, useUpdateTask } from '../tasks/hooks'
import { useRenameWorkspace } from '../workspaces/hooks'
import { activityKeys, NO_ACTIVITY_FILTERS } from './hooks'

const { acme, globex } = MOCK_WORKSPACES
const { website } = MOCK_PROJECTS
const { asha, ben } = MOCK_USERS
const ids = MOCK_TASK_IDS

/** WEB-1 as the API returns it (Ben's comment on it: MOCK_COMMENT_IDS.web1Ben). */
const web1 = (): Task => toTask(findTask(ids.web1) as MockTaskRecord)

interface Mutation<V> {
  mutateAsync: (variables: V) => Promise<unknown>
}

interface Case {
  name: string
  run: () => Promise<(key: QueryKey) => boolean | undefined>
}

/**
 * Runs one mutation through its hook, with three feeds cached, and returns "was this key
 * invalidated". The hook and the variables get WEB-1 as it was before the mutation.
 */
function mutationCase<V>(
  name: string,
  useMutationUnderTest: (task: Task) => Mutation<V>,
  variables: (task: Task) => V,
): Case {
  return {
    name,
    run: async () => {
      const task = web1()
      const queryClient = createTestQueryClient()
      for (const key of FEEDS) queryClient.setQueryData(key, { pages: [], pageParams: [] })
      const wrapper = ({ children }: { children: ReactNode }) => (
        <AppProviders queryClient={queryClient}>{children}</AppProviders>
      )
      const { result } = renderHook(() => useMutationUnderTest(task), { wrapper })
      await act(async () => {
        await result.current.mutateAsync(variables(task))
      })
      return (key) => queryClient.getQueryState(key)?.isInvalidated
    },
  }
}

const ACME_FEED = activityKeys.feed(acme.id, NO_ACTIVITY_FILTERS)
const ACME_TASK_FEED = activityKeys.feed(acme.id, { ...NO_ACTIVITY_FILTERS, taskId: ids.web1 })
const GLOBEX_FEED = activityKeys.feed(globex.id, NO_ACTIVITY_FILTERS)
const FEEDS = [ACME_FEED, ACME_TASK_FEED, GLOBEX_FEED]

const CASES: Case[] = [
  mutationCase('create task', () => useCreateTask(website), () => ({ title: 'New task' })),
  mutationCase('update task', (task) => useUpdateTask(task), () => ({ priority: 'urgent' as const })),
  mutationCase('move task', () => useMoveTask(website), (task) => ({ task, request: { status: 'done' as const } })),
  mutationCase('delete task', (task) => useDeleteTask(task), () => undefined),
  mutationCase('post comment', (task) => useCreateComment(task, { id: asha.id, name: asha.name }), () => ({ body: 'Hi' })),
  mutationCase('edit comment', (task) => useUpdateComment(task), () => ({ commentId: MOCK_COMMENT_IDS.web1Asha, body: 'Edited' })),
  mutationCase('delete comment', (task) => useDeleteComment(task), () => MOCK_COMMENT_IDS.web1Ben),
  mutationCase('create project', () => useCreateProject(acme.id), () => ({ name: 'Billing', key: 'BIL' })),
  mutationCase('update project', () => useUpdateProject(website), () => ({ name: 'Web' })),
  mutationCase('archive project', () => useArchiveProject(website), () => undefined),
  mutationCase('add member', () => useAddMember(acme.id), () => ({ email: 'eve@example.com', role: 'viewer' as const })),
  mutationCase('change role', () => useChangeMemberRole(acme.id), () => ({ userId: ben.id, role: 'viewer' as const })),
  mutationCase(
    'remove member',
    () => useRemoveMember(acme.id),
    () => ({ user_id: ben.id, email: ben.email, name: ben.name, role: 'member' as const, joined_at: ben.created_at }),
  ),
  mutationCase('rename workspace', () => useRenameWorkspace(acme.id), () => 'Acme Inc'),
]

describe('mutations refresh the activity feed', () => {
  it.each(CASES)('$name', async ({ run }) => {
    startMockSession(asha.id)
    const invalidated = await run()

    expect(invalidated(ACME_FEED)).toBe(true)
    expect(invalidated(ACME_TASK_FEED)).toBe(true)
    expect(invalidated(GLOBEX_FEED)).toBe(false)
  })
})
