import { useId, useMemo } from 'react'
import type { Task } from '../../api/types'
import { ActivityFeed } from './ActivityFeed'
import { NO_ACTIVITY_FILTERS } from './hooks'

/**
 * The task drawer's Activity tab: the task's history (`?task_id=`), newest first, rendered like
 * the workspace feed. No links: every entry is about the task that is already open.
 */
export function TaskActivity({ task }: { task: Task }) {
  const headingId = useId()
  const filters = useMemo(() => ({ ...NO_ACTIVITY_FILTERS, taskId: task.id }), [task.id])
  return (
    <section className="task-activity" aria-labelledby={headingId}>
      <h3 id={headingId} className="task-drawer__subtitle">
        Activity
      </h3>
      <ActivityFeed
        workspaceId={task.workspace_id}
        filters={filters}
        label={`Activity of ${task.key}`}
        empty={<p className="activity-feed__note">No activity yet.</p>}
      />
    </section>
  )
}
