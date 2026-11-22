import { Fragment } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { RoleBadge } from '../../components/RoleBadge'
import { StatusMessage } from '../../components/StatusMessage'
import { useCurrentWorkspace } from './hooks'
import './workspaces.css'

/**
 * `/w/:slug/*`: resolves the slug through the workspace list, shows loading, error and
 * not-found states, then the child route. Every page below it (the overview and settings in
 * `WorkspaceLayout`, project pages) can rely on `useCurrentWorkspace().workspace`.
 */
export function WorkspaceRoute() {
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

  // Keyed: switching workspaces on the same page starts its forms and dialogs over.
  return (
    <Fragment key={workspace.id}>
      <Outlet />
    </Fragment>
  )
}

/** The workspace overview, activity and settings pages: workspace header, my role and the tabs. */
export function WorkspaceLayout() {
  const { workspace } = useCurrentWorkspace()
  if (!workspace) return null

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
        <NavLink to={`${base}/activity`} className="workspace__tab">
          Activity
        </NavLink>
        <NavLink to={`${base}/settings`} className="workspace__tab">
          Settings
        </NavLink>
      </nav>
      <Outlet />
    </div>
  )
}
