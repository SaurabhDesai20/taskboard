import { useId } from 'react'
import { Link, NavLink } from 'react-router'
import type { MyTask } from '../../api/types'
import { StatusMessage } from '../../components/StatusMessage'
import { todayDateOnly } from '../../lib/dates'
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

  let content
  if (query.isPending) {
    content = <StatusMessage>Loading your tasks...</StatusMessage>
  } else if (query.isError) {
    content = (
      <StatusMessage
        tone="error"
        action={
          <button type="button" className="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        }
      >
        Could not load your tasks. {query.error.message}
      </StatusMessage>
    )
  } else {
    const groups = groupMyTasks(query.data, today)
    const shown = MY_TASK_GROUPS.filter((group) => groups[group].length > 0)
    content =
      shown.length === 0 ? (
        <div className="empty-state">
          <p className="empty-state__title">Nothing assigned to you</p>
          <p>Open tasks assigned to you in any workspace show up here.</p>
        </div>
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

function MyTaskItem({ task, today }: { task: MyTask; today: string }) {
  const titleId = useId()
  return (
    <li>
      <article className="my-task" aria-labelledby={titleId}>
        <div className="my-task__main">
          <span className="task-card__key">{task.key}</span>
          <h3 id={titleId} className="my-task__title">
            <Link to={taskPath(task.workspace.slug, task.project.id, task.id)}>{task.title}</Link>
          </h3>
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
