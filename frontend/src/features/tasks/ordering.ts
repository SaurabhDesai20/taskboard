// Task ordering on the board (contract 3.6): columns by status, tasks by `position` ascending.
// Pure functions shared by the board (drag and drop, the move menu, the optimistic update) and
// the MSW mock (the server's position math), so all of them agree.
import type { TaskMoveRequest, TaskStatus, UUID } from '../../api/types'
import { STATUS_LABELS, statusRank, TASK_STATUSES } from './labels'

/** Gap between neighbouring positions: first/last moves use +/- this much. */
export const POSITION_STEP = 1024

interface Ordered {
  id: UUID
  status: TaskStatus
  position: number
}

/** The server's list order: status (To Do first), then position. */
export function compareTasks(a: Ordered, b: Ordered): number {
  return statusRank(a.status) - statusRank(b.status) || a.position - b.position
}

/** A sorted copy (stable, so equal positions keep their current order). */
export function sortTasks<T extends Ordered>(tasks: readonly T[]): T[] {
  return [...tasks].sort(compareTasks)
}

/** Each status column's tasks, in position order. */
export function groupByStatus<T extends Ordered>(tasks: readonly T[]): Record<TaskStatus, T[]> {
  const columns = { todo: [], in_progress: [], in_review: [], done: [] } as Record<TaskStatus, T[]>
  for (const task of sortTasks(tasks)) columns[task.status].push(task)
  return columns
}

/**
 * The position a moved task gets between its new neighbours (contract 3.6 move table).
 * `last` is the last position in the target column (without the moved task), for a move with
 * no neighbours ("end of the column, or 1024 if empty").
 */
export function positionBetween(after: number | null, before: number | null, last: number | null): number {
  if (after !== null && before !== null) return (after + before) / 2
  if (after !== null) return after + POSITION_STEP
  if (before !== null) return before - POSITION_STEP
  return last === null ? POSITION_STEP : last + POSITION_STEP
}

/** The neighbours a task should have after a move, in the target column. */
export interface Neighbours {
  after_task_id: UUID | null
  before_task_id: UUID | null
}

/**
 * The neighbours of `taskId` in `columnIds`, the target column's order **after** the drop
 * (with the moved task in it). This is what `POST /tasks/{tid}/move` wants.
 */
export function neighboursOf(columnIds: readonly UUID[], taskId: UUID): Neighbours {
  const index = columnIds.indexOf(taskId)
  if (index === -1) throw new Error(`Task ${taskId} is not in the column`)
  return {
    after_task_id: columnIds[index - 1] ?? null,
    before_task_id: columnIds[index + 1] ?? null,
  }
}

/**
 * The neighbours for putting `taskId` at `index` of a column, counted among the column's other
 * tasks (the task itself is ignored if it is already there). The index is clamped to the column.
 */
export function neighboursAt(columnIds: readonly UUID[], taskId: UUID, index: number): Neighbours {
  const others = columnIds.filter((id) => id !== taskId)
  const at = Math.max(0, Math.min(index, others.length))
  return { after_task_id: others[at - 1] ?? null, before_task_id: others[at] ?? null }
}

/**
 * The optimistic result of a move: the task gets the target status and the position the server
 * will give it (same math as the server), and the list is re-sorted. Other tasks keep their
 * positions; a server-side rebalance shows up when the list is refetched.
 */
export function applyMove<T extends Ordered>(tasks: readonly T[], taskId: UUID, move: TaskMoveRequest): T[] {
  const moved = tasks.find((task) => task.id === taskId)
  if (!moved) return [...tasks]
  const column = sortTasks(tasks.filter((task) => task.status === move.status && task.id !== taskId))
  const positionOf = (id: UUID | null | undefined) =>
    id ? (column.find((task) => task.id === id)?.position ?? null) : null
  const position = positionBetween(
    positionOf(move.after_task_id),
    positionOf(move.before_task_id),
    column.length > 0 ? column[column.length - 1].position : null,
  )
  return sortTasks(tasks.map((task) => (task.id === taskId ? { ...task, status: move.status, position } : task)))
}

// ---------------------------------------------------------------------------------------------
// Drag and drop: the board's arrangement while dragging, as task ids per column
// ---------------------------------------------------------------------------------------------

export type ColumnIds = Record<TaskStatus, UUID[]>

export function columnIdsOf(columns: Record<TaskStatus, readonly { id: UUID }[]>): ColumnIds {
  const ids = {} as ColumnIds
  for (const status of TASK_STATUSES) ids[status] = columns[status].map((task) => task.id)
  return ids
}

/** The column holding `taskId`, if any. */
export function columnOf(columns: ColumnIds, taskId: UUID): TaskStatus | undefined {
  return TASK_STATUSES.find((status) => columns[status].includes(taskId))
}

/** A copy of `columns` with `taskId` taken out of its column and put at `index` of `target`. */
export function placeTask(columns: ColumnIds, taskId: UUID, target: TaskStatus, index: number): ColumnIds {
  const next = {} as ColumnIds
  for (const status of TASK_STATUSES) next[status] = columns[status].filter((id) => id !== taskId)
  const at = Math.max(0, Math.min(index, next[target].length))
  next[target] = [...next[target].slice(0, at), taskId, ...next[target].slice(at)]
  return next
}

/**
 * The move request for a drop, from the arrangement before the drag and the one at the drop;
 * null when the task ends where it started (nothing to send).
 */
export function dropRequest(before: ColumnIds, after: ColumnIds, taskId: UUID): TaskMoveRequest | null {
  const from = columnOf(before, taskId)
  const to = columnOf(after, taskId)
  if (!from || !to) return null
  const neighbours = neighboursOf(after[to], taskId)
  if (from === to) {
    const original = neighboursOf(before[from], taskId)
    if (
      original.after_task_id === neighbours.after_task_id &&
      original.before_task_id === neighbours.before_task_id
    ) {
      return null
    }
  }
  return { status: to, ...neighbours }
}

// ---------------------------------------------------------------------------------------------
// The keyboard move menu
// ---------------------------------------------------------------------------------------------

export interface MoveOption {
  /** Stable id for React keys and tests: `up`, `down`, `top:<status>`, `bottom:<status>`, `to:<status>`. */
  id: string
  label: string
  request: TaskMoveRequest
}

/**
 * What the move menu offers for `taskId`: up and down within its column, then the top and the
 * bottom of every other column (just "Move to X" for an empty one).
 */
export function moveOptions(columns: ColumnIds, taskId: UUID): MoveOption[] {
  const status = columnOf(columns, taskId)
  if (!status) return []
  const column = columns[status]
  const index = column.indexOf(taskId)
  const options: MoveOption[] = []
  if (index > 0) {
    options.push({ id: 'up', label: 'Move up', request: { status, ...neighboursAt(column, taskId, index - 1) } })
  }
  if (index < column.length - 1) {
    options.push({ id: 'down', label: 'Move down', request: { status, ...neighboursAt(column, taskId, index + 1) } })
  }
  for (const target of TASK_STATUSES) {
    if (target === status) continue
    const ids = columns[target]
    const label = STATUS_LABELS[target]
    if (ids.length === 0) {
      options.push({
        id: `to:${target}`,
        label: `Move to ${label}`,
        request: { status: target, after_task_id: null, before_task_id: null },
      })
      continue
    }
    options.push(
      {
        id: `top:${target}`,
        label: `Move to top of ${label}`,
        request: { status: target, after_task_id: null, before_task_id: ids[0] },
      },
      {
        id: `bottom:${target}`,
        label: `Move to bottom of ${label}`,
        request: { status: target, after_task_id: ids[ids.length - 1], before_task_id: null },
      },
    )
  }
  return options
}
