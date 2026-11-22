import { Fragment } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { RoleBadge } from '../../components/RoleBadge'
import { StatusMessage } from '../../components/StatusMessage'
import { useCurrentWorkspace } from './hooks'
import './workspaces.css'

/**
 * `/w/:slug/*`: resolves the slug through the workspace list, then shows the workspace header,
 * its navigation and the child page. Child pages can rely on `useCurrentWorkspace().workspace`.
 */
export function WorkspaceLayout() {
  const { workspace, query } = useCurrentWorkspace()

  if (!workspace) {
    if (query.isPending) return <StatusMessage>Loading workspace...</StatusMessage>
    if (query.isError) {
      return (
        <StatusMessage
          tone="error"
          action={
            <button type="button" className="button" onClick={() => void query.refetch()}>
              Try again
            </button>
          }
        >
          Could not load the workspace. {query.error.message}
        </StatusMessage>
      )
    }
    // Same answer whether it does not exist or the user is not a member (like the API's 404).
    return (
      <section className="page" aria-labelledby="workspace-missing-title">
        <h1 id="workspace-missing-title">Workspace not found</h1>
        <p>It does not exist, or you are not a member of it.</p>
        <p>
          <Link to="/">Back to your workspaces</Link>
        </p>
      </section>
    )
  }

  const base = `/w/${workspace.slug}`
  return (
    <div className="page workspace">
      <div className="workspace__header">
        <h1 className="workspace__title">{workspace.name}</h1>
        <p className="workspace__role">
          Your role: <RoleBadge role={workspace.my_role} />
        </p>
      </div>
      <nav className="workspace__nav" aria-label="Workspace">
        <NavLink to={base} end className="workspace__tab">
          Overview
        </NavLink>
        <NavLink to={`${base}/settings`} className="workspace__tab">
          Settings
        </NavLink>
      </nav>
      {/* Keyed: switching workspaces on the same page starts its forms and dialogs over. */}
      <Fragment key={workspace.id}>
        <Outlet />
      </Fragment>
    </div>
  )
}
