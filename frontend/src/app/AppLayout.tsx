import { Link, Outlet } from 'react-router'

export function AppLayout() {
  return (
    <>
      <header className="app-header">
        <Link to="/" className="app-header__brand">
          TaskBoard
        </Link>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </>
  )
}
