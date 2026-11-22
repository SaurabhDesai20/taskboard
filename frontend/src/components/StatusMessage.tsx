import type { ReactNode } from 'react'

interface StatusMessageProps {
  children: ReactNode
  /** `error` is announced immediately (role="alert"); `info` politely (role="status"). */
  tone?: 'info' | 'error'
  action?: ReactNode
  /** Small and left-aligned, for narrow places (sidebar, menus). */
  compact?: boolean
}

/** A centered loading / error message for whole-page states. */
export function StatusMessage({ children, tone = 'info', action, compact = false }: StatusMessageProps) {
  return (
    <div
      className={`status-message status-message--${tone}${compact ? ' status-message--compact' : ''}`}
      role={tone === 'error' ? 'alert' : 'status'}
    >
      <p>{children}</p>
      {action}
    </div>
  )
}
