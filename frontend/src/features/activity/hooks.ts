// TanStack Query hooks for the activity log (contract 3.8). Every feed (the workspace's, a
// filtered one, a task's) is an infinite query under `workspaceKeys.activity`, so one
// `refreshActivity(queryClient, workspaceId)` after a mutation refetches all of them, and
// refreshAfterConflict / forgetWorkspace cover them too.
import { useInfiniteQuery, type InfiniteData } from '@tanstack/react-query'
import type { ActivityPage, ActivityRead, UUID } from '../../api/types'
import { workspaceKeys } from '../workspaces/hooks'
import { activityApi, type ActivityFilters } from './api'

/** Entries per page (the contract's default, sent explicitly). */
export const ACTIVITY_PAGE_SIZE = 20

export const NO_ACTIVITY_FILTERS: ActivityFilters = { projectId: null, taskId: null, actorId: null }

export const activityKeys = {
  /** Every feed of one workspace. */
  all: (workspaceId: UUID) => workspaceKeys.activity(workspaceId),
  feed: (workspaceId: UUID, filters: ActivityFilters) => [...activityKeys.all(workspaceId), filters] as const,
}

type ActivityPages = InfiniteData<ActivityPage, string | null>

/**
 * Every loaded entry, newest first. An entry is listed once even if two pages bring it (when the
 * feed refetches page by page while new entries arrive).
 */
export function flattenActivity(pages: readonly ActivityPage[]): ActivityRead[] {
  const seen = new Set<UUID>()
  const entries: ActivityRead[] = []
  for (const page of pages) {
    for (const entry of page.items) {
      if (seen.has(entry.id)) continue
      seen.add(entry.id)
      entries.push(entry)
    }
  }
  return entries
}

const selectEntries = (data: ActivityPages) => flattenActivity(data.pages)

/**
 * A workspace's activity matching `filters`, newest first, one page at a time: `fetchNextPage`
 * loads older entries.
 */
export function useActivity(workspaceId: UUID, filters: ActivityFilters = NO_ACTIVITY_FILTERS) {
  return useInfiniteQuery({
    queryKey: activityKeys.feed(workspaceId, filters),
    queryFn: ({ pageParam, signal }) =>
      activityApi.list(workspaceId, filters, { cursor: pageParam, limit: ACTIVITY_PAGE_SIZE }, signal),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    select: selectEntries,
  })
}
