import { describe, expect, it } from 'vitest'
import {
  filtersFromSearchParams,
  filtersToQuery,
  hasActiveFilters,
  NO_FILTERS,
  normalizeSearch,
  taskIdFromSearchParams,
  viewFromSearchParams,
  withFilters,
  withTask,
  withView,
  type TaskFilters,
} from './filters'

const BEN = '10000000-0000-4000-8000-000000000002'
const params = (search: string) => new URLSearchParams(search)

describe('filters in the URL', () => {
  it('reads every filter, in enum order and without duplicates', () => {
    expect(
      filtersFromSearchParams(
        params(`status=done&status=todo&status=done&priority=urgent&priority=low&assignee=${BEN}&due_before=2026-12-01&q=%20login%20`),
      ),
    ).toEqual({
      status: ['todo', 'done'],
      priority: ['low', 'urgent'],
      assignee: BEN,
      dueBefore: '2026-12-01',
      q: 'login',
    })
  })

  it('reads "none" as unassigned', () => {
    expect(filtersFromSearchParams(params('assignee=none')).assignee).toBe('none')
  })

  it('ignores values the API would reject', () => {
    expect(
      filtersFromSearchParams(params('status=open&priority=asap&assignee=ben&due_before=2026-02-30&q=%20%20')),
    ).toEqual(NO_FILTERS)
  })

  it('caps the search at 200 characters', () => {
    expect(normalizeSearch('x'.repeat(250))).toHaveLength(200)
    expect(normalizeSearch('   ')).toBeNull()
    expect(normalizeSearch(undefined)).toBeNull()
  })

  it('writes filters back, keeping the view and the open task', () => {
    const filters: TaskFilters = {
      status: ['in_review', 'todo'],
      priority: ['high'],
      assignee: 'none',
      dueBefore: '2026-12-24',
      q: ' fix ',
    }
    const written = withFilters(params('view=list&task=abc&status=done&q=old'), filters)
    expect(written.toString()).toBe(
      'view=list&task=abc&status=todo&status=in_review&priority=high&assignee=none&due_before=2026-12-24&q=fix',
    )
    expect(filtersFromSearchParams(written)).toEqual({ ...filters, status: ['todo', 'in_review'], q: 'fix' })
    expect(withFilters(written, NO_FILTERS).toString()).toBe('view=list&task=abc')
  })

  it('knows when a filter is on', () => {
    expect(hasActiveFilters(NO_FILTERS)).toBe(false)
    expect(hasActiveFilters({ ...NO_FILTERS, status: ['todo'] })).toBe(true)
    expect(hasActiveFilters({ ...NO_FILTERS, priority: ['low'] })).toBe(true)
    expect(hasActiveFilters({ ...NO_FILTERS, assignee: 'none' })).toBe(true)
    expect(hasActiveFilters({ ...NO_FILTERS, dueBefore: '2026-12-01' })).toBe(true)
    expect(hasActiveFilters({ ...NO_FILTERS, q: 'x' })).toBe(true)
  })
})

describe('filtersToQuery', () => {
  it('uses the contract names (assignee_id, due_before) and leaves out what is not set', () => {
    expect(
      filtersToQuery({ status: ['todo', 'done'], priority: [], assignee: 'none', dueBefore: null, q: 'login' }),
    ).toEqual({ status: ['todo', 'done'], priority: [], assignee_id: 'none', due_before: null, q: 'login' })
  })
})

describe('view and open task', () => {
  it('defaults to the board and only writes the list view', () => {
    expect(viewFromSearchParams(params(''))).toBe('board')
    expect(viewFromSearchParams(params('view=list'))).toBe('list')
    expect(viewFromSearchParams(params('view=grid'))).toBe('board')
    expect(withView(params('q=a'), 'list').toString()).toBe('q=a&view=list')
    expect(withView(params('q=a&view=list'), 'board').toString()).toBe('q=a')
  })

  it('opens and closes the drawer with ?task=', () => {
    expect(taskIdFromSearchParams(params(''))).toBeNull()
    expect(taskIdFromSearchParams(params('task=abc'))).toBe('abc')
    expect(withTask(params('q=a'), 'abc').toString()).toBe('q=a&task=abc')
    expect(withTask(params('q=a&task=abc'), null).toString()).toBe('q=a')
  })
})
