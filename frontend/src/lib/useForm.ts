// A minimal form-state hook: controlled text inputs, validation on submit, focus on the first
// invalid field. Server errors stay in the mutation (TanStack Query), not in this state.
import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import type { FieldErrors } from './formErrors'

interface UseFormOptions<F extends string> {
  initialValues: Record<F, string>
  /** Field order: decides which invalid field receives focus. */
  fields: readonly F[]
  validate: (values: Record<F, string>) => FieldErrors<F>
  /** Called with the current values when the form is submitted without client errors. */
  onValidSubmit: (values: Record<F, string>) => void
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
  const inputs = useRef<Partial<Record<F, HTMLInputElement | null>>>({})

  const errors: FieldErrors<F> = submitted ? validate(values) : {}

  function register(field: F) {
    return {
      name: field,
      value: values[field],
      ref: (element: HTMLInputElement | null) => {
        inputs.current[field] = element
      },
      onChange: (event: ChangeEvent<HTMLInputElement>) => {
        const { value } = event.target
        setValues((current) => ({ ...current, [field]: value }))
      },
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
    onValidSubmit(values)
  }

  return { values, errors, register, handleSubmit }
}
