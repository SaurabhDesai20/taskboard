import type { ReactNode } from 'react'
import type { UUID } from '../../api/types'
import { StatusMessage } from '../../components/StatusMessage'
import { useNow } from '../../lib/useNow'
import { useOnVisible } from '../../lib/useOnVisible'
import type { ActivityFilters } from './api'
import { ActivityItem } from './ActivityItem'
import { useActivity } from './hooks'
import './activity.css'

interface ActivityFeedProps {
  workspaceId: UUID
  filters: ActivityFilters
  /** Accessible name of the list, e.g. "Activity in Acme". */
  label: string
  /** Shown instead of the list when nothing matches. */
  empty: ReactNode
  /** The workspace's slug, to link entries to their task or project; no links without it. */
  linkSlug?: string
}

/**
 * Activity entries, newest first, with loading, empty and error states. Older entries load as
 * the end of the list scrolls into view (infinite scroll), and with the "Load more" button,
 * which keyboard and screen reader users (and browsers without IntersectionObserver) can use.
 */
export function ActivityFeed({ workspaceId, filters, label, empty, linkSlug }: ActivityFeedProps) {
  const activity = useActivity(workspaceId, filters)
  const now = useNow()
  const { hasNextPage, isFetching, isFetchNextPageError, fetchNextPage } = activity
  // Not while any fetch runs (a refetch of the loaded pages included), nor after a failed page:
  // then the button retries.
  const sentinelRef = useOnVisible(() => void fetchNextPage(), hasNextPage && !isFetching && !isFetchNextPageError)

  if (activity.isPending) {
    return (
      <p className="activity-feed__note" role="status">
        Loading activity...
      </p>
    )
  }
  if (activity.isError && !activity.data) {
    return (
      <StatusMessage
        tone="error"
        action={
          <button type="button" className="button" onClick={() => void activity.refetch()}>
            Try again
          </button>
        }
      >
        Could not load the activity. {activity.error.message}
      </StatusMessage>
    )
  }
  if (activity.data.length === 0) return empty

  return (
    <div className="activity-feed" aria-busy={isFetching || undefined}>
      <ol className="activity-feed__list" aria-label={label}>
        {activity.data.map((entry) => (
          <ActivityItem key={entry.id} entry={entry} now={now} linkSlug={linkSlug} />
        ))}
      </ol>
      {hasNextPage ? (
        <div className="activity-feed__more">
          <div ref={sentinelRef} className="activity-feed__sentinel" aria-hidden="true" />
          {isFetchNextPageError ? (
            <p className="field__error" role="alert">
              Could not load older activity. {activity.error?.message}
            </p>
          ) : null}
          <button
            type="button"
            className="button button--small"
            disabled={activity.isFetchingNextPage}
            onClick={() => void fetchNextPage()}
          >
            {activity.isFetchingNextPage ? 'Loading more...' : 'Load more activity'}
          </button>
        </div>
      ) : (
        <p className="activity-feed__note activity-feed__end">No older activity.</p>
      )}
    </div>
  )
}
