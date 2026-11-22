// TanStack Query hooks for projects (contract 3.5). Project queries live under the workspace's
// key prefix, so refreshing or forgetting a workspace (refreshAfterConflict, forgetWorkspace)
// covers its projects too.
import { useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { useParams } from 'react-router'
import { ApiError } from '../../api/client'
import type { Project, ProjectCreate, ProjectUpdate, UUID } from '../../api/types'
import { refreshActivity, refreshAfterConflict, useCurrentWorkspace, workspaceKeys } from '../workspaces/hooks'
import { projectsApi } from './api'

export const projectKeys = {
  /** Everything project-related in one workspace. */
  all: (workspaceId: UUID) => [...workspaceKeys.detail(workspaceId), 'projects'] as const,
  /** Both lists (with and without archived projects). */
  lists: (workspaceId: UUID) => [...projectKeys.all(workspaceId), 'list'] as const,
  list: (workspaceId: UUID, includeArchived: boolean) =>
    [...projectKeys.lists(workspaceId), { includeArchived }] as const,
  detail: (workspaceId: UUID, projectId: UUID) => [...projectKeys.all(workspaceId), 'detail', projectId] as const,
}

/** Same order as the server: by name. */
function sortByName(projects: Project[]): Project[] {
  return [...projects].sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Puts a created or changed project into the cached detail and lists (dropping it from the
 * active-only list once archived), then refetches the lists to be sure, and the activity feed.
 */
function storeProject(queryClient: QueryClient, project: Project): void {
  const workspaceId = project.workspace_id
  queryClient.setQueryData<Project>(projectKeys.detail(workspaceId, project.id), project)
  for (const includeArchived of [false, true]) {
    queryClient.setQueryData<Project[]>(projectKeys.list(workspaceId, includeArchived), (list) => {
      if (!list) return list
      const others = list.filter((item) => item.id !== project.id)
      const listed = includeArchived || project.archived_at === null
      return sortByName(listed ? [...others, project] : others)
    })
  }
  void queryClient.invalidateQueries({ queryKey: projectKeys.lists(workspaceId) })
  refreshActivity(queryClient, workspaceId)
}

/** A project of this workspace from a cached list, with when that list was fetched. */
function findCachedProject(queryClient: QueryClient, workspaceId: UUID, projectId: UUID) {
  for (const [queryKey, list] of queryClient.getQueriesData<Project[]>({
    queryKey: projectKeys.lists(workspaceId),
  })) {
    const project = list?.find((item) => item.id === projectId)
    if (project) return { project, updatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt }
  }
  return undefined
}

/**
 * "This project does not exist here": a 404, a malformed id (422 on the path), or a project of
 * another workspace (see useProject). The UI shows one not-found state for all of them.
 */
export function isProjectNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 422)
}

export function useProjects(workspaceId: UUID, { includeArchived = false } = {}) {
  return useQuery({
    queryKey: projectKeys.list(workspaceId, includeArchived),
    queryFn: ({ signal }) => projectsApi.list(workspaceId, includeArchived, signal),
  })
}

/**
 * One project of workspace `workspaceId`, starting from a cached list entry when there is one.
 * A project that belongs to another workspace fails like a 404, so `/w/:slug/projects/:id`
 * never shows a project under the wrong workspace.
 */
export function useProject(workspaceId: UUID | undefined, projectId: UUID | undefined) {
  const queryClient = useQueryClient()
  const wid = workspaceId ?? ''
  const pid = projectId ?? ''
  return useQuery({
    queryKey: projectKeys.detail(wid, pid),
    queryFn: async ({ signal }) => {
      const project = await projectsApi.get(pid, signal)
      if (project.workspace_id !== wid) throw new ApiError(404, 'not_found', 'Project not found')
      return project
    },
    enabled: Boolean(workspaceId && projectId),
    initialData: () => findCachedProject(queryClient, wid, pid)?.project,
    initialDataUpdatedAt: () => findCachedProject(queryClient, wid, pid)?.updatedAt,
  })
}

/** The project named by the current `/w/:slug/projects/:projectId` URL. */
export function useCurrentProject() {
  const { workspace } = useCurrentWorkspace()
  const { projectId } = useParams()
  const query = useProject(workspace?.id, projectId)
  return { workspace, projectId, project: query.data, query }
}

export function useCreateProject(workspaceId: UUID) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ProjectCreate) => projectsApi.create(workspaceId, body),
    onSuccess: (project) => storeProject(queryClient, project),
    onError: (error) => refreshAfterConflict(queryClient, workspaceId, error),
  })
}

export function useUpdateProject(project: Project) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: (body: ProjectUpdate) => projectsApi.update(project.id, body),
    onSuccess: (updated) => storeProject(queryClient, updated),
    onError: (error) => refreshAfterConflict(queryClient, project.workspace_id, error),
  })
}

/**
 * `onArchived` runs with the hook's own success handler rather than as a `mutate()` callback:
 * archiving removes the project from the active list, which may unmount the dialog that started
 * it, and `mutate()` callbacks do not fire after an unmount.
 */
export function useArchiveProject(project: Project, { onArchived }: { onArchived?: (project: Project) => void } = {}) {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: () => projectsApi.archive(project.id),
    onSuccess: (archived) => {
      storeProject(queryClient, archived)
      onArchived?.(archived)
    },
    // 409 already_archived (archived elsewhere) also refreshes, so the UI catches up.
    onError: (error) => refreshAfterConflict(queryClient, project.workspace_id, error),
  })
}
