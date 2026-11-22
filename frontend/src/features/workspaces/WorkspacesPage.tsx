import { useState } from 'react'
import { Link, useLocation } from 'react-router'
import { RoleBadge } from '../../components/RoleBadge'
import { StatusMessage } from '../../components/StatusMessage'
import { CreateWorkspaceModal } from './CreateWorkspaceModal'
import { useWorkspaces } from './hooks'
import { noticeFrom } from './notice'
import './workspaces.css'

/** Home (`/`): the user's workspaces, or an empty state inviting them to create one. */
export function WorkspacesPage() {
  const workspaces = useWorkspaces()
  const location = useLocation()
  const notice = noticeFrom(location.state)
  const [creating, setCreating] = useState(false)

  const createButton = (
    <button type="button" className="button button--primary" onClick={() => setCreating(true)}>
      Create workspace
    </button>
  )

  let content
  if (workspaces.isPending) {
    content = <StatusMessage>Loading your workspaces...</StatusMessage>
  } else if (workspaces.isError) {
    content = (
      <StatusMessage
        tone="error"
        action={
          <button type="button" className="button" onClick={() => void workspaces.refetch()}>
            Try again
          </button>
        }
      >
        Could not load your workspaces. {workspaces.error.message}
      </StatusMessage>
    )
  } else if (workspaces.data.length === 0) {
    content = (
      <div className="empty-state">
        <h2 className="empty-state__title">No workspaces yet</h2>
        <p>
          A workspace holds your team&apos;s projects and tasks. Create one, or ask a workspace admin
          to add you.
        </p>
        {createButton}
      </div>
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
    <section className="page" aria-labelledby="workspaces-title">
      <div className="page-header">
        <h1 id="workspaces-title">Your workspaces</h1>
        {workspaces.data && workspaces.data.length > 0 ? createButton : null}
      </div>
      {notice ? (
        <p className="notice" role="status">
          {notice}
        </p>
      ) : null}
      {content}
      {creating ? <CreateWorkspaceModal onClose={() => setCreating(false)} /> : null}
    </section>
  )
}
