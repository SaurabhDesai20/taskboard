// TanStack Query hooks for workspace members (contract 3.4). Every mutation refetches the member
// list afterwards; on 403/404/409 the workspace list (my role) is refetched too, because those
// usually mean someone else changed the membership in the meantime.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Member, MemberCreate, Role, UUID, Workspace } from '../../api/types'
import { refreshAfterConflict, useLeaveWorkspacePage, workspaceKeys } from '../workspaces/hooks'
import { membersApi } from './api'

function refetchMembers(queryClient: QueryClient, workspaceId: UUID): Promise<void> {
  return queryClient.invalidateQueries({ queryKey: workspaceKeys.members(workspaceId) })
}

export function useMembers(workspaceId: UUID) {
  return useQuery({
    queryKey: workspaceKeys.members(workspaceId),
    queryFn: ({ signal }) => membersApi.list(workspaceId, signal),
  })
}

export function useAddMember(workspaceId: UUID) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: MemberCreate) => membersApi.add(workspaceId, body),
    onSuccess: () => refetchMembers(queryClient, workspaceId),
    onError: (error) => refreshAfterConflict(queryClient, workspaceId, error),
  })
}

export interface RoleChange {
  userId: UUID
  role: Role
}

export function useChangeMemberRole(workspaceId: UUID) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: ({ userId, role }: RoleChange) => membersApi.update(workspaceId, userId, { role }),
    onSuccess: (updated) => {
      // Show the new role at once; the refetch below confirms the order and the rest.
      queryClient.setQueryData<Member[]>(workspaceKeys.members(workspaceId), (members) =>
        members?.map((member) => (member.user_id === updated.user_id ? updated : member)),
      )
      return refetchMembers(queryClient, workspaceId)
    },
    onError: (error) => refreshAfterConflict(queryClient, workspaceId, error),
  })
}

export function useRemoveMember(workspaceId: UUID) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (userId: UUID) => membersApi.remove(workspaceId, userId),
    onSuccess: () => refetchMembers(queryClient, workspaceId),
    onError: (error) => refreshAfterConflict(queryClient, workspaceId, error),
  })
}

/** Removes the signed-in user from the workspace, then goes home. */
export function useLeaveWorkspace(workspace: Workspace) {
  const queryClient = useQueryClient()
  const leavePage = useLeaveWorkspacePage()
  return useMutation({
    mutationFn: (myUserId: UUID) => membersApi.remove(workspace.id, myUserId),
    onSuccess: () => leavePage(workspace, `You left ${workspace.name}.`),
    onError: (error) => refreshAfterConflict(queryClient, workspace.id, error),
  })
}
