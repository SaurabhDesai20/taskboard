import { Fragment } from 'react'
import { Link, NavLink, Outlet } from 'react-router'
import { ErrorState } from '../../components/ErrorState'
import { RoleBadge } from '../../components/RoleBadge'
import { LoadingSkeleton, Skeleton } from '../../components/Skeleton'
import { useDocumentTitle } from '../../lib/useDocumentTitle'
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
    if (query.isPending) {
      return (
        <LoadingSkeleton label="Loading workspace..." className="page">
          <Skeleton width="12rem" height="2rem" />
          <Skeleton width="18rem" />
        </LoadingSkeleton>
      )
    }
    if (query.isError) {
      return <ErrorState message="Could not load the workspace." error={query.error} onRetry={() => void query.refetch()} />
    }
    return <WorkspaceNotFound />
  }

  // Keyed: switching workspaces on the same page starts its forms and dialogs over.
  return (
    <Fragment key={workspace.id}>
      <Outlet />
    </Fragment>
  )
}

/** Same answer whether it does not exist or the user is not a member (like the API's 404). */
function WorkspaceNotFound() {
  useDocumentTitle('Workspace not found')
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
