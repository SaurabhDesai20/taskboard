import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useEffect, useId, useRef, type CSSProperties, type ReactNode } from 'react'
import { Link } from 'react-router'
import type { Task, TaskMoveRequest } from '../../api/types'
import { DueDate } from './DueDate'
import { isOverdue } from './dueDates'
import type { MoveOption } from './ordering'
import { PriorityBadge } from './PriorityBadge'
import { TaskAssignee } from './TaskAssignee'
import { TaskMoveMenu } from './TaskMoveMenu'

interface TaskCardBodyProps {
  task: Task
  today: string
  /** Where the title links to (the board with this task's drawer open). */
  href?: string
  /** The move menu; left out for read-only boards and the drag preview. */
  moveMenu?: ReactNode
}

/** What a card shows: key, priority, title (opens the drawer), due date and assignee. */
function TaskCardBody({ task, today, href, moveMenu }: TaskCardBodyProps) {
  const titleId = useId()
  const overdue = isOverdue(task, today)
  return (
    <article className={`task-card${overdue ? ' task-card--overdue' : ''}`} aria-labelledby={titleId}>
      <div className="task-card__top">
        <span className="task-card__key">{task.key}</span>
        <PriorityBadge priority={task.priority} />
      </div>
      <h4 id={titleId} className="task-card__title">
        {href ? (
          <Link to={href} className="task-card__link">
            {task.title}
          </Link>
        ) : (
          task.title
        )}
      </h4>
      <div className="task-card__meta">
        {task.due_date ? <DueDate date={task.due_date} overdue={overdue} /> : <span />}
        <TaskAssignee assignee={task.assignee} />
      </div>
      {moveMenu}
    </article>
  )
}

/** The card shown under the pointer while dragging. */
export function TaskCardPreview({ task, today }: { task: Task; today: string }) {
  return (
    <div className="task-card-preview">
      <TaskCardBody task={task} today={today} />
    </div>
  )
}

interface SortableTaskCardProps {
  task: Task
  today: string
  href: string
  /** Drag and drop plus the move menu; false on read-only boards. */
  canMove: boolean
  moveOptions: MoveOption[]
  onMove: (task: Task, request: TaskMoveRequest) => void
  /** Put focus on this card's Move button (after a move from the menu). */
  focusMoveButton: boolean
  onFocused: () => void
}

/**
 * A card in a column: draggable with the mouse or touch (dnd-kit), and movable from the
 * keyboard with its Move menu. Only pointer sensors drag, so the card is not itself a button
 * (which would nest the title link and the menu inside an interactive element).
 */
export function SortableTaskCard({
  task,
  today,
  href,
  canMove,
  moveOptions,
  onMove,
  focusMoveButton,
  onFocused,
}: SortableTaskCardProps) {
  const toggleRef = useRef<HTMLButtonElement>(null)
  const { setNodeRef, listeners, transform, transition, isDragging } = useSortable({
    id: task.id,
    disabled: !canMove,
  })

  useEffect(() => {
    if (!focusMoveButton) return
    toggleRef.current?.focus()
    onFocused()
  }, [focusMoveButton, onFocused])

  const style: CSSProperties = { transform: CSS.Translate.toString(transform), transition }

  return (
    <li
      ref={setNodeRef}
      style={style}
      className={`board-column__item${isDragging ? ' board-column__item--dragging' : ''}${canMove ? ' board-column__item--movable' : ''}`}
      {...listeners}
    >
      <TaskCardBody
        task={task}
        today={today}
        href={href}
        moveMenu={
          canMove ? (
            <TaskMoveMenu
              taskKey={task.key}
              options={moveOptions}
              onMove={(request) => onMove(task, request)}
              toggleRef={toggleRef}
            />
          ) : null
        }
      />
    </li>
  )
}
