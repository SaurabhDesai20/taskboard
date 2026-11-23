import { useId, useState } from 'react'
import type { Role, Workspace } from '../../api/types'
import { TextField } from '../../components/TextField'
import { formErrorsFromError, type FieldErrors } from '../../lib/formErrors'
import { grantableRoles, ROLE_LABELS } from '../../lib/permissions'
import { useForm } from '../../lib/useForm'
import { isValidEmail } from '../../lib/validation'
import { useAddMember } from './hooks'

const EMAIL_FIELD = ['email'] as const
const SERVER_FIELDS = ['email', 'role'] as const

function validateEmail(values: { email: string }): FieldErrors<'email'> {
  const email = values.email.trim()
  if (!email) return { email: 'Enter an email address' }
  if (!isValidEmail(email)) return { email: 'Enter a valid email address' }
  return {}
}

/** Adds an existing TaskBoard user by email, with a role the current user may grant. */
export function AddMemberForm({ workspace }: { workspace: Workspace }) {
  const roles = grantableRoles(workspace.my_role)
  const [picked, setRole] = useState<Role>('member')
  // If my role was refreshed (e.g. demoted to admin), fall back to a role I may still grant.
  const role = roles.includes(picked) ? picked : 'member'
  const add = useAddMember(workspace.id)
  const form = useForm<'email'>({
    initialValues: { email: '' },
    fields: EMAIL_FIELD,
    validate: validateEmail,
    onValidSubmit: (values, { reset }) => add.mutate({ email: values.email.trim(), role }, { onSuccess: reset }),
  })
  const titleId = useId()
  const roleErrorId = useId()

  const serverErrors = add.isError
    ? formErrorsFromError(add.error, { fields: SERVER_FIELDS, reasonFields: { already_member: 'email' } })
    : null
  const roleError = serverErrors?.fields.role

  return (
    <form className="inline-form add-member" noValidate onSubmit={form.handleSubmit} aria-labelledby={titleId}>
      <h3 id={titleId} className="inline-form__title">
        Add a member
      </h3>
      {serverErrors?.form ? (
        <div className="alert alert--error" role="alert">
          {serverErrors.form}
        </div>
      ) : null}
      <div className="inline-form__row">
        <TextField
          {...form.register('email')}
          id="add-member-email"
          label="Email"
          type="email"
          autoComplete="off"
          required
          hint="The person needs a TaskBoard account."
          error={form.errors.email ?? serverErrors?.fields.email}
        />
        <div className="field">
          <label className="field__label" htmlFor="add-member-role">
            Role
          </label>
          <select
            id="add-member-role"
            className="field__input"
            value={role}
            onChange={(event) => setRole(event.target.value as Role)}
            aria-invalid={roleError ? true : undefined}
            aria-describedby={roleError ? roleErrorId : undefined}
          >
            {roles.map((option) => (
              <option key={option} value={option}>
                {ROLE_LABELS[option]}
              </option>
            ))}
          </select>
          {roleError ? (
            <p id={roleErrorId} className="field__error">
              {roleError}
            </p>
          ) : null}
        </div>
        <button type="submit" className="button button--primary" disabled={add.isPending}>
          {add.isPending ? 'Adding...' : 'Add member'}
        </button>
      </div>
      {add.isSuccess ? (
        <p className="notice" role="status">
          Added {add.data.name} as {ROLE_LABELS[add.data.role]}.
        </p>
      ) : null}
    </form>
  )
}
