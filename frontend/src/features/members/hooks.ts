// TanStack Query hooks for workspace members (contract 3.4). Every mutation refetches the member
// list (and the activity feed) afterwards; on 403/404/409 the workspace list (my role) is
// refetched too, because those usually mean someone else changed the membership in the meantime.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import type { Member, MemberCreate, Role, UUID, Workspace } from '../../api/types'
import { useErrorToastWhenUnmounted, useToast } from '../../components/toastContext'
import { ROLE_LABELS } from '../../lib/permissions'
import { refreshActivity, refreshAfterConflict, useLeaveWorkspacePage, workspaceKeys } from '../workspaces/hooks'
import { membersApi } from './api'

/** After a membership change: the member list, and the feed that now records the change. */
function refetchMembers(queryClient: QueryClient, workspaceId: UUID): Promise<void> {
  refreshActivity(queryClient, workspaceId)
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
  const toast = useToast()
  const reportIfGone = useErrorToastWhenUnmounted()
  return useMutation({
    mutationFn: ({ userId, role }: RoleChange) => membersApi.update(workspaceId, userId, { role }),
    onSuccess: (updated) => {
      // Show the new role at once; the refetch below confirms the order and the rest.
      queryClient.setQueryData<Member[]>(workspaceKeys.members(workspaceId), (members) =>
        members?.map((member) => (member.user_id === updated.user_id ? updated : member)),
      )
      toast.success(`Changed ${updated.name}'s role to ${ROLE_LABELS[updated.role]}.`)
      return refetchMembers(queryClient, workspaceId)
    },
    onError: (error) => {
      refreshAfterConflict(queryClient, workspaceId, error)
      // The row shows the error; if the row is gone (the member left meanwhile), a toast does.
      reportIfGone('Could not change the role.', error)
    },
  })
}

export function useRemoveMember(workspaceId: UUID) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (member: Member) => membersApi.remove(workspaceId, member.user_id),
    onSuccess: (_result, member) => {
      toast.success(`Removed ${member.name} from the workspace.`)
      return refetchMembers(queryClient, workspaceId)
    },
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
