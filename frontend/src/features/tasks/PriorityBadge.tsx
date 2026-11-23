import type { TaskPriority } from '../../api/types'
import { PRIORITY_LABELS } from './labels'

/** "High" as a small colored label, announced as "Priority: High". */
export function PriorityBadge({ priority }: { priority: TaskPriority }) {
  return (
    <span className={`priority-badge priority-badge--${priority}`}>
      <span className="visually-hidden">Priority: </span>
      {PRIORITY_LABELS[priority]}
    </span>
  )
}
