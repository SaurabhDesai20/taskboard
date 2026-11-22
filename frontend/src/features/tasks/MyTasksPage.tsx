import { useId } from 'react'
import { Link, NavLink } from 'react-router'
import type { MyTask } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { ListSkeleton } from '../../components/Skeleton'
import { todayDateOnly } from '../../lib/dates'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { useMe } from '../auth/hooks'
import { DueDate } from './DueDate'
import { groupMyTasks, isOverdue, MY_TASK_GROUP_LABELS, MY_TASK_GROUPS, type MyTaskGroup } from './dueDates'
import { useMyTasks } from './hooks'
import { STATUS_LABELS } from './labels'
import { taskPath } from './paths'
import { PriorityBadge } from './PriorityBadge'
import './tasks.css'

/** The header link to My Tasks; only for signed-in users. */
export function MyTasksLink() {
  const me = useMe()
  if (!me.data) return null
  return (
    <NavLink to="/me/tasks" className="app-header__link">
      My tasks
    </NavLink>
  )
}

/**
 * `/me/tasks`: open tasks assigned to me in all my workspaces (archived projects left out by the
 * server), grouped Overdue / Due this week / Later / No due date. Each one links to its board
 * with the task's drawer open.
 */
export function MyTasksPage() {
  const query = useMyTasks()
  const today = todayDateOnly()
  useDocumentTitle('My tasks')

  let content
  if (query.isPending) {
    content = <ListSkeleton label="Loading your tasks..." rows={4} />
  } else if (query.isError) {
    content = <ErrorState message="Could not load your tasks." error={query.error} onRetry={() => void query.refetch()} />
  } else {
    const groups = groupMyTasks(query.data, today)
    const shown = MY_TASK_GROUPS.filter((group) => groups[group].length > 0)
    content =
      shown.length === 0 ? (
        <EmptyState title="Nothing assigned to you">Open tasks assigned to you in any workspace show up here.</EmptyState>
      ) : (
        shown.map((group) => <MyTaskSection key={group} group={group} tasks={groups[group]} today={today} />)
      )
  }

  return (
    <div className="page my-tasks">
      <div className="page-header">
        <h1>My tasks</h1>
      </div>
      <p className="my-tasks__intro">Open tasks assigned to you in all your workspaces, by due date.</p>
      {content}
    </div>
  )
}

function MyTaskSection({ group, tasks, today }: { group: MyTaskGroup; tasks: MyTask[]; today: string }) {
  const headingId = useId()
  return (
    <section className={`my-tasks__group my-tasks__group--${group}`} aria-labelledby={headingId}>
      <h2 className="my-tasks__heading">
        <span id={headingId}>{MY_TASK_GROUP_LABELS[group]}</span>
        <span className="board-column__count">
          {tasks.length}
          <span className="visually-hidden"> {tasks.length === 1 ? 'task' : 'tasks'}</span>
        </span>
      </h2>
      <ul className="my-tasks__list">
        {tasks.map((task) => (
          <MyTaskItem key={task.id} task={task} today={today} />
        ))}
      </ul>
    </section>
  )
}

interface MyTaskItemProps {
  task: MyTask
  today: string
  /** The title's heading level, one below the list's heading (default 3). */
  headingLevel?: 3 | 4
}

/** One of my tasks: key, title (opens it on its board, drawer open), where it lives, priority and due date. */
export function MyTaskItem({ task, today, headingLevel = 3 }: MyTaskItemProps) {
  const titleId = useId()
  const Title = `h${headingLevel}` as const
  return (
    <li>
      <article className="my-task" aria-labelledby={titleId}>
        <div className="my-task__main">
          <span className="task-card__key">{task.key}</span>
          <Title id={titleId} className="my-task__title">
            <Link to={taskPath(task.workspace.slug, task.project.id, task.id)}>{task.title}</Link>
          </Title>
        </div>
        <p className="my-task__context">
          {task.project.name} · {task.workspace.name} · {STATUS_LABELS[task.status]}
        </p>
        <div className="my-task__meta">
          <PriorityBadge priority={task.priority} />
          {task.due_date ? <DueDate date={task.due_date} overdue={isOverdue(task, today)} /> : null}
        </div>
      </article>
    </li>
  )
}
