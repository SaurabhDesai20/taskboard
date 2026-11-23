// Raw calls for contract section 3.4 (Members). Components use the hooks in hooks.ts instead.
import { api } from '../../api/client'
import type { Member, MemberCreate, MemberUpdate, UUID } from '../../api/types'

const membersPath = (workspaceId: UUID) => `/workspaces/${workspaceId}/members`

export const membersApi = {
  list: (workspaceId: UUID, signal?: AbortSignal) => api.get<Member[]>(membersPath(workspaceId), { signal }),
  add: (workspaceId: UUID, body: MemberCreate) => api.post<Member>(membersPath(workspaceId), body),
  update: (workspaceId: UUID, userId: UUID, body: MemberUpdate) =>
    api.patch<Member>(`${membersPath(workspaceId)}/${userId}`, body),
  /** Removing yourself is leaving the workspace. */
  remove: (workspaceId: UUID, userId: UUID) => api.delete(`${membersPath(workspaceId)}/${userId}`),
}
