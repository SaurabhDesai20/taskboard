import { useId } from 'react'
import { Link } from 'react-router'
import type { Project } from '../../api/types'
import { formatDate } from '../../lib/dates'
import { projectPath } from './paths'
import { ProjectKey } from './ProjectKey'

interface ProjectCardProps {
  project: Project
  workspaceSlug: string
  /** Show Edit and Archive (owners and admins). */
  canManage: boolean
  onEdit: () => void
  onArchive: () => void
}

/** One project in the grid: its name links to the project page; actions for managers. */
export function ProjectCard({ project, workspaceSlug, canManage, onEdit, onArchive }: ProjectCardProps) {
  const nameId = useId()
  const archivedAt = project.archived_at

  return (
    <article
      className={`project-card${archivedAt ? ' project-card--archived' : ''}`}
      aria-labelledby={nameId}
    >
      <div className="project-card__top">
        <h3 id={nameId} className="project-card__name">
          <Link to={projectPath(workspaceSlug, project.id)} className="project-card__link">
            {project.name}
          </Link>
        </h3>
        <ProjectKey projectKey={project.key} />
      </div>
      <p className={`project-card__description${project.description ? '' : ' project-card__description--empty'}`}>
        {project.description ?? 'No description'}
      </p>
      {archivedAt ? (
        <p className="project-card__archived">
          <span className="status-badge">Archived</span> {formatDate(archivedAt)}
        </p>
      ) : null}
      {canManage ? (
        <div className="project-card__actions">
          <button type="button" className="button button--small" onClick={onEdit} aria-label={`Edit ${project.name}`}>
            Edit
          </button>
          {archivedAt ? null : (
            <button
              type="button"
              className="button button--small"
              onClick={onArchive}
              aria-label={`Archive ${project.name}`}
            >
              Archive
            </button>
          )}
        </div>
      ) : null}
    </article>
  )
}
