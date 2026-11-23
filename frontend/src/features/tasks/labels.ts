// Task enums (contract 1.9) with their UI labels, in display order. Shared with the MSW mock.
import type { TaskPriority, TaskStatus } from '../../api/types'

/** Board columns, left to right; also the server's list order. */
export const TASK_STATUSES: readonly TaskStatus[] = ['todo', 'in_progress', 'in_review', 'done']

export const STATUS_LABELS: Readonly<Record<TaskStatus, string>> = {
  todo: 'To Do',
  in_progress: 'In Progress',
  in_review: 'In Review',
  done: 'Done',
}

/** Lowest first. */
export const TASK_PRIORITIES: readonly TaskPriority[] = ['low', 'medium', 'high', 'urgent']

export const PRIORITY_LABELS: Readonly<Record<TaskPriority, string>> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
}

export function isTaskStatus(value: unknown): value is TaskStatus {
  return typeof value === 'string' && (TASK_STATUSES as readonly string[]).includes(value)
}

export function isTaskPriority(value: unknown): value is TaskPriority {
  return typeof value === 'string' && (TASK_PRIORITIES as readonly string[]).includes(value)
}

/** Board order of a status: 0 for To Do ... 3 for Done. */
export function statusRank(status: TaskStatus): number {
  return TASK_STATUSES.indexOf(status)
}
