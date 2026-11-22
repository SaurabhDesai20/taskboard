import { Can } from './Can'
import { useCurrentWorkspace } from './hooks'

/** `/w/:slug`: the workspace overview. Projects arrive in Phase 3; for now the section is empty. */
export function WorkspaceHomePage() {
  const { workspace } = useCurrentWorkspace()
  if (!workspace) return null

  return (
    <section className="workspace-section" aria-labelledby="projects-title">
      <h2 id="projects-title">Projects</h2>
      <div className="empty-state">
        <p className="empty-state__title">No projects yet</p>
        <Can
          action="project.manage"
          fallback={<p>Projects that admins and owners create will be listed here.</p>}
        >
          <p>Projects you create in {workspace.name} will be listed here.</p>
        </Can>
      </div>
    </section>
  )
}
