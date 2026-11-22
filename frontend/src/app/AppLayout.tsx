import { Link, Outlet } from 'react-router'
import { useSessionExpiryHandler } from '../features/auth/hooks'
import { UserMenu } from '../features/auth/UserMenu'

/** Root layout for every page: header (brand, user menu when signed in) and the routed page. */
export function AppLayout() {
  useSessionExpiryHandler()

  return (
    <>
      <header className="app-header">
        <Link to="/" className="app-header__brand">
          TaskBoard
        </Link>
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
