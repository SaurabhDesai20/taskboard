// Contract section 3.6 (Tasks) with the access rules of 1.10. The position math is the board's
// own (features/tasks/ordering.ts), so the mock and the optimistic updates agree.
import { http, HttpResponse } from 'msw'
import type { FieldError, MyTask, Task, TaskPriority, TaskStatus, UUID } from '../../api/types'
import { isTaskPriority, isTaskStatus, statusRank } from '../../features/tasks/labels'
import { positionBetween, POSITION_STEP } from '../../features/tasks/ordering'
import { isValidDateOnly } from '../../lib/dates'
import { can } from '../../lib/permissions'
import {
  createTask,
  db,
  deleteTask,
  findMembership,
  findProject,
  findTask,
  findWorkspace,
  tasksOf,
  toTask,
  type MockMembershipRecord,
  type MockProjectRecord,
  type MockTaskRecord,
} from '../db'
import {
  API,
  errorResponse,
  invalidUuidParams,
  readJsonObject,
  reasonError,
  requireProjectMember,
  requireUser,
  validateStrings,
  validationErrorResponse,
} from '../http'

// Wording from contract 3.6.
const MESSAGES = {
  notFound: 'Task not found',
  writeRole: 'Only owners, admins and members can create or edit tasks',
  deleteRole: 'Only owners and admins can delete tasks',
  archived: 'This project is archived, so its tasks are read-only',
  assignee: 'Assignee must be a member of this workspace',
  neighbour: 'Must be another task of this project with the target status',
  neighbourOrder: 'Must come after after_task_id in the target column',
}

const TITLE_RULE = { min: 1, max: 200 }
const DESCRIPTION_MAX_LENGTH = 10000
const SEARCH_MAX_LENGTH = 200

/** A column is rebalanced when the gap between the new neighbours is below this (contract 3.6). */
export const REBALANCE_GAP = 1e-6

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const STATUS_MESSAGE = "Input should be 'todo', 'in_progress', 'in_review' or 'done'"
const PRIORITY_MESSAGE = "Input should be 'low', 'medium', 'high' or 'urgent'"

type JsonObject = Record<string, unknown>
type Location = FieldError['location']

const fieldError = (field: string, message: string, location: Location = 'body'): FieldError => ({
  field,
  location,
  message,
})

// ---------------------------------------------------------------------------------------------
// Access
// ---------------------------------------------------------------------------------------------

interface TaskAccess {
  task: MockTaskRecord
  project: MockProjectRecord
  membership: MockMembershipRecord
}

/** Resolve task -> project -> workspace, then 404 when it does not exist or I am not a member. */
function requireTaskMember(tid: string | readonly string[] | undefined): TaskAccess | Response {
  const invalid = invalidUuidParams({ tid })
  if (invalid) return invalid
  const user = requireUser()
  if (user instanceof Response) return user
  const task = findTask(tid as string)
  const project = task ? findProject(task.project_id) : undefined
  const membership = project ? findMembership(project.workspace_id, user.id) : undefined
  if (!task || !project || !membership) return errorResponse('not_found', MESSAGES.notFound)
  return { task, project, membership }
}

const forbiddenWrite = () => reasonError('forbidden', 'insufficient_role', MESSAGES.writeRole)
const archivedConflict = () => reasonError('conflict', 'project_archived', MESSAGES.archived)

// ---------------------------------------------------------------------------------------------
// Body fields (each reader returns the value, or pushes a 422 entry)
// ---------------------------------------------------------------------------------------------

function readTitle(raw: unknown, errors: FieldError[]): string | undefined {
  const checked = validateStrings({ title: raw }, { title: TITLE_RULE })
  errors.push(...checked.errors)
  return checked.errors.length === 0 ? checked.values.title : undefined
}

/** Nullable; trimmed; a blank one is stored as "" like the project description. */
function readDescription(raw: unknown, errors: FieldError[]): string | null | undefined {
  if (raw === null) return null
  if (typeof raw !== 'string') {
    errors.push(fieldError('description', 'Input should be a valid string'))
    return undefined
  }
  const value = raw.trim()
  if ([...value].length > DESCRIPTION_MAX_LENGTH) {
    errors.push(fieldError('description', `String should have at most ${DESCRIPTION_MAX_LENGTH} characters`))
    return undefined
  }
  return value
}

function readStatus(raw: unknown, errors: FieldError[]): TaskStatus | undefined {
  if (isTaskStatus(raw)) return raw
  errors.push(fieldError('status', STATUS_MESSAGE))
  return undefined
}

function readPriority(raw: unknown, errors: FieldError[]): TaskPriority | undefined {
  if (isTaskPriority(raw)) return raw
  errors.push(fieldError('priority', PRIORITY_MESSAGE))
  return undefined
}

/** A nullable UUID body field (`assignee_id`, `after_task_id`, `before_task_id`). */
function readOptionalId(body: JsonObject, field: string, errors: FieldError[]): UUID | null | undefined {
  const raw = body[field]
  if (raw === undefined || raw === null) return raw
  if (typeof raw === 'string' && UUID_PATTERN.test(raw)) return raw.toLowerCase()
  errors.push(fieldError(field, 'Input should be a valid UUID'))
  return undefined
}

function readDueDate(raw: unknown, errors: FieldError[]): string | null | undefined {
  if (raw === null) return null
  if (typeof raw === 'string' && isValidDateOnly(raw)) return raw
  errors.push(fieldError('due_date', 'Input should be a valid date in the format YYYY-MM-DD'))
  return undefined
}

/** `assignee_id` must be a member of the task's workspace (contract 3.6, a business-rule 422). */
function assigneeError(workspaceId: UUID, assigneeId: UUID | null | undefined): Response | null {
  if (!assigneeId || findMembership(workspaceId, assigneeId)) return null
  return validationErrorResponse([fieldError('assignee_id', MESSAGES.assignee)])
}

// ---------------------------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------------------------

/** A status column in position order, without `excludeId`. */
function columnOf(projectId: UUID, status: TaskStatus, excludeId?: UUID): MockTaskRecord[] {
  return tasksOf(projectId)
    .filter((task) => task.status === status && task.id !== excludeId)
    .sort(byPosition)
}

/** Position order, then number, like the server (equal positions still list in a stable order). */
function byPosition(a: MockTaskRecord, b: MockTaskRecord): number {
  return a.position - b.position || a.number - b.number
}

/** End of a column: last position + 1024, or 1024 when it is empty. */
function endOfColumn(projectId: UUID, status: TaskStatus, excludeId?: UUID): number {
  const column = columnOf(projectId, status, excludeId)
  return positionBetween(null, null, column.length > 0 ? column[column.length - 1].position : null)
}

/** Positions 1024, 2048, ... in this order; tasks whose position changes count as updated. */
function rebalance(ordered: MockTaskRecord[]): void {
  ordered.forEach((task, index) => {
    const position = (index + 1) * POSITION_STEP
    if (task.position !== position) {
      task.position = position
      touch(task)
    }
  })
}

/**
 * Where a moved task goes (contract 3.6): directly after `after` (between it and its current
 * successor), else directly before `before` (between its current predecessor and it), else the
 * end of the column. With an up-to-date column this is the move table. When the two positions
 * it goes between are too close, the column is rebalanced with the task in its place.
 */
function placeInColumn(
  task: MockTaskRecord,
  column: MockTaskRecord[],
  after: MockTaskRecord | undefined,
  before: MockTaskRecord | undefined,
): void {
  let index = column.length
  if (after) index = column.indexOf(after) + 1
  else if (before) index = column.indexOf(before)
  const previous = column[index - 1] ?? null
  const next = column[index] ?? null
  if (previous && next && Math.abs(next.position - previous.position) < REBALANCE_GAP) {
    rebalance([...column.slice(0, index), task, ...column.slice(index)])
    return
  }
  const last = column.length > 0 ? column[column.length - 1].position : null
  task.position = positionBetween(previous?.position ?? null, next?.position ?? null, last)
}

function byStatusThenPosition(a: MockTaskRecord, b: MockTaskRecord): number {
  return statusRank(a.status) - statusRank(b.status) || byPosition(a, b)
}

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

/** Due date ascending with no due date last, then creation time, then id (contract 3.6, `/me/tasks`). */
function byDueDate(a: MockTaskRecord, b: MockTaskRecord): number {
  if (a.due_date !== b.due_date) {
    if (a.due_date === null) return 1
    if (b.due_date === null) return -1
    return compareStrings(a.due_date, b.due_date)
  }
  return compareStrings(a.created_at, b.created_at) || compareStrings(a.id, b.id)
}

// ---------------------------------------------------------------------------------------------
// Query params
// ---------------------------------------------------------------------------------------------

interface ListQuery {
  status: TaskStatus[]
  priority: TaskPriority[]
  assignee: UUID | 'none' | null
  dueBefore: string | null
  q: string | null
}

/** A repeatable enum query param; a bad value is reported with its index (`status.1`). */
function readEnumList<T extends string>(
  params: URLSearchParams,
  name: string,
  isValid: (value: unknown) => value is T,
  message: string,
  errors: FieldError[],
): T[] {
  const values = params.getAll(name)
  values.forEach((value, index) => {
    if (!isValid(value)) errors.push(fieldError(`${name}.${index}`, message, 'query'))
  })
  return values.filter(isValid)
}

function readDueBefore(params: URLSearchParams, errors: FieldError[]): string | null {
  const dueBefore = params.get('due_before')
  if (dueBefore !== null && !isValidDateOnly(dueBefore)) {
    errors.push(fieldError('due_before', 'Input should be a valid date in the format YYYY-MM-DD', 'query'))
  }
  return dueBefore
}

function readListQuery(url: URL, errors: FieldError[]): ListQuery {
  const params = url.searchParams
  const status = readEnumList(params, 'status', isTaskStatus, STATUS_MESSAGE, errors)
  const priority = readEnumList(params, 'priority', isTaskPriority, PRIORITY_MESSAGE, errors)

  // `none` is case-sensitive; a UUID of someone who is not a member just matches nothing.
  const assignee = params.get('assignee_id')
  if (assignee !== null && assignee !== 'none' && !UUID_PATTERN.test(assignee)) {
    errors.push(fieldError('assignee_id', "Input should be a valid UUID or 'none'", 'query'))
  }
  const dueBefore = readDueBefore(params, errors)
  const rawQ = params.get('q')
  const q = rawQ === null ? null : rawQ.trim()
  if (q !== null && ([...q].length < 1 || [...q].length > SEARCH_MAX_LENGTH)) {
    errors.push(fieldError('q', `String should have 1 to ${SEARCH_MAX_LENGTH} characters`, 'query'))
  }
  return {
    status,
    priority,
    assignee: assignee === 'none' ? 'none' : (assignee?.toLowerCase() ?? null),
    dueBefore,
    q,
  }
}

function matches(task: MockTaskRecord, query: ListQuery): boolean {
  if (query.status.length > 0 && !query.status.includes(task.status)) return false
  if (query.priority.length > 0 && !query.priority.includes(task.priority)) return false
  if (query.assignee === 'none' && task.assignee_id !== null) return false
  if (query.assignee && query.assignee !== 'none' && task.assignee_id !== query.assignee) return false
  if (query.dueBefore && (task.due_date === null || task.due_date > query.dueBefore)) return false
  if (query.q) {
    const needle = query.q.toLowerCase()
    const inTitle = task.title.toLowerCase().includes(needle)
    const inDescription = task.description?.toLowerCase().includes(needle) ?? false
    if (!inTitle && !inDescription) return false
  }
  return true
}

const touch = (task: MockTaskRecord) => {
  task.updated_at = new Date().toISOString()
}

// ---------------------------------------------------------------------------------------------
// Handlers
// ---------------------------------------------------------------------------------------------

export const taskHandlers = [
  http.get(`${API}/projects/:pid/tasks`, ({ params, request }) => {
    const access = requireProjectMember(params.pid)
    if (access instanceof Response) return access
    const errors: FieldError[] = []
    const query = readListQuery(new URL(request.url), errors)
    if (errors.length > 0) return validationErrorResponse(errors)
    const tasks = tasksOf(access.project.id)
      .filter((task) => matches(task, query))
      .sort(byStatusThenPosition)
      .map(toTask)
    return HttpResponse.json<Task[]>(tasks)
  }),

  http.post(`${API}/projects/:pid/tasks`, async ({ params, request }) => {
    const access = requireProjectMember(params.pid)
    if (access instanceof Response) return access
    const { project, membership } = access
    if (!can(membership.role, 'task.write')) return forbiddenWrite()
    const body = await readJsonObject(request)
    if (body instanceof Response) return body

    const errors: FieldError[] = []
    const title = readTitle(body.title, errors)
    const description = body.description === undefined ? null : readDescription(body.description, errors)
    const status = body.status === undefined ? 'todo' : readStatus(body.status, errors)
    const priority = body.priority === undefined ? 'medium' : readPriority(body.priority, errors)
    const assigneeId = readOptionalId(body, 'assignee_id', errors)
    const dueDate = body.due_date === undefined ? null : readDueDate(body.due_date, errors)
    if (errors.length > 0 || title === undefined || status === undefined || priority === undefined) {
      return validationErrorResponse(errors)
    }

    if (project.archived_at !== null) return archivedConflict()
    const invalidAssignee = assigneeError(project.workspace_id, assigneeId)
    if (invalidAssignee) return invalidAssignee

    const task = createTask({
      project_id: project.id,
      workspace_id: project.workspace_id,
      title,
      description: description ?? null,
      status,
      priority,
      position: endOfColumn(project.id, status),
      assignee_id: assigneeId ?? null,
      due_date: dueDate ?? null,
      created_by: membership.user_id,
    })
    return HttpResponse.json<Task>(toTask(task), { status: 201 })
  }),

  http.get(`${API}/tasks/:tid`, ({ params }) => {
    const access = requireTaskMember(params.tid)
    if (access instanceof Response) return access
    return HttpResponse.json<Task>(toTask(access.task))
  }),

  http.patch(`${API}/tasks/:tid`, async ({ params, request }) => {
    const access = requireTaskMember(params.tid)
    if (access instanceof Response) return access
    const { task, project, membership } = access
    if (!can(membership.role, 'task.write')) return forbiddenWrite()
    const body = await readJsonObject(request)
    if (body instanceof Response) return body

    // Partial (contract 1.7): omitted fields stay; null clears the nullable ones only.
    const errors: FieldError[] = []
    const title = body.title === undefined ? undefined : readTitle(body.title, errors)
    const description = body.description === undefined ? undefined : readDescription(body.description, errors)
    const status = body.status === undefined ? undefined : readStatus(body.status, errors)
    const priority = body.priority === undefined ? undefined : readPriority(body.priority, errors)
    const assigneeId = readOptionalId(body, 'assignee_id', errors)
    const dueDate = body.due_date === undefined ? undefined : readDueDate(body.due_date, errors)
    if (errors.length > 0) return validationErrorResponse(errors)

    if (project.archived_at !== null) return archivedConflict()
    // Only a new assignee must be a member, so a task whose assignee left can still be edited.
    const invalidAssignee = assigneeId === task.assignee_id ? null : assigneeError(project.workspace_id, assigneeId)
    if (invalidAssignee) return invalidAssignee

    const before = JSON.stringify(task)
    if (title !== undefined) task.title = title
    if (description !== undefined) task.description = description
    if (priority !== undefined) task.priority = priority
    if (body.assignee_id !== undefined) task.assignee_id = assigneeId ?? null
    if (dueDate !== undefined) task.due_date = dueDate
    if (status !== undefined && status !== task.status) {
      // A status change through PATCH goes to the end of the new column.
      task.position = endOfColumn(project.id, status, task.id)
      task.status = status
    }
    if (JSON.stringify(task) !== before) touch(task)
    return HttpResponse.json<Task>(toTask(task))
  }),

  http.delete(`${API}/tasks/:tid`, ({ params }) => {
    const access = requireTaskMember(params.tid)
    if (access instanceof Response) return access
    if (!can(access.membership.role, 'task.delete')) {
      return reasonError('forbidden', 'insufficient_role', MESSAGES.deleteRole)
    }
    // Allowed in archived projects too (contract 1.10).
    deleteTask(access.task.id)
    return new HttpResponse(null, { status: 204 })
  }),

  http.post(`${API}/tasks/:tid/move`, async ({ params, request }) => {
    const access = requireTaskMember(params.tid)
    if (access instanceof Response) return access
    const { task, project, membership } = access
    if (!can(membership.role, 'task.write')) return forbiddenWrite()
    const body = await readJsonObject(request)
    if (body instanceof Response) return body

    const errors: FieldError[] = []
    const status = body.status === undefined ? undefined : readStatus(body.status, errors)
    if (body.status === undefined) errors.push(fieldError('status', 'Field required'))
    const afterId = readOptionalId(body, 'after_task_id', errors)
    const beforeId = readOptionalId(body, 'before_task_id', errors)
    if (errors.length > 0 || status === undefined) return validationErrorResponse(errors)

    if (project.archived_at !== null) return archivedConflict()

    // Both neighbours must be other tasks of this project, already in the target status, and
    // `before` must come after `after` in the column (not necessarily adjacent).
    const column = columnOf(project.id, status, task.id)
    const neighbour = (id: UUID | null | undefined) => (id ? column.find((item) => item.id === id) : undefined)
    const after = neighbour(afterId)
    const before = neighbour(beforeId)
    if (afterId && !after) errors.push(fieldError('after_task_id', MESSAGES.neighbour))
    if (beforeId && !before) errors.push(fieldError('before_task_id', MESSAGES.neighbour))
    if (after && before && column.indexOf(before) <= column.indexOf(after)) {
      errors.push(fieldError('before_task_id', MESSAGES.neighbourOrder))
    }
    if (errors.length > 0) return validationErrorResponse(errors)

    placeInColumn(task, column, after, before)
    task.status = status
    touch(task)
    return HttpResponse.json<Task>(toTask(task))
  }),

  http.get(`${API}/me/tasks`, ({ request }) => {
    const user = requireUser()
    if (user instanceof Response) return user
    const errors: FieldError[] = []
    const params = new URL(request.url).searchParams
    const status = readEnumList(params, 'status', isTaskStatus, STATUS_MESSAGE, errors)
    const dueBefore = readDueBefore(params, errors)
    if (errors.length > 0) return validationErrorResponse(errors)

    const query: ListQuery = { status, priority: [], assignee: user.id, dueBefore, q: null }
    const tasks = db.tasks
      .filter((task) => {
        const project = findProject(task.project_id)
        return (
          project !== undefined &&
          project.archived_at === null &&
          findMembership(task.workspace_id, user.id) !== undefined &&
          matches(task, query)
        )
      })
      .sort(byDueDate)
      .map((record): MyTask => {
        const project = findProject(record.project_id) as MockProjectRecord
        const workspace = findWorkspace(record.workspace_id)
        return {
          ...toTask(record),
          project: { id: project.id, name: project.name, key: project.key },
          workspace: { id: record.workspace_id, name: workspace?.name ?? '', slug: workspace?.slug ?? '' },
        }
      })
    return HttpResponse.json<MyTask[]>(tasks)
  }),
]
