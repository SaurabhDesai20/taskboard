import { useCallback, useId, useMemo, useRef } from 'react'
import { useSearchParams } from 'react-router'
import type { Project, UUID, Workspace } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ListSkeleton } from '../../components/Skeleton'
import { can } from '../../lib/permissions'
import { useMembers } from '../members/hooks'
import { useCurrentProject } from '../projects/hooks'
import {
  filtersFromSearchParams,
  hasActiveFilters,
  taskIdFromSearchParams,
  viewFromSearchParams,
  withFilters,
  withTask,
  withView,
  type BoardView,
  type TaskFilters,
} from './filters'
import { useProjectTasks } from './hooks'
import { BoardSkeleton, KanbanBoard } from './KanbanBoard'
import { TASK_STATUSES } from './labels'
import { TaskDrawer } from './TaskDrawer'
import { TaskFilterBar } from './TaskFilterBar'
import { TaskTable } from './TaskTable'
import './tasks.css'

/**
 * `/w/:slug/projects/:projectId` (index): the project's tasks as a Kanban board or a list, with
 * filters, and the detail drawer for `?task=<id>`. ProjectLayout has loaded the project.
 */
export function ProjectTasksPage() {
  const { workspace, project } = useCurrentProject()
  if (!workspace || !project) return null
  return <ProjectTasks workspace={workspace} project={project} />
}

const VIEWS: { view: BoardView; label: string }[] = [
  { view: 'board', label: 'Board' },
  { view: 'list', label: 'List' },
]

function ProjectTasks({ workspace, project }: { workspace: Workspace; project: Project }) {
  const headingId = useId()
  // Where focus goes after the open task is deleted (its card, the drawer's opener, is gone).
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = useMemo(() => filtersFromSearchParams(searchParams), [searchParams])
  const view = viewFromSearchParams(searchParams)
  const openTaskId = taskIdFromSearchParams(searchParams)
  const tasks = useProjectTasks(project, filters)
  const members = useMembers(workspace.id)

  const archived = project.archived_at !== null
  const canWrite = can(workspace.my_role, 'task.write') && !archived
  const canDelete = can(workspace.my_role, 'task.delete')
  const readOnlyReason = archived
    ? 'This project is archived, so its tasks are read-only.'
    : 'You have view-only access to this workspace.'
  const filtered = hasActiveFilters(filters)

  // Filters replace the history entry (no Back step per keystroke); views and the drawer push one.
  const changeFilters = useCallback(
    (next: TaskFilters) => setSearchParams((current) => withFilters(current, next), { replace: true }),
    [setSearchParams],
  )
  const hrefFor = useCallback((taskId: UUID) => `?${withTask(searchParams, taskId).toString()}`, [searchParams])
  const closeDrawer = useCallback(() => setSearchParams((current) => withTask(current, null)), [setSearchParams])

  const columns = filters.status.length > 0 ? filters.status : TASK_STATUSES

  let content
  if (tasks.isPending) {
    content = view === 'list' ? <ListSkeleton label="Loading tasks..." rows={5} /> : <BoardSkeleton statuses={columns} />
  } else if (tasks.isError && !tasks.data) {
    content = <ErrorState message="Could not load the tasks." error={tasks.error} onRetry={() => void tasks.refetch()} />
  } else if (view === 'list') {
    content =
      tasks.data.length === 0 ? (
        <EmptyState title={filtered ? 'No tasks match the filters' : 'No tasks yet'}>
          {filtered ? 'Change or clear the filters to see more.' : 'Switch to the board to add tasks.'}
        </EmptyState>
      ) : (
        <TaskTable tasks={tasks.data} hrefFor={hrefFor} />
      )
  } else {
    content = (
      <KanbanBoard
        project={project}
        tasks={tasks.data}
        statuses={columns}
        canWrite={canWrite}
        filtered={filtered}
        hrefFor={hrefFor}
      />
    )
  }

  return (
    <section className="tasks-page" aria-labelledby={headingId} aria-busy={tasks.isFetching || undefined}>
      <div className="section-header">
        <h2 id={headingId} ref={headingRef} tabIndex={-1}>
          Tasks
        </h2>
        <div className="view-toggle" role="group" aria-label="View">
          {VIEWS.map((option) => (
            <button
              key={option.view}
              type="button"
              className="view-toggle__button"
              aria-pressed={view === option.view}
              onClick={() => setSearchParams((current) => withView(current, option.view))}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>
      <TaskFilterBar filters={filters} members={members.data ?? []} onChange={changeFilters} />
      {content}
      {openTaskId ? (
        <TaskDrawer
          // A new task starts the drawer over (its form and delete confirmation).
          key={openTaskId}
          project={project}
          taskId={openTaskId}
          members={members.data ?? []}
          canWrite={canWrite}
          canDelete={canDelete}
          readOnlyReason={readOnlyReason}
          role={workspace.my_role}
          onClose={closeDrawer}
          afterDeleteFocusRef={headingRef}
        />
      ) : null}
    </section>
  )
}
