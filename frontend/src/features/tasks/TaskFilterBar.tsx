import { useEffect, useId, useState } from 'react'
import type { Member, TaskPriority, TaskStatus } from '../../api/types'
import {
  hasActiveFilters,
  NO_FILTERS,
  normalizeSearch,
  SEARCH_MAX_LENGTH,
  UNASSIGNED,
  type TaskFilters,
} from './filters'
import { PRIORITY_LABELS, STATUS_LABELS, TASK_PRIORITIES, TASK_STATUSES } from './labels'

/** How long typing pauses before the search is applied. */
export const SEARCH_DEBOUNCE_MS = 300

interface TaskFilterBarProps {
  /** The filters in the URL. */
  filters: TaskFilters
  /** The workspace's members, for the assignee filter (empty while they load). */
  members: Member[]
  onChange: (filters: TaskFilters) => void
}

function toggle<T>(values: readonly T[], value: T): T[] {
  return values.includes(value) ? values.filter((item) => item !== value) : [...values, value]
}

/**
 * Status, priority, assignee, due-before and text filters. They live in the URL (the parent
 * writes them there), so a filtered view survives a refresh. The search box applies what is
 * typed after a short pause.
 */
export function TaskFilterBar({ filters, members, onChange }: TaskFilterBarProps) {
  const ids = { search: useId(), assignee: useId(), due: useId() }
  // What is typed in the search box, applied after a pause. Follows the URL when it changes
  // from elsewhere (Clear filters, back and forward), without undoing a trailing space.
  const [draft, setDraft] = useState(filters.q ?? '')
  const [urlQ, setUrlQ] = useState(filters.q)
  if (filters.q !== urlQ) {
    setUrlQ(filters.q)
    if (normalizeSearch(draft) !== filters.q) setDraft(filters.q ?? '')
  }

  useEffect(() => {
    const q = normalizeSearch(draft)
    if (q === filters.q) return undefined
    const timer = window.setTimeout(() => onChange({ ...filters, q }), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [draft, filters, onChange])

  const assigneeKnown =
    filters.assignee === null ||
    filters.assignee === UNASSIGNED ||
    members.some((member) => member.user_id === filters.assignee)

  return (
    <form className="filter-bar" role="search" aria-label="Filter tasks" onSubmit={(event) => event.preventDefault()}>
      <div className="field filter-bar__search">
        <label className="field__label" htmlFor={ids.search}>
          Search
        </label>
        <input
          id={ids.search}
          type="search"
          className="field__input"
          placeholder="Title or description"
          value={draft}
          maxLength={SEARCH_MAX_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
        />
      </div>
      <fieldset className="filter-bar__group">
        <legend className="field__label">Status</legend>
        {TASK_STATUSES.map((status: TaskStatus) => (
          <label key={status} className="checkbox">
            <input
              type="checkbox"
              checked={filters.status.includes(status)}
              onChange={() => onChange({ ...filters, status: toggle(filters.status, status) })}
            />
            {STATUS_LABELS[status]}
          </label>
        ))}
      </fieldset>
      <fieldset className="filter-bar__group">
        <legend className="field__label">Priority</legend>
        {TASK_PRIORITIES.map((priority: TaskPriority) => (
          <label key={priority} className="checkbox">
            <input
              type="checkbox"
              checked={filters.priority.includes(priority)}
              onChange={() => onChange({ ...filters, priority: toggle(filters.priority, priority) })}
            />
            {PRIORITY_LABELS[priority]}
          </label>
        ))}
      </fieldset>
      <div className="field">
        <label className="field__label" htmlFor={ids.assignee}>
          Assignee
        </label>
        <select
          id={ids.assignee}
          className="field__input"
          value={filters.assignee ?? ''}
          onChange={(event) => onChange({ ...filters, assignee: event.target.value || null })}
        >
          <option value="">Anyone</option>
          <option value={UNASSIGNED}>Unassigned</option>
          {members.map((member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.name}
            </option>
          ))}
          {assigneeKnown ? null : <option value={filters.assignee ?? ''}>Someone else</option>}
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.due}>
          Due on or before
        </label>
        <input
          id={ids.due}
          type="date"
          className="field__input"
          value={filters.dueBefore ?? ''}
          onChange={(event) => onChange({ ...filters, dueBefore: event.target.value || null })}
        />
      </div>
      {hasActiveFilters(filters) ? (
        <button
          type="button"
          className="button button--small filter-bar__clear"
          onClick={() => {
            setDraft('')
            onChange(NO_FILTERS)
          }}
        >
          Clear filters
        </button>
      ) : null}
    </form>
  )
}
