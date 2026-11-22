import type { ReactNode } from 'react'
import type { Action } from '../../lib/permissions'
import { useCan } from './hooks'

interface CanProps {
  action: Action
  children: ReactNode
  /** Rendered instead when the role does not allow the action (default: nothing). */
  fallback?: ReactNode
}

/**
 * Renders `children` only when the user's role in the current workspace (from the `/w/:slug`
 * URL) allows `action`. Hides UI only: the backend still checks every request.
 */
export function Can({ action, children, fallback = null }: CanProps) {
  return <>{useCan(action) ? children : fallback}</>
}
