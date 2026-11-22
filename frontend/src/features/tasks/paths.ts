import type { UUID } from '../../api/types'
import { projectPath } from '../projects/paths'

/** A project's board with the task's detail drawer open (`?task=<id>`). */
export function taskPath(workspaceSlug: string, projectId: UUID, taskId: UUID): string {
  return `${projectPath(workspaceSlug, projectId)}?${new URLSearchParams({ task: taskId }).toString()}`
}
