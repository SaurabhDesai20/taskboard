import {
  closestCenter,
  DndContext,
  DragOverlay,
  getFirstCollision,
  MouseSensor,
  pointerWithin,
  rectIntersection,
  TouchSensor,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core'
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { useCallback, useId, useMemo, useState, type ReactElement, type ReactNode } from 'react'
import type { Project, Task, TaskMoveRequest, TaskStatus, UUID } from '../../api/types'
import { LoadingSkeleton, Skeleton } from '../../components/Skeleton'
import { todayDateOnly } from '../../lib/dates'
import { CreateTaskForm } from './CreateTaskForm'
import { useMoveTask } from './hooks'
import { isTaskStatus, STATUS_LABELS } from './labels'
import {
  columnIdsOf,
  columnOf,
  dropRequest,
  groupByStatus,
  moveOptions,
  placeTask,
  type ColumnIds,
} from './ordering'
import { SortableTaskCard, TaskCardPreview } from './TaskCard'

interface KanbanBoardProps {
  project: Project
  /** The (filtered) tasks, in the server's order. */
  tasks: Task[]
  /** The columns to show: all four, or the ones the status filter keeps. */
  statuses: readonly TaskStatus[]
  /** Drag and drop, the move menus and "Add task" (members and up, active projects only). */
  canWrite: boolean
  /** Some filter is on: empty columns say so. */
  filtered: boolean
  /** Link for a task's title: the board with its drawer open. */
  hrefFor: (taskId: UUID) => string
}

/** The board's arrangement while a card is dragged, as ids per column (UI state, not data). */
interface DragState {
  /** The arrangement when the drag started. */
  original: ColumnIds
  /** The arrangement now (cards make room as the dragged one moves between columns). */
  columns: ColumnIds
  /** The dragged task; null once dropped, until the optimistic update reaches `tasks`. */
  activeId: UUID | null
  /** The task list the arrangement was built from. */
  tasks: Task[]
}

/**
 * The Kanban board: one column per status with its count, cards in position order. Members drag
 * cards within and between columns (mouse or touch) or use each card's Move menu (keyboard).
 * Both send the same optimistic move; a failed move snaps back and an error toast says why. On
 * narrow screens the columns scroll sideways.
 */
export function KanbanBoard({ project, tasks, statuses, canWrite, filtered, hrefFor }: KanbanBoardProps) {
  const move = useMoveTask(project)
  const [drag, setDrag] = useState<DragState | null>(null)
  const [announcement, setAnnouncement] = useState('')
  // After a move from a card's menu, its Move button gets focus back once the move shows (the
  // card may have changed columns, which mounts it anew).
  const [focusRequest, setFocusRequest] = useState<{ taskId: UUID; tasks: Task[] } | null>(null)
  const today = todayDateOnly()

  // After a drop the arrangement stays up until the optimistic update lands in `tasks`, so the
  // card does not flash back to where it came from.
  if (drag && drag.activeId === null && drag.tasks !== tasks) setDrag(null)

  const byId = useMemo(() => new Map(tasks.map((task) => [task.id, task])), [tasks])
  const columns = useMemo(() => drag?.columns ?? columnIdsOf(groupByStatus(tasks)), [drag, tasks])

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } }),
  )

  const clearFocusRequest = useCallback(() => setFocusRequest(null), [])

  function moveTask(task: Task, request: TaskMoveRequest, { fromMenu }: { fromMenu: boolean }) {
    if (fromMenu) setFocusRequest({ taskId: task.id, tasks })
    setAnnouncement(`Moved ${task.key} to ${STATUS_LABELS[request.status]}.`)
    move.mutate(
      { task, request },
      {
        // A failed move leaves the card where it was, with its Move button still focused.
        onError: () => setFocusRequest(null),
        // Whatever happens, the drop arrangement is done once the server has answered.
        onSettled: () => setDrag((current) => (current?.activeId === null ? null : current)),
      },
    )
  }

  // Over a column: the closest card in it, so cards make room where the pointer is.
  const collisionDetection: CollisionDetection = useCallback(
    (args) => {
      const pointerHits = pointerWithin(args)
      const overId = getFirstCollision(pointerHits.length > 0 ? pointerHits : rectIntersection(args), 'id')
      if (overId === null) return []
      if (isTaskStatus(overId) && columns[overId].length > 0) {
        const ids = columns[overId]
        const closest = closestCenter({
          ...args,
          droppableContainers: args.droppableContainers.filter((container) => ids.includes(String(container.id))),
        })
        if (closest.length > 0) return [closest[0]]
      }
      return [{ id: overId }]
    },
    [columns],
  )

  function handleDragStart({ active }: DragStartEvent) {
    const arrangement = columnIdsOf(groupByStatus(tasks))
    move.reset()
    setFocusRequest(null)
    setDrag({ original: arrangement, columns: arrangement, activeId: String(active.id), tasks })
  }

  // Moving into another column: the card takes its place there at once.
  function handleDragOver({ active, over }: DragOverEvent) {
    if (!over) return
    const activeId = String(active.id)
    const overId = String(over.id)
    setDrag((current) => {
      if (!current || overId === activeId) return current
      const from = columnOf(current.columns, activeId)
      const to = isTaskStatus(overId) ? overId : columnOf(current.columns, overId)
      if (!from || !to || from === to) return current
      const target = current.columns[to]
      let index = target.length
      if (!isTaskStatus(overId)) {
        const dragged = active.rect.current.translated
        const below = dragged !== null && dragged.top + dragged.height / 2 > over.rect.top + over.rect.height / 2
        index = target.indexOf(overId) + (below ? 1 : 0)
      }
      return { ...current, columns: placeTask(current.columns, activeId, to, index) }
    })
  }

  function handleDragEnd({ active, over }: DragEndEvent) {
    const current = drag
    const activeId = String(active.id)
    const task = byId.get(activeId)
    if (!current || !over || !task) {
      setDrag(null)
      return
    }
    // Within a column, the card goes where the card under it was.
    let arrangement = current.columns
    const overId = String(over.id)
    const column = columnOf(arrangement, activeId)
    if (column && overId !== activeId && arrangement[column].includes(overId)) {
      arrangement = placeTask(arrangement, activeId, column, arrangement[column].indexOf(overId))
    }
    const request = dropRequest(current.original, arrangement, activeId)
    if (!request) {
      setDrag(null)
      return
    }
    setDrag({ ...current, columns: arrangement, activeId: null })
    moveTask(task, request, { fromMenu: false })
  }

  const announcements: Announcements = {
    onDragStart: ({ active }) => `Picked up ${byId.get(String(active.id))?.key ?? 'task'}.`,
    onDragOver: ({ over }) => (over ? `Over ${describeDroppable(String(over.id), byId)}.` : undefined),
    onDragEnd: ({ active, over }) =>
      over ? `Dropped ${byId.get(String(active.id))?.key ?? 'task'}.` : 'Dropped outside the board. Nothing moved.',
    onDragCancel: () => 'Drag cancelled. Nothing moved.',
  }

  const activeTask = drag?.activeId ? byId.get(drag.activeId) : undefined

  return (
    <>
      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
      <DndContext
        sensors={sensors}
        collisionDetection={collisionDetection}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onDragCancel={() => setDrag(null)}
        accessibility={{
          announcements,
          screenReaderInstructions: { draggable: 'Use the Move button on a card to move it with the keyboard.' },
        }}
      >
        <div className="board" data-columns={statuses.length}>
          {statuses.map((status) => (
            <BoardColumn
              key={status}
              status={status}
              tasks={columns[status].flatMap((id) => byId.get(id) ?? [])}
              filtered={filtered}
              footer={canWrite ? <CreateTaskForm project={project} status={status} /> : null}
              renderCard={(task) => (
                <SortableTaskCard
                  key={task.id}
                  task={task}
                  today={today}
                  href={hrefFor(task.id)}
                  canMove={canWrite}
                  moveOptions={canWrite ? moveOptions(columns, task.id) : []}
                  onMove={(moved, request) => moveTask(moved, request, { fromMenu: true })}
                  focusMoveButton={focusRequest?.taskId === task.id && focusRequest.tasks !== tasks}
                  onFocused={clearFocusRequest}
                />
              )}
            />
          ))}
        </div>
        <DragOverlay>{activeTask ? <TaskCardPreview task={activeTask} today={today} /> : null}</DragOverlay>
      </DndContext>
    </>
  )
}

/** The board's shape while its tasks load: the columns with a few placeholder cards. */
export function BoardSkeleton({ statuses }: { statuses: readonly TaskStatus[] }) {
  return (
    <LoadingSkeleton label="Loading tasks...">
      <div className="board" data-columns={statuses.length}>
        {statuses.map((status, index) => (
          <div key={status} className="board-column">
            <span className="board-column__title">{STATUS_LABELS[status]}</span>
            {Array.from({ length: 3 - (index % 2) }, (_, card) => (
              <div key={card} className="skeleton-task-card">
                <Skeleton width="30%" height="0.75rem" />
                <Skeleton width={card % 2 === 0 ? '85%' : '65%'} />
                <Skeleton width="45%" height="0.75rem" />
              </div>
            ))}
          </div>
        ))}
      </div>
    </LoadingSkeleton>
  )
}

function describeDroppable(id: string, byId: Map<UUID, Task>): string {
  return isTaskStatus(id) ? STATUS_LABELS[id] : (byId.get(id)?.key ?? 'a task')
}

interface BoardColumnProps {
  status: TaskStatus
  tasks: Task[]
  filtered: boolean
  renderCard: (task: Task) => ReactElement
  /** Below the cards: "Add task" for members. */
  footer: ReactNode
}

/** One status column (all of it a drop target): heading with the count, the cards, "Add task". */
function BoardColumn({ status, tasks, filtered, renderCard, footer }: BoardColumnProps) {
  const labelId = useId()
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const count = tasks.length

  return (
    <section
      ref={setNodeRef}
      className={`board-column${isOver ? ' board-column--over' : ''}`}
      aria-labelledby={labelId}
    >
      <h3 className="board-column__title">
        <span id={labelId}>{STATUS_LABELS[status]}</span>
        <span className="board-column__count">
          {count}
          <span className="visually-hidden"> {count === 1 ? 'task' : 'tasks'}</span>
        </span>
      </h3>
      <SortableContext id={status} items={tasks.map((task) => task.id)} strategy={verticalListSortingStrategy}>
        <ol className="board-column__list" aria-labelledby={labelId}>
          {tasks.map(renderCard)}
        </ol>
      </SortableContext>
      {count === 0 ? <p className="board-column__empty">{filtered ? 'No matching tasks' : 'No tasks'}</p> : null}
      {footer}
    </section>
  )
}
