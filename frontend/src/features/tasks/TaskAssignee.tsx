import type { UserRef } from '../../api/types'
import { Avatar } from '../../components/Avatar'

interface TaskAssigneeProps {
  assignee: UserRef | null
  /** Show the name next to the avatar (list views); cards show the initials only. */
  showName?: boolean
}

/** The assignee's initials (name in a tooltip and for screen readers), or "Unassigned". */
export function TaskAssignee({ assignee, showName = false }: TaskAssigneeProps) {
  if (!assignee) {
    return <span className="task-assignee task-assignee--none">Unassigned</span>
  }
  return (
    <span className="task-assignee">
      <Avatar name={assignee.name} size="small" />
      {showName ? (
        <span>{assignee.name}</span>
      ) : (
        <span className="visually-hidden">Assigned to {assignee.name}</span>
      )}
    </span>
  )
}
