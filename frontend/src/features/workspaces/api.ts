// Raw calls for contract section 3.3 (Workspaces). Components use the hooks in hooks.ts instead.
import { api } from '../../api/client'
import type { UUID, Workspace, WorkspaceCreate, WorkspaceUpdate } from '../../api/types'

export const workspacesApi = {
  list: (signal?: AbortSignal) => api.get<Workspace[]>('/workspaces', { signal }),
  get: (id: UUID, signal?: AbortSignal) => api.get<Workspace>(`/workspaces/${id}`, { signal }),
  create: (body: WorkspaceCreate) => api.post<Workspace>('/workspaces', body),
  update: (id: UUID, body: WorkspaceUpdate) => api.patch<Workspace>(`/workspaces/${id}`, body),
  remove: (id: UUID) => api.delete(`/workspaces/${id}`),
}
