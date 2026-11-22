import { useId, useRef, useState, type ChangeEvent, type RefObject } from 'react'
import { useSearchParams } from 'react-router'
import type { Project, UUID, Workspace } from '../../api/types'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { CardGridSkeleton } from '../../components/Skeleton'
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
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Where focus goes when a dialog closes: its opener (the default), or the heading once the
  // archived project's card (and so the opener) has left the grid.
  const dialogReturnFocus = useRef<HTMLElement | null>(null)
  const toggleId = useId()

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

  const open = (next: OpenDialog) => {
    dialogReturnFocus.current = null
    setDialog(next)
  }
  const close = () => setDialog(null)
  const createButton = (
    <button type="button" className="button button--primary" onClick={() => open({ kind: 'create' })}>
      New project
    </button>
  )

  let content
  if (projects.isPending) {
    content = <CardGridSkeleton label="Loading projects..." className="project-grid" />
  } else if (projects.isError) {
    content = <ErrorState message="Could not load the projects." error={projects.error} onRetry={() => void projects.refetch()} />
  } else if (projects.data.length === 0) {
    content = (
      <EmptyState
        title={showArchived ? 'No projects yet' : 'No active projects'}
        headingLevel={3}
        action={canManage ? createButton : null}
      >
        {canManage
          ? `Create a project to organize the work in ${workspace.name}.`
          : 'Projects that admins and owners create will be listed here.'}
      </EmptyState>
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
              onEdit={() => open({ kind: 'edit', projectId: project.id })}
              onArchive={() => open({ kind: 'archive', projectId: project.id })}
            />
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="workspace-section" aria-labelledby="projects-title">
      <div className="section-header">
        <h2 id="projects-title" ref={headingRef} tabIndex={-1}>
          Projects
        </h2>
        <div className="section-header__actions">
          <div className="checkbox">
            <input id={toggleId} type="checkbox" checked={showArchived} onChange={toggleArchived} />
            <label htmlFor={toggleId}>Show archived</label>
          </div>
          {canManage && projects.data && projects.data.length > 0 ? createButton : null}
        </div>
      </div>
      {content}
      {/* Manage dialogs close if my role is refreshed to one that cannot manage projects. */}
      {canManage && dialog?.kind === 'create' ? <CreateProjectModal workspace={workspace} onClose={close} /> : null}
      {canManage && dialog && dialog.kind !== 'create' ? (
        <SelectedProjectDialog
          workspaceId={workspace.id}
          dialog={dialog}
          onClose={close}
          returnFocusRef={dialogReturnFocus}
          onArchived={() => {
            // The toast says what happened; the card that held focus is gone.
            dialogReturnFocus.current = headingRef.current
            close()
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
  returnFocusRef: RefObject<HTMLElement | null>
}

/**
 * The edit or archive dialog for one project. It reads the project through its own query (seeded
 * from the list), so it stays open with its error when the project leaves the list meanwhile,
 * e.g. after a 409 already_archived refreshed the list.
 */
function SelectedProjectDialog({ workspaceId, dialog, onClose, onArchived, returnFocusRef }: SelectedProjectDialogProps) {
  const project = useProject(workspaceId, dialog.projectId).data
  if (!project) return null
  if (dialog.kind === 'edit') return <EditProjectModal project={project} onClose={onClose} />
  return (
    <ArchiveProjectDialog project={project} onCancel={onClose} onArchived={onArchived} returnFocusRef={returnFocusRef} />
  )
}
