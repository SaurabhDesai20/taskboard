import { Link, Outlet } from 'react-router'
import { useSessionExpiryHandler } from '../features/auth/hooks'
import { UserMenu } from '../features/auth/UserMenu'
import { WorkspaceSwitcher } from '../features/workspaces/WorkspaceSwitcher'

/** Root layout for every page: header (brand, workspace switcher and user menu when signed in). */
export function AppLayout() {
  useSessionExpiryHandler()

  return (
    <>
      <header className="app-header">
        <Link to="/" className="app-header__brand">
          TaskBoard
        </Link>
        <WorkspaceSwitcher />
        <div className="app-header__end">
          <UserMenu />
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </>
  )
}
