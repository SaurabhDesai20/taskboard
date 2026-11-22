import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import { useSearchParams } from 'react-router'
import type { Project, UUID, Workspace } from '../../api/types'
import { StatusMessage } from '../../components/StatusMessage'
import { can } from '../../lib/permissions'
import { ArchiveProjectDialog } from './ArchiveProjectDialog'
import { CreateProjectModal } from './CreateProjectModal'
import { EditProjectModal } from './EditProjectModal'
import { useProject, useProjects } from './hooks'
import { ProjectCard } from './ProjectCard'
import './projects.css'

/** `?archived=1` keeps "Show archived" on across reloads and back/forward navigation. */
const ARCHIVED_PARAM = 'archived'

type ProjectDialog = { kind: 'edit'; projectId: UUID } | { kind: 'archive'; projectId: UUID }
type OpenDialog = { kind: 'create' } | ProjectDialog

/** A one-off confirmation; a new object each time, so repeating the same text still announces it. */
interface Notice {
  message: string
}

/**
 * The Projects part of the workspace overview: a grid of project cards with a "Show archived"
 * toggle, loading, empty and error states, and (for owners and admins) create, edit and archive.
 */
export function ProjectsSection({ workspace }: { workspace: Workspace }) {
  const [searchParams, setSearchParams] = useSearchParams()
  const showArchived = searchParams.get(ARCHIVED_PARAM) === '1'
  const projects = useProjects(workspace.id, { includeArchived: showArchived })
  const canManage = can(workspace.my_role, 'project.manage')
  const [dialog, setDialog] = useState<OpenDialog | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)
  const noticeRef = useRef<HTMLParagraphElement>(null)
  const toggleId = useId()

  // The archived card (or its Archive button) is gone, so focus moves to the confirmation.
  useEffect(() => {
    if (notice) noticeRef.current?.focus()
  }, [notice])

  function toggleArchived(event: ChangeEvent<HTMLInputElement>) {
    const { checked } = event.target
    setSearchParams(
      (params) => {
        const next = new URLSearchParams(params)
        if (checked) next.set(ARCHIVED_PARAM, '1')
        else next.delete(ARCHIVED_PARAM)
        return next
      },
      { replace: true },
    )
  }

  const close = () => setDialog(null)
  const openCreate = () => setDialog({ kind: 'create' })
  const createButton = (
    <button type="button" className="button button--primary" onClick={openCreate}>
      New project
    </button>
  )

  let content
  if (projects.isPending) {
    content = <StatusMessage>Loading projects...</StatusMessage>
  } else if (projects.isError) {
    content = (
      <StatusMessage
        tone="error"
        action={
          <button type="button" className="button" onClick={() => void projects.refetch()}>
            Try again
          </button>
        }
      >
        Could not load the projects. {projects.error.message}
      </StatusMessage>
    )
  } else if (projects.data.length === 0) {
    content = (
      <div className="empty-state">
        <h3 className="empty-state__title">{showArchived ? 'No projects yet' : 'No active projects'}</h3>
        {canManage ? (
          <>
            <p>Create a project to organize the work in {workspace.name}.</p>
            {createButton}
          </>
        ) : (
          <p>Projects that admins and owners create will be listed here.</p>
        )}
      </div>
    )
  } else {
    content = (
      <ul className="project-grid">
        {projects.data.map((project) => (
          <li key={project.id}>
            <ProjectCard
              project={project}
              workspaceSlug={workspace.slug}
              canManage={canManage}
              onEdit={() => setDialog({ kind: 'edit', projectId: project.id })}
              onArchive={() => setDialog({ kind: 'archive', projectId: project.id })}
            />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="workspace-section" aria-labelledby="projects-title">
      <div className="section-header">
        <h2 id="projects-title">Projects</h2>
        <div className="section-header__actions">
          <div className="checkbox">
            <input id={toggleId} type="checkbox" checked={showArchived} onChange={toggleArchived} />
            <label htmlFor={toggleId}>Show archived</label>
          </div>
          {canManage && projects.data && projects.data.length > 0 ? createButton : null}
        </div>
      </div>
      {notice ? (
        <p ref={noticeRef} className="notice" role="status" tabIndex={-1}>
          {notice.message}
        </p>
      ) : null}
      {content}
      {/* Manage dialogs close if my role is refreshed to one that cannot manage projects. */}
      {canManage && dialog?.kind === 'create' ? <CreateProjectModal workspace={workspace} onClose={close} /> : null}
      {canManage && dialog && dialog.kind !== 'create' ? (
        <SelectedProjectDialog
          workspaceId={workspace.id}
          dialog={dialog}
          onClose={close}
          onArchived={(archived) => {
            close()
            setNotice({ message: `Archived ${archived.name}.` })
          }}
        />
      ) : null}
    </section>
  )
}

interface SelectedProjectDialogProps {
  workspaceId: UUID
  dialog: ProjectDialog
  onClose: () => void
  onArchived: (project: Project) => void
}

/**
 * The edit or archive dialog for one project. It reads the project through its own query (seeded
 * from the list), so it stays open with its error when the project leaves the list meanwhile,
 * e.g. after a 409 already_archived refreshed the list.
 */
function SelectedProjectDialog({ workspaceId, dialog, onClose, onArchived }: SelectedProjectDialogProps) {
  const project = useProject(workspaceId, dialog.projectId).data
  if (!project) return null
  if (dialog.kind === 'edit') return <EditProjectModal project={project} onClose={onClose} />
  return <ArchiveProjectDialog project={project} onCancel={onClose} onArchived={onArchived} />
}
