import { useId } from 'react'
import { Link, NavLink } from 'react-router'
import type { Project, Workspace } from '../../api/types'
import { ErrorState } from '../../components/ErrorState'
import { useProjects } from './hooks'
import { projectPath } from './paths'

interface ProjectSidebarProps {
  workspace: Workspace
  /** The open project, once loaded. Listed under "Archived" when it is archived. */
  currentProject: Project | undefined
  /** Whether the list is shown; collapsing it leaves more room for the board. */
  open: boolean
  onToggle: (open: boolean) => void
}

/**
 * The workspace's active projects; the open one is marked as the current page. The "Projects"
 * heading is a disclosure button (aria-expanded) that shows or hides the list.
 */
export function ProjectSidebar({ workspace, currentProject, open, onToggle }: ProjectSidebarProps) {
  const projects = useProjects(workspace.id)
  const titleId = useId()
  const contentId = useId()
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
    list = <ErrorState compact message="Could not load the projects." onRetry={() => void projects.refetch()} />
  } else if (projects.data.length === 0) {
    list = <p className="project-sidebar__message">No active projects.</p>
  } else {
    list = <ul className="project-sidebar__list">{projects.data.map(link)}</ul>
  }

  const archivedCurrent = currentProject?.archived_at ? currentProject : undefined

  return (
    <nav className={`project-sidebar${open ? '' : ' project-sidebar--collapsed'}`} aria-labelledby={titleId}>
      <h2 className="project-sidebar__title">
        <button
          id={titleId}
          type="button"
          className="project-sidebar__toggle"
          aria-expanded={open}
          aria-controls={contentId}
          title={open ? 'Hide the project list' : 'Show the project list'}
          onClick={() => onToggle(!open)}
        >
          Projects
          <span className="project-sidebar__chevron" aria-hidden="true" />
        </button>
      </h2>
      <div id={contentId} className="project-sidebar__content" hidden={!open}>
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
      </div>
    </nav>
  )
}
