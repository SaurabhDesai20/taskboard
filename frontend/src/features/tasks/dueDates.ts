// Due-date rules shared by the cards, the list view and My Tasks. `today` is the user's local
// calendar day (`todayDateOnly()`); `YYYY-MM-DD` strings compare correctly as text.
import type { DateOnly, TaskStatus } from '../../api/types'
import { addDays } from '../../lib/dates'

/** Days in "Due this week": today and the six days after it. */
export const DUE_SOON_DAYS = 7

interface Due {
  status: TaskStatus
  due_date: DateOnly | null
}

/** Due before today and not done. A task due today is not overdue yet. */
export function isOverdue(task: Due, today: DateOnly): boolean {
  return task.due_date !== null && task.status !== 'done' && task.due_date < today
}

export type MyTaskGroup = 'overdue' | 'this_week' | 'later' | 'no_due_date'

export const MY_TASK_GROUPS: readonly MyTaskGroup[] = ['overdue', 'this_week', 'later', 'no_due_date']

export const MY_TASK_GROUP_LABELS: Readonly<Record<MyTaskGroup, string>> = {
  overdue: 'Overdue',
  this_week: 'Due this week',
  later: 'Later',
  no_due_date: 'No due date',
}

export function myTaskGroupOf(task: Due, today: DateOnly): MyTaskGroup {
  if (task.due_date === null) return 'no_due_date'
  if (isOverdue(task, today)) return 'overdue'
  if (task.due_date < addDays(today, DUE_SOON_DAYS)) return 'this_week'
  return 'later'
}

/**
 * My Tasks sections for the open (not done) tasks, keeping the server's order (due date, then
 * creation) inside each one. Done tasks are left out: they are not work to do.
 */
export function groupMyTasks<T extends Due>(tasks: readonly T[], today: DateOnly): Record<MyTaskGroup, T[]> {
  const groups: Record<MyTaskGroup, T[]> = { overdue: [], this_week: [], later: [], no_due_date: [] }
  for (const task of tasks) {
    if (task.status !== 'done') groups[myTaskGroupOf(task, today)].push(task)
  }
  return groups
}
