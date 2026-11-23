// The board's filters, view and open task live in the URL's search params, so a filtered board
// or an open task survives a refresh and can be shared:
//   ?status=todo&status=done&priority=high&assignee=<uuid>|none&due_before=2026-12-01&q=login
//   &view=list&task=<uuid>
// Filters go to `GET /projects/{pid}/tasks` as the contract's query params (3.6).
import type { QueryParams } from '../../api/client'
import type { DateOnly, TaskPriority, TaskStatus, UUID } from '../../api/types'
import { isValidDateOnly } from '../../lib/dates'
import { isTaskPriority, isTaskStatus, TASK_PRIORITIES, TASK_STATUSES } from './labels'

/** `q` is 1 to 200 characters (contract 3.6). */
export const SEARCH_MAX_LENGTH = 200

/** `assignee` value for "no assignee" (sent as `assignee_id=none`). */
export const UNASSIGNED = 'none'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export interface TaskFilters {
  /** Empty: every status. */
  status: TaskStatus[]
  /** Empty: every priority. */
  priority: TaskPriority[]
  /** A member's user id, `UNASSIGNED`, or null for anyone. */
  assignee: UUID | null
  /** Due on or before this date (tasks without a due date are left out). */
  dueBefore: DateOnly | null
  /** Text in the title or description. */
  q: string | null
}

export const NO_FILTERS: TaskFilters = { status: [], priority: [], assignee: null, dueBefore: null, q: null }

export const FILTER_PARAMS = ['status', 'priority', 'assignee', 'due_before', 'q'] as const

export type BoardView = 'board' | 'list'

/** Trimmed and capped search text, or null when empty. */
export function normalizeSearch(value: string | null | undefined): string | null {
  const text = [...(value ?? '').trim()].slice(0, SEARCH_MAX_LENGTH).join('')
  return text === '' ? null : text
}

/** In enum order, without duplicates, so equal filters give equal query keys. */
function inOrder<T extends string>(values: readonly string[], order: readonly T[]): T[] {
  return order.filter((value) => values.includes(value))
}

/** The filters in a URL. Values that are not valid are ignored rather than sent to the API. */
export function filtersFromSearchParams(params: URLSearchParams): TaskFilters {
  const assignee = params.get('assignee')
  const dueBefore = params.get('due_before')
  return {
    status: inOrder(params.getAll('status').filter(isTaskStatus), TASK_STATUSES),
    priority: inOrder(params.getAll('priority').filter(isTaskPriority), TASK_PRIORITIES),
    assignee: assignee === UNASSIGNED || (assignee && UUID_PATTERN.test(assignee)) ? assignee : null,
    dueBefore: dueBefore && isValidDateOnly(dueBefore) ? dueBefore : null,
    q: normalizeSearch(params.get('q')),
  }
}

/** A copy of `params` with `filters` written in; other params (view, task) are kept. */
export function withFilters(params: URLSearchParams, filters: TaskFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  for (const name of FILTER_PARAMS) next.delete(name)
  for (const status of inOrder(filters.status, TASK_STATUSES)) next.append('status', status)
  for (const priority of inOrder(filters.priority, TASK_PRIORITIES)) next.append('priority', priority)
  if (filters.assignee) next.set('assignee', filters.assignee)
  if (filters.dueBefore) next.set('due_before', filters.dueBefore)
  const q = normalizeSearch(filters.q)
  if (q) next.set('q', q)
  return next
}

export function hasActiveFilters(filters: TaskFilters): boolean {
  return (
    filters.status.length > 0 ||
    filters.priority.length > 0 ||
    filters.assignee !== null ||
    filters.dueBefore !== null ||
    filters.q !== null
  )
}

/** The contract's query params for `GET /projects/{pid}/tasks`. */
export function filtersToQuery(filters: TaskFilters): QueryParams {
  return {
    status: filters.status,
    priority: filters.priority,
    assignee_id: filters.assignee,
    due_before: filters.dueBefore,
    q: filters.q,
  }
}

export function viewFromSearchParams(params: URLSearchParams): BoardView {
  return params.get('view') === 'list' ? 'list' : 'board'
}

/** A copy of `params` showing `view` (the board is the default, so it is left out). */
export function withView(params: URLSearchParams, view: BoardView): URLSearchParams {
  const next = new URLSearchParams(params)
  if (view === 'list') next.set('view', 'list')
  else next.delete('view')
  return next
}

/** The task open in the detail drawer. */
export function taskIdFromSearchParams(params: URLSearchParams): UUID | null {
  return params.get('task') || null
}

/** A copy of `params` with the drawer open on `taskId`, or closed for null. */
export function withTask(params: URLSearchParams, taskId: UUID | null): URLSearchParams {
  const next = new URLSearchParams(params)
  if (taskId) next.set('task', taskId)
  else next.delete('task')
  return next
}
