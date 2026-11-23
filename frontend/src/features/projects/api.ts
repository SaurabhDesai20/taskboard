// Raw calls for contract section 3.5 (Projects). Components use the hooks in hooks.ts instead.
import { api } from '../../api/client'
import type { Project, ProjectCreate, ProjectUpdate, UUID } from '../../api/types'

const workspaceProjectsPath = (workspaceId: UUID) => `/workspaces/${workspaceId}/projects`

export const projectsApi = {
  /** Ordered by name; archived projects only with `includeArchived`. */
  list: (workspaceId: UUID, includeArchived: boolean, signal?: AbortSignal) =>
    api.get<Project[]>(workspaceProjectsPath(workspaceId), {
      query: { include_archived: includeArchived },
      signal,
    }),
  get: (projectId: UUID, signal?: AbortSignal) => api.get<Project>(`/projects/${projectId}`, { signal }),
  create: (workspaceId: UUID, body: ProjectCreate) => api.post<Project>(workspaceProjectsPath(workspaceId), body),
  update: (projectId: UUID, body: ProjectUpdate) => api.patch<Project>(`/projects/${projectId}`, body),
  /** No body; answers with the project, `archived_at` set. */
  archive: (projectId: UUID) => api.post<Project>(`/projects/${projectId}/archive`),
}
