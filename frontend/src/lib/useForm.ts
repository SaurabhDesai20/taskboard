// A minimal form-state hook: controlled text inputs and textareas, validation on submit, focus on
// the first invalid field. Server errors stay in the mutation (TanStack Query), not in this state.
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { FieldErrors } from './formErrors'

type TextControl = HTMLInputElement | HTMLTextAreaElement

interface FormHelpers<F extends string> {
  /** Back to the initial values, with no errors shown (e.g. after a successful submit). */
  reset: () => void
  /** To new values (e.g. what the server saved), with no errors shown. */
  resetTo: (values: Record<F, string>) => void
}

interface UseFormOptions<F extends string> {
  initialValues: Record<F, string>
  /** Field order: decides which invalid field receives focus. */
  fields: readonly F[]
  validate: (values: Record<F, string>) => FieldErrors<F>
  /** Called with the current values when the form is submitted without client errors. */
  onValidSubmit: (values: Record<F, string>, helpers: FormHelpers<F>) => void
}

export function useForm<F extends string>({
  initialValues,
  fields,
  validate,
  onValidSubmit,
}: UseFormOptions<F>) {
  const [values, setValues] = useState(initialValues)
  // Errors appear only after the first submit, then follow the user's edits.
  const [submitted, setSubmitted] = useState(false)
  const inputs = useRef<Partial<Record<F, TextControl | null>>>({})
  // The first initial values: callers often pass a new object literal on every render.
  const [resetValues] = useState(initialValues)

  const errors: FieldErrors<F> = submitted ? validate(values) : {}

  function reset() {
    resetTo(resetValues)
  }

  function resetTo(next: Record<F, string>) {
    setValues(next)
    setSubmitted(false)
  }

  /** Sets one field from code (e.g. a value derived from another field). */
  function setValue(field: F, value: string) {
    setValues((current) => ({ ...current, [field]: value }))
  }

  function register(field: F) {
    return {
      name: field,
      value: values[field],
      ref: (element: TextControl | null) => {
        inputs.current[field] = element
      },
      onChange: (event: ChangeEvent<TextControl>) => setValue(field, event.target.value),
    }
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    setSubmitted(true)
    const submitErrors = validate(values)
    const firstInvalid = fields.find((field) => submitErrors[field])
    if (firstInvalid) {
      inputs.current[firstInvalid]?.focus()
      return
    }
    onValidSubmit(values, { reset, resetTo })
  }

  return { values, errors, register, setValue, handleSubmit, reset }
}
