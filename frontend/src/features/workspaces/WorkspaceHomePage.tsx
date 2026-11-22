import { ProjectsSection } from '../projects/ProjectsSection'
import { useCurrentWorkspace } from './hooks'

/** `/w/:slug`: the workspace overview, which lists its projects. */
export function WorkspaceHomePage() {
  const { workspace } = useCurrentWorkspace()
  if (!workspace) return null

  return <ProjectsSection workspace={workspace} />
}
