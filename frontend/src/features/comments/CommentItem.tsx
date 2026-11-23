import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { CommentRead, Task } from '../../api/types'
import { Avatar } from '../../components/Avatar'
import { RelativeTime } from '../../components/RelativeTime'
import { TextAreaField } from '../../components/TextAreaField'
import { formatDateTime } from '../../lib/dates'
import { formErrorsFromError } from '../../lib/formErrors'
import { isPendingComment, useDeleteComment, useUpdateComment } from './hooks'
import { isSubmitShortcut } from './keyboard'
import { COMMENT_FIELDS, validateCommentBody } from './validation'

interface CommentItemProps {
  comment: CommentRead
  task: Task
  /** The thread's clock, for "5 minutes ago". */
  now: Date
  /** Author with member role or above, in an active project. */
  canEdit: boolean
  /** Author with member role or above, or any owner or admin. */
  canDelete: boolean
  /** After this comment is deleted (its row, and the focus in it, are gone). */
  onDeleted: () => void
}

type Mode = 'view' | 'edit' | 'confirm-delete'

/**
 * One comment: author, time (exact time as a tooltip), "(edited)", the body as plain text with
 * its line breaks, and Edit / Delete when allowed. A comment still being posted says so and has
 * no actions yet.
 */
export function CommentItem({ comment, task, now, canEdit, canDelete, onDeleted }: CommentItemProps) {
  const pending = isPendingComment(comment)
  const [mode, setMode] = useState<Mode>('view')
  // Which button gets focus back when the edit form or the delete question closes.
  const focusOnReturn = useRef<'edit' | 'delete' | null>(null)
  const focusIfReturning = (target: 'edit' | 'delete') => (element: HTMLButtonElement | null) => {
    if (element && focusOnReturn.current === target) {
      focusOnReturn.current = null
      element.focus()
    }
  }
  const backToView = (focus: 'edit' | 'delete') => {
    focusOnReturn.current = focus
    setMode('view')
  }

  return (
    <li className={`comment${pending ? ' comment--pending' : ''}`}>
      <article className="comment__inner" aria-label={`Comment by ${comment.author.name}`}>
        <Avatar name={comment.author.name} size="small" />
        <div className="comment__main">
          <p className="comment__meta">
            <span className="comment__author">{comment.author.name}</span>
            <RelativeTime timestamp={comment.created_at} now={now} />
            {comment.edited_at ? (
              <span className="comment__edited" title={`Edited ${formatDateTime(comment.edited_at)}`}>
                (edited)
              </span>
            ) : null}
            {pending ? <span className="comment__pending">Posting...</span> : null}
          </p>
          {mode === 'edit' ? (
            <CommentEditForm comment={comment} task={task} onDone={() => backToView('edit')} />
          ) : (
            <p className="comment__body">{comment.body}</p>
          )}
          {mode === 'confirm-delete' ? (
            <DeleteQuestion comment={comment} task={task} onCancel={() => backToView('delete')} onDeleted={onDeleted} />
          ) : null}
          {mode === 'view' && !pending && (canEdit || canDelete) ? (
            <div className="comment__actions">
              {canEdit ? (
                <button
                  ref={focusIfReturning('edit')}
                  type="button"
                  className="comment__action"
                  onClick={() => setMode('edit')}
                >
                  Edit
                </button>
              ) : null}
              {canDelete ? (
                <button
                  ref={focusIfReturning('delete')}
                  type="button"
                  className="comment__action comment__action--danger"
                  onClick={() => setMode('confirm-delete')}
                >
                  Delete
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
      </article>
    </li>
  )
}

interface CommentEditFormProps {
  comment: CommentRead
  task: Task
  /** Saved, unchanged or cancelled. */
  onDone: () => void
}

/** Inline edit: Ctrl/Cmd+Enter or Save saves, Escape or Cancel goes back (the drawer stays open). */
function CommentEditForm({ comment, task, onDone }: CommentEditFormProps) {
  const update = useUpdateComment(task)
  // The draft is local UI state; the comment itself stays in the query cache.
  const [draft, setDraft] = useState(comment.body)
  const [submitted, setSubmitted] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fieldId = useId()

  useEffect(() => {
    const textarea = textareaRef.current
    if (!textarea) return
    textarea.focus()
    textarea.setSelectionRange(textarea.value.length, textarea.value.length)
  }, [])

  const clientError = submitted ? validateCommentBody(draft) : undefined
  const serverErrors = update.isError ? formErrorsFromError(update.error, { fields: COMMENT_FIELDS }) : null

  function cancel() {
    if (!update.isPending) onDone()
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (update.isPending) return
    setSubmitted(true)
    if (validateCommentBody(draft)) {
      textareaRef.current?.focus()
      return
    }
    const body = draft.trim()
    if (body === comment.body) {
      onDone()
      return
    }
    update.mutate({ commentId: comment.id, body }, { onSuccess: onDone })
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (event.key === 'Escape') {
      // Leaves the edit, not the drawer.
      event.stopPropagation()
      cancel()
    } else if (isSubmitShortcut(event)) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form className="comment__edit" noValidate onSubmit={handleSubmit}>
      {serverErrors?.form ? (
        <div className="alert alert--error" role="alert">
          {serverErrors.form}
        </div>
      ) : null}
      <TextAreaField
        ref={textareaRef}
        id={`comment-edit-${fieldId}`}
        label="Edit comment"
        rows={3}
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        error={clientError ?? serverErrors?.fields.body}
      />
      <div className="comment__edit-actions">
        <button type="button" className="button button--small" disabled={update.isPending} onClick={cancel}>
          Cancel
        </button>
        <button type="submit" className="button button--small button--primary" disabled={update.isPending}>
          {update.isPending ? 'Saving...' : 'Save'}
        </button>
      </div>
    </form>
  )
}

interface DeleteQuestionProps {
  comment: CommentRead
  task: Task
  onCancel: () => void
  onDeleted: () => void
}

function DeleteQuestion({ comment, task, onCancel, onDeleted }: DeleteQuestionProps) {
  const remove = useDeleteComment(task, { onDeleted })
  const questionId = useId()

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape') return
    // Answers the question with "Cancel" instead of closing the drawer.
    event.stopPropagation()
    if (!remove.isPending) onCancel()
  }

  return (
    // Listens for Escape bubbling up from its buttons.
    <div className="comment__confirm" role="group" aria-labelledby={questionId} onKeyDown={handleKeyDown}>
      <p id={questionId}>
        <strong>Delete this comment?</strong> This cannot be undone.
      </p>
      {remove.isError ? (
        <div className="alert alert--error" role="alert">
          {remove.error.message}
        </div>
      ) : null}
      <div className="comment__edit-actions">
        <button
          type="button"
          className="button button--small"
          // The question just appeared in place of the button that asked it.
          autoFocus
          disabled={remove.isPending}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="button button--small button--danger"
          disabled={remove.isPending}
          onClick={() => remove.mutate(comment.id)}
        >
          {remove.isPending ? 'Deleting...' : 'Delete comment'}
        </button>
      </div>
    </div>
  )
}
