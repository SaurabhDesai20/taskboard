import { Link, useLocation } from 'react-router'
import { TextField } from '../../components/TextField'
import { formErrorsFromError } from '../../lib/formErrors'
import { useForm } from '../../lib/useForm'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { AuthCard } from './AuthCard'
import { useRegister } from './hooks'
import {
  normalizeRegister,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  REGISTER_FIELDS,
  validateRegister,
  type RegisterField,
} from './validation'

export function RegisterPage() {
  useDocumentTitle('Create an account')
  const location = useLocation()
  const registerUser = useRegister()
  const form = useForm<RegisterField>({
    initialValues: { name: '', email: '', password: '' },
    fields: REGISTER_FIELDS,
    validate: validateRegister,
    onValidSubmit: (values) => registerUser.mutate(normalizeRegister(values)),
  })

  const serverErrors = registerUser.isError
    ? formErrorsFromError(registerUser.error, {
        fields: REGISTER_FIELDS,
        reasonFields: { email_taken: 'email' },
      })
    : null
  const errorFor = (field: RegisterField) => form.errors[field] ?? serverErrors?.fields[field]

  return (
    <AuthCard
      title="Create an account"
      formError={serverErrors?.form ?? null}
      footer={
        <>
          Already have an account?{' '}
          <Link to="/login" state={location.state}>
            Log in
          </Link>
        </>
      }
    >
      <form className="auth-form" noValidate onSubmit={form.handleSubmit}>
        <TextField
          {...form.register('name')}
          id="register-name"
          label="Name"
          type="text"
          autoComplete="name"
          required
          error={errorFor('name')}
        />
        <TextField
          {...form.register('email')}
          id="register-email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          error={errorFor('email')}
        />
        <TextField
          {...form.register('password')}
          id="register-password"
          label="Password"
          type="password"
          autoComplete="new-password"
          required
          hint={`${PASSWORD_MIN_LENGTH} to ${PASSWORD_MAX_LENGTH} characters.`}
          error={errorFor('password')}
        />
        <button type="submit" className="button button--primary" disabled={registerUser.isPending}>
          {registerUser.isPending ? 'Creating account...' : 'Create account'}
        </button>
      </form>
    </AuthCard>
  )
}
