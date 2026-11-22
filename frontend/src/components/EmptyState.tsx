import type { ReactNode } from 'react'

interface EmptyStateProps {
  title: string
  /** A sentence on what would show here, or how to add the first item. */
  children?: ReactNode
  /** A call to action, e.g. a "Create" button. */
  action?: ReactNode
  /** Makes the title a heading of this level, where it fits the page outline; a paragraph otherwise. */
  headingLevel?: 2 | 3 | 4
}

/** "Nothing here yet": the same dashed box everywhere a list or view has no items. */
export function EmptyState({ title, children, action, headingLevel }: EmptyStateProps) {
  const Title = headingLevel ? (`h${headingLevel}` as const) : 'p'
  return (
    <div className="empty-state">
      <Title className="empty-state__title">{title}</Title>
      {typeof children === 'string' ? <p>{children}</p> : children}
      {action}
    </div>
  )
}
