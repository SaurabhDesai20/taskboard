import { useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react'
import type { Task, UserRef } from '../../api/types'
import { TextAreaField } from '../../components/TextAreaField'
import { formErrorsFromError } from '../../lib/formErrors'
import type { CommentAccess } from './access'
import { useCreateComment } from './hooks'
import { isSubmitShortcut } from './keyboard'
import { COMMENT_FIELDS, validateCommentBody } from './validation'

interface CommentComposerProps {
  task: Task
  /** The signed-in user, shown as the author of the comment while it is being posted. */
  author: UserRef | undefined
  access: CommentAccess
}

const SHORTCUT_HINT = 'Press Ctrl+Enter (Cmd+Enter on a Mac) to post.'

/**
 * Writes a new comment: Post or Ctrl/Cmd+Enter. Disabled, with the reason, for viewers and in
 * archived projects. The comment shows in the thread at once (optimistic add); if the server
 * refuses it, it leaves the thread, the error shows here and the text comes back to the box.
 */
export function CommentComposer({ task, author, access }: CommentComposerProps) {
  const create = useCreateComment(task, author)
  // The draft is local UI state, not server data.
  const [draft, setDraft] = useState('')
  const [submitted, setSubmitted] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fieldId = useId()
  const disabled = !access.canComment

  const clientError = submitted ? validateCommentBody(draft) : undefined
  const serverErrors =
    create.isError && !disabled ? formErrorsFromError(create.error, { fields: COMMENT_FIELDS }) : null

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled) return
    if (validateCommentBody(draft)) {
      setSubmitted(true)
      textareaRef.current?.focus()
      return
    }
    const body = draft.trim()
    setDraft('')
    setSubmitted(false)
    create.mutate(
      { body },
      // Give the text back unless the user has started another comment meanwhile.
      { onError: () => setDraft((current) => (current.trim() === '' ? body : current)) },
    )
  }

  function handleKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    if (isSubmitShortcut(event)) {
      event.preventDefault()
      event.currentTarget.form?.requestSubmit()
    }
  }

  return (
    <form className="comment-composer" noValidate onSubmit={handleSubmit}>
      {serverErrors?.form ? (
        <div className="alert alert--error" role="alert">
          Your comment was not posted. {serverErrors.form}
        </div>
      ) : null}
      <TextAreaField
        ref={textareaRef}
        id={`comment-new-${fieldId}`}
        label="Add a comment"
        rows={3}
        value={draft}
        disabled={disabled}
        placeholder={disabled ? undefined : 'Write a comment...'}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={handleKeyDown}
        hint={access.composerDisabledReason ?? SHORTCUT_HINT}
        error={disabled ? undefined : (clientError ?? serverErrors?.fields.body)}
      />
      <div className="comment-composer__actions">
        <button type="submit" className="button button--primary" disabled={disabled}>
          Post comment
        </button>
      </div>
    </form>
  )
}
