import { useId } from 'react'
import { Link, NavLink } from 'react-router'
import type { Project, Workspace } from '../../api/types'
import { useProjects } from './hooks'
import { projectPath } from './paths'

interface ProjectSidebarProps {
  workspace: Workspace
  /** The open project, once loaded. Listed under "Archived" when it is archived. */
  currentProject: Project | undefined
}

/** The workspace's active projects; the open one is marked as the current page. */
export function ProjectSidebar({ workspace, currentProject }: ProjectSidebarProps) {
  const projects = useProjects(workspace.id)
  const titleId = useId()
  const archivedTitleId = useId()

  const link = (project: Project) => (
    <li key={project.id}>
      <NavLink to={projectPath(workspace.slug, project.id)} className="project-sidebar__link">
        <span className="project-sidebar__key" aria-hidden="true">
          {project.key}
        </span>
        <span className="project-sidebar__name">{project.name}</span>
      </NavLink>
    </li>
  )

  let list
  if (projects.isPending) {
    list = <p className="project-sidebar__message">Loading projects...</p>
  } else if (projects.isError) {
    list = (
      <div className="project-sidebar__message" role="alert">
        <p>Could not load the projects.</p>
        <button type="button" className="button button--small" onClick={() => void projects.refetch()}>
          Try again
        </button>
      </div>
    )
  } else if (projects.data.length === 0) {
    list = <p className="project-sidebar__message">No active projects.</p>
  } else {
    list = <ul className="project-sidebar__list">{projects.data.map(link)}</ul>
  }

  const archivedCurrent = currentProject?.archived_at ? currentProject : undefined

  return (
    <nav className="project-sidebar" aria-labelledby={titleId}>
      <h2 id={titleId} className="project-sidebar__title">
        Projects
      </h2>
      {list}
      {archivedCurrent ? (
        <>
          <h3 id={archivedTitleId} className="project-sidebar__subtitle">
            Archived
          </h3>
          <ul className="project-sidebar__list" aria-labelledby={archivedTitleId}>
            {link(archivedCurrent)}
          </ul>
        </>
      ) : null}
      <Link to={`/w/${workspace.slug}`} className="project-sidebar__all">
        All projects
      </Link>
    </nav>
  )
}
