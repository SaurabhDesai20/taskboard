// TanStack Query hooks for tasks (contract 3.6). Task queries live under the workspace's key
// prefix, so refreshing or forgetting a workspace (refreshAfterConflict, forgetWorkspace) covers
// its tasks too. "My tasks" spans workspaces and has its own key.
import { keepPreviousData, useMutation, useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { ApiError } from '../../api/client'
import type { Project, Task, TaskCreate, TaskMoveRequest, TaskStatus, TaskUpdate, UUID } from '../../api/types'
import { useErrorToastWhenUnmounted, useToast } from '../../components/toastContext'
import { refreshActivity, refreshAfterConflict, workspaceKeys } from '../workspaces/hooks'
import { tasksApi } from './api'
import { hasActiveFilters, type TaskFilters } from './filters'
import { STATUS_LABELS } from './labels'
import { applyMove, sortTasks } from './ordering'

export const taskKeys = {
  /** Everything task-related in one workspace. */
  all: (workspaceId: UUID) => [...workspaceKeys.detail(workspaceId), 'tasks'] as const,
  /** Every (filtered) task list of one project. */
  lists: (workspaceId: UUID, projectId: UUID) => [...taskKeys.all(workspaceId), 'list', projectId] as const,
  list: (workspaceId: UUID, projectId: UUID, filters: TaskFilters) =>
    [...taskKeys.lists(workspaceId, projectId), filters] as const,
  detail: (workspaceId: UUID, taskId: UUID) => [...taskKeys.all(workspaceId), 'detail', taskId] as const,
  /** `GET /me/tasks`, across workspaces. */
  mine: ['me', 'tasks'] as const,
}

/** My Tasks lists open work only: done tasks are not "to do". */
export const OPEN_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'in_review']

/**
 * Refetch what a successful task change can affect: the project's lists (other positions), My
 * Tasks, and the activity feed that now records it.
 */
function refreshTaskLists(queryClient: QueryClient, task: Pick<Task, 'workspace_id' | 'project_id'>): void {
  void queryClient.invalidateQueries({ queryKey: taskKeys.lists(task.workspace_id, task.project_id) })
  void queryClient.invalidateQueries({ queryKey: taskKeys.mine })
  refreshActivity(queryClient, task.workspace_id)
}

/** Puts a changed task into the cached detail and into the project's lists that show it. */
function storeTask(queryClient: QueryClient, task: Task): void {
  queryClient.setQueryData<Task>(taskKeys.detail(task.workspace_id, task.id), task)
  queryClient.setQueriesData<Task[]>({ queryKey: taskKeys.lists(task.workspace_id, task.project_id) }, (list) =>
    list ? sortTasks(list.map((item) => (item.id === task.id ? task : item))) : list,
  )
}

/**
 * Adds a new task to the project's unfiltered lists at once; filtered lists wait for the
 * refetch, since the new task may not match their filters.
 */
function storeNewTask(queryClient: QueryClient, task: Task): void {
  queryClient.setQueryData<Task>(taskKeys.detail(task.workspace_id, task.id), task)
  queryClient.setQueriesData<Task[]>(
    {
      queryKey: taskKeys.lists(task.workspace_id, task.project_id),
      predicate: (query) => !hasActiveFilters(query.queryKey[query.queryKey.length - 1] as TaskFilters),
    },
    (list) => (list ? sortTasks([...list.filter((item) => item.id !== task.id), task]) : list),
  )
}

/** A task of this project from a cached list, with when that list was fetched. */
function findCachedTask(queryClient: QueryClient, workspaceId: UUID, projectId: UUID, taskId: UUID) {
  for (const [queryKey, list] of queryClient.getQueriesData<Task[]>({
    queryKey: taskKeys.lists(workspaceId, projectId),
  })) {
    const task = list?.find((item) => item.id === taskId)
    if (task) return { task, updatedAt: queryClient.getQueryState(queryKey)?.dataUpdatedAt }
  }
  return undefined
}

/** "This task does not exist here": a 404, a malformed id (422), or a task of another project. */
export function isTaskNotFound(error: unknown): boolean {
  return error instanceof ApiError && (error.status === 404 || error.status === 422)
}

/** The project's tasks matching `filters`. While other filters load, the previous list stays. */
export function useProjectTasks(project: Project, filters: TaskFilters) {
  return useQuery({
    queryKey: taskKeys.list(project.workspace_id, project.id, filters),
    queryFn: ({ signal }) => tasksApi.list(project.id, filters, signal),
    placeholderData: keepPreviousData,
  })
}

/**
 * One task of `project`, starting from a cached list entry when there is one. A task of another
 * project (or workspace) fails like a 404, so `?task=` never opens it on the wrong board.
 */
export function useTask(project: Project, taskId: UUID | null) {
  const queryClient = useQueryClient()
  const workspaceId = project.workspace_id
  const id = taskId ?? ''
  return useQuery({
    queryKey: taskKeys.detail(workspaceId, id),
    queryFn: async ({ signal }) => {
      const task = await tasksApi.get(id, signal)
      if (task.project_id !== project.id) throw new ApiError(404, 'not_found', 'Task not found')
      return task
    },
    enabled: Boolean(taskId),
    initialData: () => findCachedTask(queryClient, workspaceId, project.id, id)?.task,
    initialDataUpdatedAt: () => findCachedTask(queryClient, workspaceId, project.id, id)?.updatedAt,
  })
}

export function useCreateTask(project: Project) {
  const queryClient = useQueryClient()
  const toast = useToast()
  return useMutation({
    mutationFn: (body: TaskCreate) => tasksApi.create(project.id, body),
    onSuccess: (task) => {
      storeNewTask(queryClient, task)
      refreshTaskLists(queryClient, task)
      // Focus stays in the title box for the next task, so this is the only word that it worked.
      toast.success(`Added ${task.key} to ${STATUS_LABELS[task.status]}.`)
    },
    // 409 project_archived refetches the project too, so the board turns read-only.
    onError: (error) => refreshAfterConflict(queryClient, project.workspace_id, error),
  })
}

export function useUpdateTask(task: Task) {
  const queryClient = useQueryClient()
  const reportIfClosed = useErrorToastWhenUnmounted()
  return useMutation({
    mutationFn: (body: TaskUpdate) => tasksApi.update(task.id, body),
    onSuccess: (updated) => {
      storeTask(queryClient, updated)
      refreshTaskLists(queryClient, updated)
    },
    onError: (error) => {
      refreshAfterConflict(queryClient, task.workspace_id, error)
      // The form shows the error; if the drawer was closed meanwhile, a toast does.
      reportIfClosed(`Could not save ${task.key}.`, error)
    },
  })
}

/**
 * `onDeleted` runs with the hook's own success handler rather than as a `mutate()` callback, so
 * it still fires if the component that started the delete unmounts in the meantime.
 */
export function useDeleteTask(task: Task, { onDeleted }: { onDeleted?: () => void } = {}) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const reportIfClosed = useErrorToastWhenUnmounted()
  return useMutation({
    mutationFn: () => tasksApi.remove(task.id),
    onSuccess: () => {
      queryClient.setQueriesData<Task[]>({ queryKey: taskKeys.lists(task.workspace_id, task.project_id) }, (list) =>
        list?.filter((item) => item.id !== task.id),
      )
      refreshTaskLists(queryClient, task)
      // Stale, not removed: the closing drawer may still observe it. Reopening refetches (404).
      void queryClient.invalidateQueries({
        queryKey: taskKeys.detail(task.workspace_id, task.id),
        exact: true,
        refetchType: 'none',
      })
      toast.success(`Deleted ${task.key}.`)
      onDeleted?.()
    },
    onError: (error) => {
      refreshAfterConflict(queryClient, task.workspace_id, error)
      reportIfClosed(`Could not delete ${task.key}.`, error)
    },
  })
}

export interface MoveTaskVariables {
  task: Task
  request: TaskMoveRequest
}

interface MoveContext {
  /** Every cached list of the project as it was before the move. */
  snapshot: [readonly unknown[], Task[] | undefined][]
}

/**
 * Moves a task (drag and drop or the move menu) with an optimistic update: the new order is
 * written to every cached list of the project at once, restored if the server says no (with an
 * error toast saying why), and the lists are refetched afterwards either way (the server may have
 * rebalanced the column).
 */
export function useMoveTask(project: Project) {
  const queryClient = useQueryClient()
  const toast = useToast()
  const listsKey = taskKeys.lists(project.workspace_id, project.id)
  return useMutation<Task, Error, MoveTaskVariables, MoveContext>({
    mutationFn: ({ task, request }) => tasksApi.move(task.id, request),
    onMutate: async ({ task, request }) => {
      // A list fetch that lands after the optimistic write would undo it.
      await queryClient.cancelQueries({ queryKey: listsKey })
      const snapshot = queryClient.getQueriesData<Task[]>({ queryKey: listsKey })
      queryClient.setQueriesData<Task[]>({ queryKey: listsKey }, (list) =>
        list ? applyMove(list, task.id, request) : list,
      )
      return { snapshot }
    },
    onError: (error, { task }, context) => {
      for (const [queryKey, list] of context?.snapshot ?? []) queryClient.setQueryData(queryKey, list)
      refreshAfterConflict(queryClient, project.workspace_id, error)
      toast.error(`Could not move ${task.key}. ${error.message}`)
    },
    onSuccess: (moved) => {
      queryClient.setQueryData<Task>(taskKeys.detail(moved.workspace_id, moved.id), moved)
      refreshActivity(queryClient, moved.workspace_id)
    },
    onSettled: () => {
      void queryClient.invalidateQueries({ queryKey: listsKey })
      void queryClient.invalidateQueries({ queryKey: taskKeys.mine })
    },
  })
}

/** My open tasks across workspaces (archived projects excluded by the server). */
export function useMyTasks() {
  return useQuery({
    queryKey: [...taskKeys.mine, { status: OPEN_STATUSES }],
    queryFn: ({ signal }) => tasksApi.mine({ status: [...OPEN_STATUSES] }, signal),
  })
}
