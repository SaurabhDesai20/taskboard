import { useCallback, useId, useMemo } from 'react'
import { useSearchParams } from 'react-router'
import type { Member, Project, Workspace } from '../../api/types'
import { useMembers } from '../members/hooks'
import { useProjects } from '../projects/hooks'
import { useCurrentWorkspace } from '../workspaces/hooks'
import type { ActivityFilters } from './api'
import { ActivityFeed } from './ActivityFeed'
import { feedFiltersFromSearchParams, hasFeedFilters, withFeedFilters } from './filters'
import { NO_ACTIVITY_FILTERS } from './hooks'

/** `/w/:slug/activity`: everything that happened in the workspace, newest first. */
export function WorkspaceActivityPage() {
  const { workspace } = useCurrentWorkspace()
  if (!workspace) return null
  return <WorkspaceActivity workspace={workspace} />
}

function WorkspaceActivity({ workspace }: { workspace: Workspace }) {
  const headingId = useId()
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => feedFiltersFromSearchParams(searchParams), [searchParams])
  const filtered = hasFeedFilters(filters)
  // Filters replace the history entry, like the board's.
  const changeFilters = useCallback(
    (next: ActivityFilters) => setSearchParams((current) => withFeedFilters(current, next), { replace: true }),
    [setSearchParams],
  )

  return (
    <section className="activity-page" aria-labelledby={headingId}>
      <div className="section-header">
        <h2 id={headingId}>Activity</h2>
      </div>
      <ActivityFilterBar workspace={workspace} filters={filters} onChange={changeFilters} />
      <ActivityFeed
        workspaceId={workspace.id}
        filters={filters}
        label={`Activity in ${workspace.name}`}
        linkSlug={workspace.slug}
        empty={
          <div className="empty-state">
            <p className="empty-state__title">{filtered ? 'No activity matches the filters' : 'No activity yet'}</p>
            <p>
              {filtered
                ? 'Choose another project or person, or clear the filters.'
                : 'Changes to projects, tasks, comments and members show up here.'}
            </p>
          </div>
        }
      />
    </section>
  )
}

interface ActivityFilterBarProps {
  workspace: Workspace
  filters: ActivityFilters
  onChange: (filters: ActivityFilters) => void
}

/**
 * Project (archived ones included) and person filters. They live in the URL; an id there that
 * is not in the lists (a former member, say) still shows as selected.
 */
function ActivityFilterBar({ workspace, filters, onChange }: ActivityFilterBarProps) {
  const ids = { project: useId(), actor: useId() }
  const projects = useProjects(workspace.id, { includeArchived: true })
  const members = useMembers(workspace.id)

  return (
    <form
      className="activity-filters"
      role="search"
      aria-label="Filter activity"
      onSubmit={(event) => event.preventDefault()}
    >
      <div className="field">
        <label className="field__label" htmlFor={ids.project}>
          Project
        </label>
        <select
          id={ids.project}
          className="field__input"
          value={filters.projectId ?? ''}
          onChange={(event) => onChange({ ...filters, projectId: event.target.value || null })}
        >
          <option value="">All projects</option>
          {(projects.data ?? []).map((project: Project) => (
            <option key={project.id} value={project.id}>
              {project.archived_at ? `${project.name} (archived)` : project.name}
            </option>
          ))}
          <UnlistedOption
            value={filters.projectId}
            listed={projects.data?.some((project) => project.id === filters.projectId)}
            label={projects.isPending ? 'Loading projects...' : 'Unknown project'}
          />
        </select>
      </div>
      <div className="field">
        <label className="field__label" htmlFor={ids.actor}>
          Person
        </label>
        <select
          id={ids.actor}
          className="field__input"
          value={filters.actorId ?? ''}
          onChange={(event) => onChange({ ...filters, actorId: event.target.value || null })}
        >
          <option value="">Anyone</option>
          {(members.data ?? []).map((member: Member) => (
            <option key={member.user_id} value={member.user_id}>
              {member.name}
            </option>
          ))}
          <UnlistedOption
            value={filters.actorId}
            listed={members.data?.some((member) => member.user_id === filters.actorId)}
            label={members.isPending ? 'Loading people...' : 'Someone else'}
          />
        </select>
      </div>
      {hasFeedFilters(filters) ? (
        <button
          type="button"
          className="button button--small activity-filters__clear"
          onClick={() => onChange(NO_ACTIVITY_FILTERS)}
        >
          Clear filters
        </button>
      ) : null}
    </form>
  )
}

/** Keeps a selected id from the URL showing when it is not (or not yet) one of the options. */
function UnlistedOption({ value, listed, label }: { value: string | null; listed: boolean | undefined; label: string }) {
  if (!value || listed) return null
  return <option value={value}>{label}</option>
}
