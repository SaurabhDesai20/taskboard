// Raw calls for contract section 3.6 (Tasks). Components use the hooks in hooks.ts instead.
import { api } from '../../api/client'
import type { MyTask, Task, TaskCreate, TaskMoveRequest, TaskStatus, TaskUpdate, UUID } from '../../api/types'
import { filtersToQuery, type TaskFilters } from './filters'

export interface MyTasksQuery {
  status?: TaskStatus[]
}

export const tasksApi = {
  /** Every matching task (not paginated), ordered by status then position. */
  list: (projectId: UUID, filters: TaskFilters, signal?: AbortSignal) =>
    api.get<Task[]>(`/projects/${projectId}/tasks`, { query: filtersToQuery(filters), signal }),
  get: (taskId: UUID, signal?: AbortSignal) => api.get<Task>(`/tasks/${taskId}`, { signal }),
  create: (projectId: UUID, body: TaskCreate) => api.post<Task>(`/projects/${projectId}/tasks`, body),
  update: (taskId: UUID, body: TaskUpdate) => api.patch<Task>(`/tasks/${taskId}`, body),
  remove: (taskId: UUID) => api.delete(`/tasks/${taskId}`),
  /** Answers with the moved task; other tasks of the column may have been rebalanced. */
  move: (taskId: UUID, body: TaskMoveRequest) => api.post<Task>(`/tasks/${taskId}/move`, body),
  /** Tasks assigned to me in all my workspaces (archived projects excluded), by due date. */
  mine: (query: MyTasksQuery = {}, signal?: AbortSignal) =>
    api.get<MyTask[]>('/me/tasks', { query: { status: query.status }, signal }),
}
