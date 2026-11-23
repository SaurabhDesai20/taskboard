import { Link, useLocation } from 'react-router'
import { TextField } from '../../components/TextField'
import { formErrorsFromError } from '../../lib/formErrors'
import { useForm } from '../../lib/useForm'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { AuthCard } from './AuthCard'
import { useLogin } from './hooks'
import { LOGIN_FIELDS, normalizeLogin, validateLogin, type LoginField } from './validation'

export function LoginPage() {
  useDocumentTitle('Log in')
  const location = useLocation()
  const login = useLogin()
  const form = useForm<LoginField>({
    initialValues: { email: '', password: '' },
    fields: LOGIN_FIELDS,
    validate: validateLogin,
    onValidSubmit: (values) => login.mutate(normalizeLogin(values)),
  })

  const serverErrors = login.isError
    ? formErrorsFromError(login.error, { fields: LOGIN_FIELDS })
    : null
  const errorFor = (field: LoginField) => form.errors[field] ?? serverErrors?.fields[field]

  return (
    <AuthCard
      title="Log in"
      formError={serverErrors?.form ?? null}
      footer={
        <>
          New to TaskBoard?{' '}
          {/* Carry the remembered target along, so registering also returns there. */}
          <Link to="/register" state={location.state}>
            Create an account
          </Link>
        </>
      }
    >
      <form className="auth-form" noValidate onSubmit={form.handleSubmit}>
        <TextField
          {...form.register('email')}
          id="login-email"
          label="Email"
          type="email"
          autoComplete="email"
          required
          error={errorFor('email')}
        />
        <TextField
          {...form.register('password')}
          id="login-password"
          label="Password"
          type="password"
          autoComplete="current-password"
          required
          error={errorFor('password')}
        />
        <button type="submit" className="button button--primary" disabled={login.isPending}>
          {login.isPending ? 'Logging in...' : 'Log in'}
        </button>
      </form>
    </AuthCard>
  )
}
