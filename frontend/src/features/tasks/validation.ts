// Client-side checks for the task forms (contract 1.8) and the PATCH body of the detail drawer.
// Text is trimmed first; the server validates again and its errors are shown per field.
import type { Task, TaskUpdate } from '../../api/types'
import { isValidDateOnly } from '../../lib/dates'
import type { FieldErrors } from '../../lib/formErrors'
import { charLength } from '../../lib/validation'
import { isTaskPriority, isTaskStatus } from './labels'

export const TASK_TITLE_MAX_LENGTH = 200
export const TASK_DESCRIPTION_MAX_LENGTH = 10000

/** Form fields of the detail drawer, named like the API fields so 422 errors map onto them. */
export type TaskField = 'title' | 'description' | 'status' | 'priority' | 'assignee_id' | 'due_date'
export const TASK_FIELDS: readonly TaskField[] = ['title', 'description', 'status', 'priority', 'assignee_id', 'due_date']

/** Form values are strings; '' stands for "none" (no description, unassigned, no due date). */
export type TaskFormValues = Record<TaskField, string>

export function validateTaskTitle(raw: string): string | undefined {
  const length = charLength(raw.trim())
  if (length === 0) return 'Enter a task title'
  if (length > TASK_TITLE_MAX_LENGTH) return `Title must be at most ${TASK_TITLE_MAX_LENGTH} characters`
  return undefined
}

export function validateTask(values: TaskFormValues): FieldErrors<TaskField> {
  const errors: FieldErrors<TaskField> = {}
  const title = validateTaskTitle(values.title)
  if (title) errors.title = title
  if (charLength(values.description.trim()) > TASK_DESCRIPTION_MAX_LENGTH) {
    errors.description = `Description must be at most ${TASK_DESCRIPTION_MAX_LENGTH} characters`
  }
  if (values.due_date && !isValidDateOnly(values.due_date)) errors.due_date = 'Enter a valid date'
  return errors
}

export function taskFormValues(task: Task): TaskFormValues {
  return {
    title: task.title,
    description: task.description ?? '',
    status: task.status,
    priority: task.priority,
    assignee_id: task.assignee?.id ?? '',
    due_date: task.due_date ?? '',
  }
}

/**
 * The PATCH body for the drawer: only the fields that changed (contract 1.7), with emptied
 * nullable fields sent as `null` to clear them. `{}` means there is nothing to save.
 */
export function taskChanges(task: Task, values: TaskFormValues): TaskUpdate {
  const body: TaskUpdate = {}
  const title = values.title.trim()
  const description = values.description.trim() || null
  const assigneeId = values.assignee_id || null
  const dueDate = values.due_date || null
  if (title !== task.title) body.title = title
  if (description !== task.description) body.description = description
  if (isTaskStatus(values.status) && values.status !== task.status) body.status = values.status
  if (isTaskPriority(values.priority) && values.priority !== task.priority) body.priority = values.priority
  if (assigneeId !== (task.assignee?.id ?? null)) body.assignee_id = assigneeId
  if (dueDate !== task.due_date) body.due_date = dueDate
  return body
}
