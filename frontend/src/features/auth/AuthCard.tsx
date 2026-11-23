import { useId, type ReactNode } from 'react'
import './auth.css'

interface AuthCardProps {
  title: string
  /** Form-level error (e.g. "Invalid email or password"), announced when it appears. */
  formError: string | null
  footer: ReactNode
  children: ReactNode
}

/** The centered card shared by the login and register pages. */
export function AuthCard({ title, formError, footer, children }: AuthCardProps) {
  const titleId = useId()
  return (
    <section className="auth-card" aria-labelledby={titleId}>
      <h1 id={titleId} className="auth-card__title">
        {title}
      </h1>
      {formError ? (
        <div className="alert alert--error" role="alert">
          {formError}
        </div>
      ) : null}
      {children}
      <p className="auth-card__footer">{footer}</p>
    </section>
  )
}
