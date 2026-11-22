import { describe, expect, it } from 'vitest'
import type { ActivityPage, ActivityRead } from '../../api/types'
import { feedFiltersFromSearchParams, hasFeedFilters, withFeedFilters } from './filters'
import { flattenActivity, NO_ACTIVITY_FILTERS } from './hooks'

const PROJECT = '30000000-0000-4000-8000-000000000001'
const ACTOR = '10000000-0000-4000-8000-000000000002'

describe('feed filters in the URL', () => {
  it('reads project and actor ids, lowercased, and ignores anything else', () => {
    expect(feedFiltersFromSearchParams(new URLSearchParams(`project=${PROJECT.toUpperCase()}&actor=${ACTOR}`))).toEqual({
      projectId: PROJECT,
      taskId: null,
      actorId: ACTOR,
    })
    expect(feedFiltersFromSearchParams(new URLSearchParams('project=nope&actor=&task=x'))).toEqual(NO_ACTIVITY_FILTERS)
  })

  it('writes the filters and keeps other params; empty filters are left out', () => {
    const params = new URLSearchParams('project=old&other=1')
    expect(withFeedFilters(params, { ...NO_ACTIVITY_FILTERS, actorId: ACTOR }).toString()).toBe(`other=1&actor=${ACTOR}`)
    expect(withFeedFilters(params, { ...NO_ACTIVITY_FILTERS, projectId: PROJECT }).toString()).toBe(
      `project=${PROJECT}&other=1`,
    )
    // The input is not changed.
    expect(params.toString()).toBe('project=old&other=1')
  })

  it('knows when a filter is set', () => {
    expect(hasFeedFilters(NO_ACTIVITY_FILTERS)).toBe(false)
    expect(hasFeedFilters({ ...NO_ACTIVITY_FILTERS, actorId: ACTOR })).toBe(true)
    expect(hasFeedFilters({ ...NO_ACTIVITY_FILTERS, taskId: 't' })).toBe(true)
  })
})

describe('flattenActivity', () => {
  const entry = (id: string): ActivityRead => ({
    id,
    workspace_id: 'w',
    project_id: null,
    task_id: null,
    actor: { id: 'u', name: 'Asha Rao' },
    action: 'workspace.renamed',
    entity_type: 'workspace',
    entity_id: 'w',
    metadata: {},
    created_at: '2026-11-22T09:00:00Z',
  })
  const page = (ids: string[], nextCursor: string | null = null): ActivityPage => ({
    items: ids.map(entry),
    next_cursor: nextCursor,
  })

  it('joins the pages in order and lists an entry two pages brought only once', () => {
    expect(flattenActivity([page(['c', 'b'], 'cursor'), page(['b', 'a'])]).map((item) => item.id)).toEqual(['c', 'b', 'a'])
    expect(flattenActivity([])).toEqual([])
  })
})
