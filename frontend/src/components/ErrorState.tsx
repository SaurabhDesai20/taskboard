import { StatusMessage } from './StatusMessage'

interface ErrorStateProps {
  /** What failed, e.g. "Could not load the tasks." The server's message follows it. */
  message: string
  error?: unknown
  /** Shows "Try again". */
  onRetry?: () => void
  /** Small text and button, for narrow places (sidebar, menus). */
  compact?: boolean
}

/** A load error, announced at once, with the server's reason and "Try again". */
export function ErrorState({ message, error, onRetry, compact = false }: ErrorStateProps) {
  const reason = error instanceof Error && error.message ? ` ${error.message}` : ''
  return (
    <StatusMessage
      tone="error"
      compact={compact}
      action={
        onRetry ? (
          <button type="button" className={`button${compact ? ' button--small' : ''}`} onClick={onRetry}>
            Try again
          </button>
        ) : null
      }
    >
      {message}
      {reason}
    </StatusMessage>
  )
}
