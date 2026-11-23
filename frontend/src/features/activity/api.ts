// Raw calls for contract section 3.8 (Activity). Components use the hooks in hooks.ts instead.
import { api } from '../../api/client'
import type { ActivityPage, UUID } from '../../api/types'

/** The feed's filters; null (or left out) means "any". They only narrow, never cause a 404. */
export interface ActivityFilters {
  projectId: UUID | null
  taskId: UUID | null
  actorId: UUID | null
}

export interface ActivityPageQuery {
  /** `next_cursor` of the previous page, passed back unchanged; null for the first page. */
  cursor?: string | null
  /** 1 to 100; the server's default is 20. */
  limit?: number
}

export const activityApi = {
  /** One page of a workspace's activity, newest first. The next page holds older entries. */
  list: (
    workspaceId: UUID,
    filters: ActivityFilters,
    { cursor, limit }: ActivityPageQuery = {},
    signal?: AbortSignal,
  ) =>
    api.get<ActivityPage>(`/workspaces/${workspaceId}/activity`, {
      query: {
        project_id: filters.projectId,
        task_id: filters.taskId,
        actor_id: filters.actorId,
        limit,
        cursor,
      },
      signal,
    }),
}
