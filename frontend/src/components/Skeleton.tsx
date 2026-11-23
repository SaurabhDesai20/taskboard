import type { ReactNode } from 'react'

interface SkeletonProps {
  /** CSS width, e.g. "60%" or "8rem" (default: the full width). */
  width?: string
  /** CSS height (default: one line of text). */
  height?: string
  /** A circle (avatars). */
  round?: boolean
  className?: string
}

/** A grey placeholder shape. Decorative: `LoadingSkeleton` says what is loading. */
export function Skeleton({ width, height, round = false, className }: SkeletonProps) {
  return (
    <span
      className={['skeleton', round ? 'skeleton--round' : null, className].filter(Boolean).join(' ')}
      style={{ width, height }}
    />
  )
}

interface LoadingSkeletonProps {
  /** What is loading, e.g. "Loading tasks...". Read by screen readers; not shown. */
  label: string
  /** Announce the label (role="status"). Off inside regions that announce on their own. */
  announce?: boolean
  className?: string
  /** The placeholder shapes, laid out like the content they stand for. */
  children: ReactNode
}

/**
 * Placeholder shapes shown while a view loads, laid out like the content to come so the page
 * does not jump. Screen readers get the label instead of the shapes. The shimmer stops for
 * people who prefer reduced motion.
 */
export function LoadingSkeleton({ label, announce = true, className, children }: LoadingSkeletonProps) {
  return (
    <div className={['loading-skeleton', className].filter(Boolean).join(' ')} role={announce ? 'status' : undefined}>
      <span className="visually-hidden">{label}</span>
      <div className="loading-skeleton__shapes" aria-hidden="true">
        {children}
      </div>
    </div>
  )
}

/** Placeholder cards in the shape of a card grid (workspaces, projects). */
export function CardGridSkeleton({ label, count = 3, className }: { label: string; count?: number; className?: string }) {
  return (
    <LoadingSkeleton label={label} className="card-grid-skeleton">
      <ul className={className}>
        {Array.from({ length: count }, (_, index) => (
          <li key={index} className="skeleton-card">
            <Skeleton width="55%" height="1.25rem" />
            <Skeleton width="85%" />
            <Skeleton width="35%" />
          </li>
        ))}
      </ul>
    </LoadingSkeleton>
  )
}

interface ListSkeletonProps {
  label: string
  rows?: number
  /** A round avatar at the start of each row (comments, activity). */
  avatar?: boolean
  announce?: boolean
}

/** Placeholder rows in the shape of a list (comments, activity, my tasks, members). */
export function ListSkeleton({ label, rows = 3, avatar = false, announce }: ListSkeletonProps) {
  return (
    <LoadingSkeleton label={label} announce={announce}>
      <ul className="skeleton-list">
        {Array.from({ length: rows }, (_, index) => (
          <li key={index} className="skeleton-list__row">
            {avatar ? <Skeleton round width="1.5rem" height="1.5rem" /> : null}
            <span className="skeleton-list__lines">
              <Skeleton width={index % 2 === 0 ? '70%' : '55%'} />
              <Skeleton width="30%" height="0.75rem" />
            </span>
          </li>
        ))}
      </ul>
    </LoadingSkeleton>
  )
}
