import type { Project } from '../../api/types'
import { ConfirmDialog } from '../../components/ConfirmDialog'
import { useArchiveProject } from './hooks'

interface ArchiveProjectDialogProps {
  project: Project
  onCancel: () => void
  /** Called with the archived project; the caller closes the dialog. */
  onArchived: (project: Project) => void
}

/** Asks before archiving: there is no way back (the contract has no unarchive). */
export function ArchiveProjectDialog({ project, onCancel, onArchived }: ArchiveProjectDialogProps) {
  const archive = useArchiveProject(project, { onArchived })

  return (
    <ConfirmDialog
      title={`Archive ${project.name}?`}
      confirmLabel="Archive project"
      pendingLabel="Archiving..."
      pending={archive.isPending}
      error={archive.isError ? archive.error.message : null}
      onConfirm={() => archive.mutate()}
      onCancel={onCancel}
    >
      <p>
        <strong>{project.name}</strong> leaves the project list (Show archived still lists it), and its tasks
        and comments become read-only. This cannot be undone.
      </p>
    </ConfirmDialog>
  )
}
