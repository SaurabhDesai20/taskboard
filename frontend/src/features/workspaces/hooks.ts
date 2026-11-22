// TanStack Query hooks for workspaces (contract 3.3). The list (`GET /workspaces`) is the source
// of truth for "which workspaces am I in, and with which role"; `/w/:slug` routes resolve their
// workspace from it.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useMatch, useNavigate } from 'react-router'
import { ApiError } from '../../api/client'
import type { UUID, Workspace } from '../../api/types'
import { can, type Action } from '../../lib/permissions'
import { workspacesApi } from './api'
import { noticeState } from './notice'

export const workspaceKeys = {
  all: ['workspaces'] as const,
  list: () => ['workspaces', 'list'] as const,
  /** Prefix of everything that belongs to one workspace (members now, projects later). */
  detail: (id: UUID) => ['workspaces', 'detail', id] as const,
  members: (id: UUID) => ['workspaces', 'detail', id, 'members'] as const,
  /** Every activity feed of one workspace (the whole feed, filtered feeds, per-task tabs). */
  activity: (id: UUID) => ['workspaces', 'detail', id, 'activity'] as const,
}

/**
 * Every successful change writes activity entries (contract 3.8), so each mutation calls this to
 * refetch the workspace's open feeds (closed ones are only marked stale).
 */
export function refreshActivity(queryClient: QueryClient, workspaceId: UUID): void {
  void queryClient.invalidateQueries({ queryKey: workspaceKeys.activity(workspaceId) })
}

/** Same order as the server: by name. */
function sortByName(workspaces: Workspace[]): Workspace[] {
  return [...workspaces].sort((a, b) => a.name.localeCompare(b.name))
}

/** Puts a created or renamed workspace into the cached list, then refetches it (and its activity). */
function storeWorkspace(queryClient: QueryClient, workspace: Workspace): void {
  queryClient.setQueryData<Workspace[]>(workspaceKeys.list(), (list) =>
    list ? sortByName([...list.filter((item) => item.id !== workspace.id), workspace]) : list,
  )
  queryClient.setQueryData<Workspace>(workspaceKeys.detail(workspace.id), workspace)
  void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() })
  refreshActivity(queryClient, workspace.id)
}

/** Drops a workspace the user deleted or left, with everything cached under it. */
export function forgetWorkspace(queryClient: QueryClient, id: UUID): void {
  queryClient.setQueryData<Workspace[]>(workspaceKeys.list(), (list) => list?.filter((item) => item.id !== id))
  queryClient.removeQueries({ queryKey: workspaceKeys.detail(id) })
  void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() })
}

/**
 * After a 403, 404 or 409 the cached view is probably stale (someone changed roles or members in
 * the meantime): refetch the workspace list (my role) and everything under this workspace.
 */
export function refreshAfterConflict(queryClient: QueryClient, id: UUID, error: unknown): void {
  if (error instanceof ApiError && [403, 404, 409].includes(error.status)) {
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.list() })
    void queryClient.invalidateQueries({ queryKey: workspaceKeys.detail(id) })
  }
}

export function useWorkspaces() {
  return useQuery({
    queryKey: workspaceKeys.list(),
    queryFn: ({ signal }) => workspacesApi.list(signal),
  })
}

/** One workspace by id, starting from the cached list entry when there is one. */
export function useWorkspace(id: UUID) {
  const queryClient = useQueryClient()
  return useQuery({
    queryKey: workspaceKeys.detail(id),
    queryFn: ({ signal }) => workspacesApi.get(id, signal),
    initialData: () => queryClient.getQueryData<Workspace[]>(workspaceKeys.list())?.find((item) => item.id === id),
    initialDataUpdatedAt: () => queryClient.getQueryState(workspaceKeys.list())?.dataUpdatedAt,
  })
}

/**
 * The workspace named by the current `/w/:slug/...` URL, looked up in the workspace list. Works
 * anywhere in the tree (the header too). `workspace` is undefined while loading, outside a
 * workspace route, or when the slug is not one of the user's workspaces.
 */
export function useCurrentWorkspace() {
  const match = useMatch('/w/:slug/*')
  const slug = match?.params.slug
  const query = useWorkspaces()
  const workspace = slug ? query.data?.find((item) => item.slug === slug) : undefined
  return { slug, workspace, query }
}

/** Whether the user's role in the current workspace allows `action` (false while loading). */
export function useCan(action: Action): boolean {
  const { workspace } = useCurrentWorkspace()
  return can(workspace?.my_role, action)
}

export function useCreateWorkspace() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: workspacesApi.create,
    onSuccess: (workspace) => storeWorkspace(queryClient, workspace),
  })
}

export function useRenameWorkspace(id: UUID) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (name: string) => workspacesApi.update(id, { name }),
    onSuccess: (workspace) => storeWorkspace(queryClient, workspace),
    onError: (error) => refreshAfterConflict(queryClient, id, error),
  })
}

/** Navigates home first (so the workspace pages unmount), then drops the cached workspace. */
export function useLeaveWorkspacePage() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return (workspace: Workspace, notice: string) => {
    void navigate('/', { replace: true, flushSync: true, state: noticeState(notice) })
    forgetWorkspace(queryClient, workspace.id)
  }
}

export function useDeleteWorkspace(workspace: Workspace) {
  const queryClient = useQueryClient()
  const leavePage = useLeaveWorkspacePage()
  return useMutation({
    mutationFn: () => workspacesApi.remove(workspace.id),
    onSuccess: () => leavePage(workspace, `Deleted the workspace ${workspace.name}.`),
    onError: (error) => refreshAfterConflict(queryClient, workspace.id, error),
  })
}
