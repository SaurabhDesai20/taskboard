// The activity page's filters live in the URL, so a filtered feed survives a refresh and can be
// shared: /w/:slug/activity?project=<uuid>&actor=<uuid>. They go to the API as `project_id` and
// `actor_id` (contract 3.8).
import type { UUID } from '../../api/types'
import type { ActivityFilters } from './api'
import { NO_ACTIVITY_FILTERS } from './hooks'

export const FEED_FILTER_PARAMS = { project: 'project', actor: 'actor' } as const

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** A UUID param, lowercased, or null; anything else is ignored rather than sent (it would 422). */
function readId(params: URLSearchParams, name: string): UUID | null {
  const value = params.get(name)
  return value && UUID_PATTERN.test(value) ? value.toLowerCase() : null
}

/** The feed's filters in a URL. */
export function feedFiltersFromSearchParams(params: URLSearchParams): ActivityFilters {
  return {
    ...NO_ACTIVITY_FILTERS,
    projectId: readId(params, FEED_FILTER_PARAMS.project),
    actorId: readId(params, FEED_FILTER_PARAMS.actor),
  }
}

/** A copy of `params` with the feed's filters written in (an empty one is left out). */
export function withFeedFilters(params: URLSearchParams, filters: ActivityFilters): URLSearchParams {
  const next = new URLSearchParams(params)
  const write = (name: string, value: UUID | null) => (value ? next.set(name, value) : next.delete(name))
  write(FEED_FILTER_PARAMS.project, filters.projectId)
  write(FEED_FILTER_PARAMS.actor, filters.actorId)
  return next
}

export function hasFeedFilters(filters: ActivityFilters): boolean {
  return filters.projectId !== null || filters.actorId !== null || filters.taskId !== null
}
