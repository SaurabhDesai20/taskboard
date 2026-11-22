import { useId, useRef, useState } from 'react'
import type { Member, Project, Role, Task, UUID } from '../../api/types'
import { Modal } from '../../components/Modal'
import { SelectField } from '../../components/SelectField'
import { StatusMessage } from '../../components/StatusMessage'
import { TextAreaField } from '../../components/TextAreaField'
import { TextField } from '../../components/TextField'
import { formatDate, todayDateOnly } from '../../lib/dates'
import { formErrorsFromError } from '../../lib/formErrors'
import { useForm } from '../../lib/useForm'
import { CommentsSection } from '../comments/CommentsSection'
import { DueDate } from './DueDate'
import { isOverdue } from './dueDates'
import { isTaskNotFound, useDeleteTask, useTask, useUpdateTask } from './hooks'
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from './labels'
import { PriorityBadge } from './PriorityBadge'
import { TASK_FIELDS, taskChanges, taskFormValues, validateTask, type TaskField } from './validation'

interface TaskDrawerProps {
  project: Project
  taskId: UUID
  /** The workspace's members, for the assignee choice. */
  members: Member[]
  /** Edit the task (members and up, active projects only); otherwise the details are read-only. */
  canWrite: boolean
  /** Delete the task (owners and admins, archived projects included). */
  canDelete: boolean
  /** Why the details are read-only, shown when `canWrite` is false. */
  readOnlyReason: string
  /** My role in the workspace, for the comment thread (who may comment, edit, delete). */
  role: Role
  onClose: () => void
}

/**
 * The task detail drawer, opened by `?task=<id>` on the board (so it survives a refresh and can
 * be linked to). A keyboard-operable dialog: focus starts on Close, Tab stays inside, Escape
 * closes and returns focus to the card.
 */
export function TaskDrawer({
  project,
  taskId,
  members,
  canWrite,
  canDelete,
  readOnlyReason,
  role,
  onClose,
}: TaskDrawerProps) {
  const query = useTask(project, taskId)
  const notFound = query.isError && isTaskNotFound(query.error)
  const task = notFound ? undefined : query.data

  let title: string
  let body
  if (notFound) {
    title = 'Task not found'
    body = <p>It does not exist (it may have been deleted), or it is not part of {project.name}.</p>
  } else if (task) {
    title = task.title
    body = (
      <>
        <p className="task-drawer__meta">
          <span className="task-card__key">{task.key}</span> in {project.name} · Created {formatDate(task.created_at)}
        </p>
        {canWrite ? (
          <TaskEditForm key={task.id} task={task} members={members} />
        ) : (
          <TaskReadOnly task={task} reason={readOnlyReason} />
        )}
        <CommentsSection task={task} project={project} role={role} />
        {canDelete ? <DeleteTask key={task.id} task={task} onDeleted={onClose} /> : null}
      </>
    )
  } else if (query.isError) {
    title = 'Task'
    body = (
      <StatusMessage
        tone="error"
        action={
          <button type="button" className="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        }
      >
        Could not load the task. {query.error.message}
      </StatusMessage>
    )
  } else {
    title = 'Task'
    body = <StatusMessage>Loading task...</StatusMessage>
  }

  return (
    <Modal title={title} onClose={onClose} variant="drawer">
      <button
        type="button"
        className="button button--small task-drawer__close"
        aria-label="Close task details"
        onClick={onClose}
      >
        Close
      </button>
      {body}
    </Modal>
  )
}

function TaskReadOnly({ task, reason }: { task: Task; reason: string }) {
  return (
    <div className="task-drawer__section">
      <p className="field__hint">{reason}</p>
      <dl className="details">
        <div>
          <dt>Status</dt>
          <dd>{STATUS_LABELS[task.status]}</dd>
        </div>
        <div>
          <dt>Priority</dt>
          <dd>
            <PriorityBadge priority={task.priority} />
          </dd>
        </div>
        <div>
          <dt>Assignee</dt>
          <dd>{task.assignee?.name ?? 'Unassigned'}</dd>
        </div>
        <div>
          <dt>Due date</dt>
          <dd>
            {task.due_date ? <DueDate date={task.due_date} overdue={isOverdue(task, todayDateOnly())} /> : 'None'}
          </dd>
        </div>
      </dl>
      <h3 className="task-drawer__subtitle">Description</h3>
      <p className={`task-drawer__description${task.description ? '' : ' task-drawer__description--empty'}`}>
        {task.description || 'No description'}
      </p>
    </div>
  )
}

function TaskEditForm({ task, members }: { task: Task; members: Member[] }) {
  const update = useUpdateTask(task)
  const [saved, setSaved] = useState(false)
  const form = useForm<TaskField>({
    initialValues: taskFormValues(task),
    fields: TASK_FIELDS,
    validate: validateTask,
    onValidSubmit: (values, { resetTo }) => {
      const changes = taskChanges(task, values)
      if (Object.keys(changes).length === 0) return
      setSaved(false)
      update.mutate(changes, {
        onSuccess: (updated) => {
          resetTo(taskFormValues(updated))
          setSaved(true)
        },
      })
    },
  })

  const dirty = Object.keys(taskChanges(task, form.values)).length > 0
  const serverErrors = update.isError ? formErrorsFromError(update.error, { fields: TASK_FIELDS }) : null
  const errorFor = (field: TaskField) => form.errors[field] ?? serverErrors?.fields[field]
  const assigneeListed = !task.assignee || members.some((member) => member.user_id === task.assignee?.id)

  return (
    <form className="stack-form task-drawer__section" noValidate onSubmit={form.handleSubmit}>
      {serverErrors?.form ? (
        <div className="alert alert--error" role="alert">
          {serverErrors.form}
        </div>
      ) : null}
      <TextField
        {...form.register('title')}
        id="task-title"
        label="Title"
        type="text"
        autoComplete="off"
        required
        error={errorFor('title')}
      />
      <div className="task-drawer__grid">
        <SelectField
          id="task-status"
          label="Status"
          value={form.values.status}
          onChange={(event) => form.setValue('status', event.target.value)}
          error={errorFor('status')}
        >
          {TASK_STATUSES.map((status) => (
            <option key={status} value={status}>
              {STATUS_LABELS[status]}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="task-priority"
          label="Priority"
          value={form.values.priority}
          onChange={(event) => form.setValue('priority', event.target.value)}
          error={errorFor('priority')}
        >
          {TASK_PRIORITIES.map((priority) => (
            <option key={priority} value={priority}>
              {PRIORITY_LABELS[priority]}
            </option>
          ))}
        </SelectField>
        <SelectField
          id="task-assignee"
          label="Assignee"
          value={form.values.assignee_id}
          onChange={(event) => form.setValue('assignee_id', event.target.value)}
          error={errorFor('assignee_id')}
        >
          <option value="">Unassigned</option>
          {members.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.name}
            </option>
          ))}
          {assigneeListed || !task.assignee ? null : (
            <option value={task.assignee.id}>{task.assignee.name}</option>
          )}
        </SelectField>
        <div className="task-drawer__due">
          <TextField
            {...form.register('due_date')}
            id="task-due-date"
            label="Due date"
            type="date"
            error={errorFor('due_date')}
          />
          {form.values.due_date ? (
            <button type="button" className="button button--small" onClick={() => form.setValue('due_date', '')}>
              Clear due date
            </button>
          ) : null}
        </div>
      </div>
      <TextAreaField
        {...form.register('description')}
        id="task-description"
        label="Description"
        rows={6}
        hint="Leave empty for no description."
        error={errorFor('description')}
      />
      <div className="task-drawer__actions">
        {saved && !dirty ? (
          <p className="task-drawer__saved" role="status">
            Changes saved.
          </p>
        ) : null}
        <button type="submit" className="button button--primary" disabled={!dirty || update.isPending}>
          {update.isPending ? 'Saving...' : 'Save changes'}
        </button>
      </div>
    </form>
  )
}

function DeleteTask({ task, onDeleted }: { task: Task; onDeleted: () => void }) {
  const [confirming, setConfirming] = useState(false)
  const remove = useDeleteTask(task, { onDeleted })
  const questionId = useId()
  // Set on Cancel, so "Delete task" takes focus back once it is shown again.
  const focusDeleteButton = useRef(false)

  if (!confirming) {
    return (
      <div className="task-drawer__danger">
        <button
          ref={(element) => {
            if (element && focusDeleteButton.current) {
              focusDeleteButton.current = false
              element.focus()
            }
          }}
          type="button"
          className="button button--danger"
          onClick={() => setConfirming(true)}
        >
          Delete task
        </button>
      </div>
    )
  }

  return (
    <div className="task-drawer__danger task-drawer__confirm" role="group" aria-labelledby={questionId}>
      <p id={questionId}>
        <strong>Delete {task.key}?</strong> The task and its comments are removed. This cannot be undone.
      </p>
      {remove.isError ? (
        <div className="alert alert--error" role="alert">
          {remove.error.message}
        </div>
      ) : null}
      <div className="modal__actions">
        <button
          type="button"
          className="button"
          // The question just appeared in place of the button that asked it.
          autoFocus
          disabled={remove.isPending}
          onClick={() => {
            focusDeleteButton.current = true
            remove.reset()
            setConfirming(false)
          }}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button--danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate()}
        >
          {remove.isPending ? 'Deleting...' : 'Delete task'}
        </button>
      </div>
    </div>
  )
}
