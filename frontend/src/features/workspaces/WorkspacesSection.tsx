import { useId, useState } from 'react'
import { Link } from 'react-router'
import { EmptyState } from '../../components/EmptyState'
import { ErrorState } from '../../components/ErrorState'
import { RoleBadge } from '../../components/RoleBadge'
import { CardGridSkeleton } from '../../components/Skeleton'
import { CreateWorkspaceModal } from './CreateWorkspaceModal'
import { useWorkspaces } from './hooks'
import './workspaces.css'

/** The dashboard's list of my workspaces, or an empty state inviting me to create one. */
export function WorkspacesSection() {
  const workspaces = useWorkspaces()
  const [creating, setCreating] = useState(false)
  const titleId = useId()

  const createButton = (
    <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
      Create workspace
    </button>
  )

  let content
  if (workspaces.isPending) {
    content = <CardGridSkeleton label="Loading your workspaces..." className="workspace-grid" count={2} />
  } else if (workspaces.isError) {
    content = (
      <ErrorState
        message="Could not load your workspaces."
        error={workspaces.error}
        onRetry={() => void workspaces.refetch()}
      />
    )
  } else if (workspaces.data.length === 0) {
    content = (
      <EmptyState title="No workspaces yet" headingLevel={3} action={createButton}>
        A workspace holds your team&apos;s projects and tasks. Create one, or ask a workspace admin to add you.
      </EmptyState>
    )
  } else {
    content = (
      <ul className="workspace-grid">
        {workspaces.data.map((workspace) => (
          <li key={workspace.id}>
            <Link to={`/w/${workspace.slug}`} className="workspace-card">
              <span className="workspace-card__name">{workspace.name}</span>
              <span className="workspace-card__meta">
                <span className="workspace-card__slug">/w/{workspace.slug}</span>
                <RoleBadge role={workspace.my_role} />
              </span>
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <section className="dashboard__section" aria-labelledby={titleId}>
      <div className="section-header">
        <h2 id={titleId}>Your workspaces</h2>
        {workspaces.data && workspaces.data.length > 0 ? createButton : null}
      </div>
      {content}
      {creating ? <CreateWorkspaceModal onClose={() => setCreating(false)} /> : null}
    </section>
  )
}
