import { useId } from 'react'
import { Link } from 'react-router'
import type { MyTask } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ListSkeleton } from '../../components/Skeleton'
import { todayDateOnly } from '../../lib/dates'
import { DUE_SOON_DAYS, groupMyTasks, type MyTaskGroup } from './dueDates'
import { useMyTasks } from './hooks'
import { MyTaskItem } from './MyTasksPage'
import './tasks.css'

/** Tasks listed per group before "See all"; the rest are on My Tasks. */
export const DASHBOARD_TASK_LIMIT = 5

interface DueGroupProps {
  title: string
  group: Extract<MyTaskGroup, 'overdue' | 'this_week'>
  tasks: MyTask[]
  today: string
  empty: string
}

function DueGroup({ title, group, tasks, today, empty }: DueGroupProps) {
  const headingId = useId()
  const shown = tasks.slice(0, DASHBOARD_TASK_LIMIT)
  const hidden = tasks.length - shown.length
  return (
    <section className={`due-group due-group--${group}`} aria-labelledby={headingId}>
      <h3 className="due-group__heading">
        <span id={headingId}>{title}</span>
        <span className="board-column__count">
          {tasks.length}
          <span className="visually-hidden"> {tasks.length === 1 ? 'task' : 'tasks'}</span>
        </span>
      </h3>
      {tasks.length === 0 ? (
        <EmptyState title={empty} />
      ) : (
        <ul className="my-tasks__list">
          {shown.map((task) => (
            <MyTaskItem key={task.id} task={task} today={today} headingLevel={4} />
          ))}
        </ul>
      )}
      {hidden > 0 ? (
        <Link to="/me/tasks" className="due-group__more">
          See {hidden} more in My tasks
        </Link>
      ) : null}
    </section>
  )
}

/**
 * The dashboard's "My tasks": my open tasks that are overdue or due this week (today and the
 * next six days), across all my workspaces. Each one opens on its board with the drawer open.
 * It shares its query (and cache) with the My Tasks page.
 */
export function MyDueTasks() {
  const query = useMyTasks()
  const today = todayDateOnly()
  const titleId = useId()

  let content
  if (query.isPending) {
    content = <ListSkeleton label="Loading your tasks..." rows={3} />
  } else if (query.isError) {
    content = <ErrorState message="Could not load your tasks." error={query.error} onRetry={() => void query.refetch()} />
  } else {
    const groups = groupMyTasks(query.data, today)
    content = (
      <div className="due-groups">
        <DueGroup title="Overdue" group="overdue" tasks={groups.overdue} today={today} empty="Nothing overdue" />
        <DueGroup
          title="Due this week"
          group="this_week"
          tasks={groups.this_week}
          today={today}
          empty={`Nothing due in the next ${DUE_SOON_DAYS} days`}
        />
      </div>
    )
  }

  return (
    <section className="dashboard__section" aria-labelledby={titleId}>
      <div className="section-header">
        <h2 id={titleId}>My tasks</h2>
        <Link to="/me/tasks">All my tasks</Link>
      </div>
      {content}
    </section>
  )
}
