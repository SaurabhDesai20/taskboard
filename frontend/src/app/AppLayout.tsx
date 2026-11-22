import type { MouseEvent } from 'react'
import { Link, Outlet } from 'react-router'
import { ThemeToggle } from '../components/ThemeToggle'
import { useMe, useSessionExpiryHandler } from '../features/auth/hooks'
import { UserMenu } from '../features/auth/UserMenu'
import { MyTasksLink } from '../features/tasks/MyTasksPage'
import { WorkspaceSwitcher } from '../features/workspaces/WorkspaceSwitcher'
import { focusElement, MAIN_CONTENT_ID } from '../lib/focus'

/** Skips the header: focus goes to the page content (without changing the URL's hash). */
function skipToContent(event: MouseEvent<HTMLAnchorElement>) {
  const main = document.getElementById(MAIN_CONTENT_ID)
  if (!main) return
  event.preventDefault()
  focusElement(main)
}

/**
 * Root layout for every page: a skip link, the header (brand, workspace switcher, My tasks,
 * theme toggle and user menu when signed in) and the main landmark.
 */
export function AppLayout() {
  useSessionExpiryHandler()
  const signedIn = Boolean(useMe().data)

  return (
    <>
      <a href={`#${MAIN_CONTENT_ID}`} className="skip-link" onClick={skipToContent}>
        Skip to main content
      </a>
      <header className="app-header">
        <Link to="/" className="app-header__brand">
          TaskBoard
        </Link>
        <WorkspaceSwitcher />
        {signedIn ? (
          <nav className="app-header__nav" aria-label="Main">
            <MyTasksLink />
          </nav>
        ) : null}
        <div className="app-header__end">
          <ThemeToggle />
          <UserMenu />
        </div>
      </header>
      <main className="app-main" id={MAIN_CONTENT_ID} tabIndex={-1}>
        <Outlet />
      </main>
    </>
  )
}
