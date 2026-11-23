import type { ReactNode, SelectHTMLAttributes } from 'react'

interface SelectFieldProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'id'> {
  id: string
  label: string
  /** Marks the select invalid and is announced with it. */
  error?: string
  /** The `<option>` elements. */
  children: ReactNode
}

/** A labelled `<select>` with an optional error; the select twin of `TextField`. */
export function SelectField({ id, label, error, className, children, ...selectProps }: SelectFieldProps) {
  const errorId = `${id}-error`
  return (
    <div className="field">
      <label className="field__label" htmlFor={id}>
        {label}
      </label>
      <select
        {...selectProps}
        id={id}
        className={['field__input', className].filter(Boolean).join(' ')}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      >
        {children}
      </select>
      {error ? (
        <p id={errorId} className="field__error">
          {error}
        </p>
      ) : null}
    </div>
  )
}
