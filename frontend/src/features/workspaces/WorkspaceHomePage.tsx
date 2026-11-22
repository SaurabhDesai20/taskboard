import { useDocumentTitle } from '../../lib/useDocumentTitle'
import { ProjectsSection } from '../projects/ProjectsSection'
import { useCurrentWorkspace } from './hooks'

/** `/w/:slug`: the workspace overview, which lists its projects. */
export function WorkspaceHomePage() {
  const { workspace } = useCurrentWorkspace()
  useDocumentTitle(workspace?.name)
  if (!workspace) return null

  return <ProjectsSection workspace={workspace} />
}
