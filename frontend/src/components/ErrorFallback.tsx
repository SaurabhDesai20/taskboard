import { useEffect, useId, useRef } from 'react'

interface ErrorFallbackProps {
  /** Renders the failed part again (in-app); the page itself stays loaded. */
  onRetry: () => void
}

/**
 * Shown instead of a page that crashed while rendering: a friendly message, "Try again" and
 * "Reload page". The heading takes focus, so keyboard and screen reader users land on it.
 */
export function ErrorFallback({ onRetry }: ErrorFallbackProps) {
  const titleId = useId()
  const headingRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  return (
    <section className="error-fallback" aria-labelledby={titleId}>
      <h1 id={titleId} ref={headingRef} tabIndex={-1}>
        Something went wrong
      </h1>
      <p>
        This page ran into an unexpected problem. Your work on other pages is not affected. Try again, or reload
        the page if it keeps happening.
      </p>
      <div className="error-fallback__actions">
        <button type="button" className="button button--primary" onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="button" onClick={() => window.location.reload()}>
          Reload page
        </button>
      </div>
      <p>
        {/* A plain link: it works even when the router itself is what failed. */}
        <a href="/">Go to the dashboard</a>
      </p>
    </section>
  )
}
