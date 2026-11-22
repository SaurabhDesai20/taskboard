import { Fragment, useEffect, useRef, useState } from 'react'
import { Link, Outlet } from 'react-router'
import type { Project, Workspace } from '../../api/types'
import { Breadcrumbs, type Crumb } from '../../components/Breadcrumbs'
import { StatusMessage } from '../../components/StatusMessage'
import { formatDate } from '../../lib/dates'
import { can } from '../../lib/permissions'
import { ArchiveProjectDialog } from './ArchiveProjectDialog'
import { EditProjectModal } from './EditProjectModal'
import { isProjectNotFound, useCurrentProject } from './hooks'
import { ProjectKey } from './ProjectKey'
import { ProjectSidebar } from './ProjectSidebar'
import './projects.css'

/**
 * `/w/:slug/projects/:projectId`: breadcrumbs, a sidebar with the workspace's projects, and the
 * project (header plus the child page, the task board). An unknown project, or
 * one from another workspace, shows a not-found state inside the layout.
 */
export function ProjectLayout() {
  const { workspace, projectId, query } = useCurrentProject()
  if (!workspace || !projectId) return null

  const notFound = query.isError && isProjectNotFound(query.error)
  const project = notFound ? undefined : query.data

  let main
  if (notFound) {
    main = <ProjectNotFound workspace={workspace} />
  } else if (project) {
    main = (
      <>
        <ProjectHeader project={project} canManage={can(workspace.my_role, 'project.manage')} />
        <Outlet />
      </>
    )
  } else if (query.isError) {
    main = (
      <StatusMessage
        tone="error"
        action={
          <button type="button" className="button" onClick={() => void query.refetch()}>
            Try again
          </button>
        }
      >
        Could not load the project. {query.error.message}
      </StatusMessage>
    )
  } else {
    main = <StatusMessage>Loading project...</StatusMessage>
  }

  const crumbs: Crumb[] = [
    { label: 'Workspaces', to: '/' },
    { label: workspace.name, to: `/w/${workspace.slug}` },
  ]
  if (project) crumbs.push({ label: project.name })
  else if (notFound) crumbs.push({ label: 'Project not found' })

  return (
    <div className="page page--wide project-layout">
      <Breadcrumbs items={crumbs} />
      <div className="project-layout__body">
        <ProjectSidebar workspace={workspace} currentProject={project} />
        <div className="project-layout__main">
          {/* Keyed: moving to another project starts its dialogs over. */}
          <Fragment key={projectId}>{main}</Fragment>
        </div>
      </div>
    </div>
  )
}

function ProjectNotFound({ workspace }: { workspace: Workspace }) {
  return (
    <section className="project-missing" aria-labelledby="project-missing-title">
      <h1 id="project-missing-title">Project not found</h1>
      <p>It does not exist, or it is not part of {workspace.name}.</p>
      <p>
        <Link to={`/w/${workspace.slug}`}>Back to {workspace.name}</Link>
      </p>
    </section>
  )
}

interface ProjectHeaderProps {
  project: Project
  /** Show Edit and Archive (owners and admins). */
  canManage: boolean
}

function ProjectHeader({ project, canManage }: ProjectHeaderProps) {
  const [dialog, setDialog] = useState<'edit' | 'archive' | null>(null)
  const [archivedHere, setArchivedHere] = useState(false)
  const bannerRef = useRef<HTMLDivElement>(null)
  const archivedAt = project.archived_at

  // After archiving here the Archive button is gone: focus moves to the new banner instead.
  useEffect(() => {
    if (archivedHere && archivedAt) bannerRef.current?.focus()
  }, [archivedHere, archivedAt])

  const close = () => setDialog(null)

  return (
    <div className="project-header">
      <div className="project-header__top">
        <div className="project-header__title">
          <h1>{project.name}</h1>
          <ProjectKey projectKey={project.key} />
        </div>
        {canManage ? (
          <div className="project-header__actions">
            <button type="button" className="button" onClick={() => setDialog('edit')}>
              Edit project
            </button>
            {archivedAt ? null : (
              <button type="button" className="button" onClick={() => setDialog('archive')}>
                Archive project
              </button>
            )}
          </div>
        ) : null}
      </div>
      {project.description ? <p className="project-header__description">{project.description}</p> : null}
      {archivedAt ? (
        <div ref={bannerRef} className="banner" role="note" tabIndex={-1}>
          <strong>Archived on {formatDate(archivedAt)}.</strong> This project is read-only: its tasks and
          comments cannot be changed.
        </div>
      ) : null}
      {canManage && dialog === 'edit' ? <EditProjectModal project={project} onClose={close} /> : null}
      {canManage && dialog === 'archive' ? (
        <ArchiveProjectDialog
          project={project}
          onCancel={close}
          onArchived={() => {
            close()
            setArchivedHere(true)
          }}
        />
      ) : null}
    </div>
  )
}
