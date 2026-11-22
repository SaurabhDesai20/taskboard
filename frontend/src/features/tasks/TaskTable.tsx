import { Link } from 'react-router'
import type { Task, UUID } from '../../api/types'
import { todayDateOnly } from '../../lib/dates'
import { DueDate } from './DueDate'
import { isOverdue } from './dueDates'
import { STATUS_LABELS } from './labels'
import { PriorityBadge } from './PriorityBadge'
import { TaskAssignee } from './TaskAssignee'

interface TaskTableProps {
  /** The (filtered) tasks, in the server's order: status, then position. */
  tasks: Task[]
  hrefFor: (taskId: UUID) => string
}

/** The list view: the same tasks as the board, one row each. Titles open the drawer. */
export function TaskTable({ tasks, hrefFor }: TaskTableProps) {
  const today = todayDateOnly()
  return (
    <div className="task-table__wrapper">
      <table className="task-table">
        <caption className="visually-hidden">Tasks</caption>
        <thead>
          <tr>
            <th scope="col">Key</th>
            <th scope="col">Title</th>
            <th scope="col">Status</th>
            <th scope="col">Priority</th>
            <th scope="col">Assignee</th>
            <th scope="col">Due</th>
            <th scope="col">Comments</th>
          </tr>
        </thead>
        <tbody>
          {tasks.map((task) => (
            <tr key={task.id} className={isOverdue(task, today) ? 'task-table__row--overdue' : undefined}>
              <td className="task-table__key">{task.key}</td>
              <td>
                <Link to={hrefFor(task.id)}>{task.title}</Link>
              </td>
              <td>{STATUS_LABELS[task.status]}</td>
              <td>
                <PriorityBadge priority={task.priority} />
              </td>
              <td>
                <TaskAssignee assignee={task.assignee} showName />
              </td>
              <td>
                {task.due_date ? (
                  <DueDate date={task.due_date} overdue={isOverdue(task, today)} />
                ) : (
                  <span className="task-table__none">None</span>
                )}
              </td>
              <td className="task-table__number">{task.comment_count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
