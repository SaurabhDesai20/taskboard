// Contract section 3.8 (Activity): the feed, newest first with the cursor pagination of 1.6, and
// the helpers the other handlers use to record what they changed (metadata shapes from the
// contract's table). An entry is only recorded once the change has been made, like the backend
// writing it in the same transaction: a rejected request records nothing.
import { http, HttpResponse } from 'msw'
import type { ActivityAction, ActivityPage, FieldError, UUID } from '../../api/types'
import {
  activityOf,
  findTask,
  recordActivity,
  taskRef,
  toActivity,
  type MockActivityRecord,
  type MockCommentRecord,
  type MockProjectRecord,
  type MockTaskRecord,
} from '../db'
import { API, requireWorkspaceMember, validationErrorResponse } from '../http'
import { isBefore, paginate, readCursor, readLimit } from '../pagination'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

type Metadata = Record<string, unknown>

// ---------------------------------------------------------------------------------------------
// Recording
// ---------------------------------------------------------------------------------------------

/** `workspace.*`: about the workspace itself. */
export function logWorkspaceActivity(workspaceId: UUID, actorId: UUID, action: ActivityAction, metadata: Metadata) {
  return recordActivity({
    workspace_id: workspaceId,
    project_id: null,
    task_id: null,
    actor_id: actorId,
    action,
    entity_type: 'workspace',
    entity_id: workspaceId,
    metadata,
  })
}

/** `member.*`: the entity is the member's user id. */
export function logMemberActivity(
  workspaceId: UUID,
  actorId: UUID,
  action: ActivityAction,
  userId: UUID,
  metadata: Metadata,
) {
  return recordActivity({
    workspace_id: workspaceId,
    project_id: null,
    task_id: null,
    actor_id: actorId,
    action,
    entity_type: 'member',
    entity_id: userId,
    metadata,
  })
}

/** `project.*`. */
export function logProjectActivity(
  project: MockProjectRecord,
  actorId: UUID,
  action: ActivityAction,
  metadata: Metadata,
) {
  return recordActivity({
    workspace_id: project.workspace_id,
    project_id: project.id,
    task_id: null,
    actor_id: actorId,
    action,
    entity_type: 'project',
    entity_id: project.id,
    metadata,
  })
}

/** `task.*`: `metadata.task` is the task's snapshot as it is now (after the change). */
export function logTaskActivity(task: MockTaskRecord, actorId: UUID, action: ActivityAction, metadata: Metadata = {}) {
  return recordActivity({
    workspace_id: task.workspace_id,
    project_id: task.project_id,
    // The task row is gone after a delete, so its entry keeps no task_id (contract 3.8).
    task_id: action === 'task.deleted' ? null : task.id,
    actor_id: actorId,
    action,
    entity_type: 'task',
    entity_id: task.id,
    metadata: { task: taskRef(task), ...metadata },
  })
}

/** `comment.*`: the entity is the comment; `metadata.task` is its task's snapshot. */
export function logCommentActivity(
  comment: MockCommentRecord,
  actorId: UUID,
  action: ActivityAction,
  metadata: Metadata = {},
) {
  const task = findTask(comment.task_id)
  if (!task) throw new Error(`No mock task ${comment.task_id}`)
  return recordActivity({
    workspace_id: task.workspace_id,
    project_id: task.project_id,
    task_id: task.id,
    actor_id: actorId,
    action,
    entity_type: 'comment',
    entity_id: comment.id,
    metadata: { task: taskRef(task), ...metadata },
  })
}

/** The first 140 characters of a comment body (contract 3.8). */
export function commentExcerpt(body: string): string {
  return [...body].slice(0, 140).join('')
}

// ---------------------------------------------------------------------------------------------
// The feed
// ---------------------------------------------------------------------------------------------

const FILTERS = { project_id: 'project_id', task_id: 'task_id', actor_id: 'actor_id' } as const
type Filter = keyof typeof FILTERS

/** The optional id filters; a value that is not a UUID is a 422 (like FastAPI's UUID params). */
function readFilters(params: URLSearchParams, errors: FieldError[]): Partial<Record<Filter, string>> {
  const filters: Partial<Record<Filter, string>> = {}
  for (const name of Object.keys(FILTERS) as Filter[]) {
    const value = params.get(name)
    if (value === null) continue
    if (UUID_PATTERN.test(value)) filters[name] = value.toLowerCase()
    else errors.push({ field: name, location: 'query', message: 'Input should be a valid UUID' })
  }
  return filters
}

/** Filters only narrow: an id from another workspace just matches nothing (never a 404). */
function matches(entry: MockActivityRecord, filters: Partial<Record<Filter, string>>): boolean {
  if (filters.project_id && entry.project_id !== filters.project_id) return false
  if (filters.task_id && entry.task_id !== filters.task_id) return false
  if (filters.actor_id && entry.actor_id !== filters.actor_id) return false
  return true
}

export const activityHandlers = [
  http.get(`${API}/workspaces/:wid/activity`, ({ params, request }) => {
    const access = requireWorkspaceMember(params.wid)
    if (access instanceof Response) return access
    const errors: FieldError[] = []
    const searchParams = new URL(request.url).searchParams
    const limit = readLimit(searchParams, errors)
    const cursor = readCursor(searchParams, errors)
    const filters = readFilters(searchParams, errors)
    if (errors.length > 0) return validationErrorResponse(errors)

    // Newest first: the next page holds older entries.
    const entries = activityOf(access.workspace.id).filter((entry) => matches(entry, filters))
    const page = paginate(entries, cursor, limit, isBefore)
    return HttpResponse.json<ActivityPage>({ items: page.items.map(toActivity), next_cursor: page.next_cursor })
  }),
]
