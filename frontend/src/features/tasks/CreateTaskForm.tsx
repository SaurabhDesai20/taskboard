import { useId, useRef, useState, type KeyboardEvent } from 'react'
import type { Project, TaskStatus } from '../../api/types'
import { formErrorsFromError } from '../../lib/formErrors'
import { useForm } from '../../lib/useForm'
import { useCreateTask } from './hooks'
import { STATUS_LABELS } from './labels'
import { validateTaskTitle } from './validation'

const FIELDS = ['title'] as const

interface CreateTaskFormProps {
  project: Project
  status: TaskStatus
}

/**
 * "Add task" at the bottom of a column: opens a one-line form (title only, Enter submits) that
 * creates the task at the end of that column. It stays open for the next task; Escape or Cancel
 * closes it and puts focus back on "Add task".
 */
export function CreateTaskForm({ project, status }: CreateTaskFormProps) {
  const [open, setOpen] = useState(false)
  const create = useCreateTask(project)
  const inputId = useId()
  const errorId = useId()
  const inputRef = useRef<HTMLInputElement | null>(null)
  // Set when the form closes, so the "Add task" button takes focus once it is back.
  const focusAddButton = useRef(false)
  const columnLabel = STATUS_LABELS[status]

  const form = useForm<'title'>({
    initialValues: { title: '' },
    fields: FIELDS,
    validate: (values) => {
      const error = validateTaskTitle(values.title)
      return error ? { title: error } : {}
    },
    onValidSubmit: (values, { reset }) => {
      create.mutate(
        { title: values.title.trim(), status },
        {
          onSuccess: () => {
            reset()
            inputRef.current?.focus()
          },
        },
      )
    },
  })

  function close() {
    focusAddButton.current = true
    form.reset()
    create.reset()
    setOpen(false)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLFormElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      close()
    }
  }

  if (!open) {
    return (
      <button
        ref={(element) => {
          if (element && focusAddButton.current) {
            focusAddButton.current = false
            element.focus()
          }
        }}
        type="button"
        className="button button--small board-column__add"
        aria-label={`Add task to ${columnLabel}`}
        onClick={() => setOpen(true)}
      >
        + Add task
      </button>
    )
  }

  const serverErrors = create.isError ? formErrorsFromError(create.error, { fields: FIELDS }) : null
  const error = form.errors.title ?? serverErrors?.fields.title ?? serverErrors?.form ?? undefined
  const { ref: registerRef, ...titleProps } = form.register('title')

  return (
    <form className="create-task" noValidate onSubmit={form.handleSubmit} onKeyDown={handleKeyDown}>
      <label htmlFor={inputId} className="visually-hidden">
        Title of the new task in {columnLabel}
      </label>
      <input
        {...titleProps}
        ref={(element) => {
          registerRef(element)
          inputRef.current = element
        }}
        id={inputId}
        type="text"
        className="field__input create-task__input"
        placeholder="Task title"
        autoComplete="off"
        // Opening the form is a request to type the title.
        autoFocus
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p id={errorId} className="field__error" role="alert">
          {error}
        </p>
      ) : null}
      <div className="create-task__actions">
        <button type="submit" className="button button--small button--primary" disabled={create.isPending}>
          {create.isPending ? 'Adding...' : 'Add'}
        </button>
        <button type="button" className="button button--small" onClick={close}>
          Cancel
        </button>
      </div>
    </form>
  )
}
