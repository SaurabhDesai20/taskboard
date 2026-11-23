import { forwardRef, type TextareaHTMLAttributes } from 'react'

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  id: string
  label: string
  /** Shown under the textarea and announced with it. */
  hint?: string
  /** Marks the textarea invalid and is announced with it. */
  error?: string
}

/** A labelled multi-line input; the textarea twin of `TextField`. */
export const TextAreaField = forwardRef<HTMLTextAreaElement, TextAreaFieldProps>(function TextAreaField(
  { id, label, hint, error, className, rows = 4, ...textareaProps },
  ref,
) {
  const hintId = `${id}-hint`
  const errorId = `${id}-error`
  const describedBy = [hint ? hintId : null, error ? errorId : null].filter(Boolean).join(' ')

  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <textarea
        {...textareaProps}
        ref={ref}
        id={id}
        rows={rows}
        className={['field__input', 'field__textarea', className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={describedBy || undefined}
      />
      {hint ? (
        <p id={hintId} className="field__hint">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} className="field__error">
          {error}
        </p>
      ) : null}
    </div>
  )
})
