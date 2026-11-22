import type { UUID } from '../../api/types'

/** The project page, `/w/:slug/projects/:projectId` (the project id is its UUID). */
export function projectPath(workspaceSlug: string, projectId: UUID): string {
  return `/w/${workspaceSlug}/projects/${projectId}`
}
