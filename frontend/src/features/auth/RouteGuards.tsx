// Route wrappers that gate their child routes on the session (the `me` query).
import { Navigate, Outlet, useLocation } from 'react-router'
import { StatusMessage } from '../../components/StatusMessage'
import { useMe } from './hooks'
import { redirectStateFor, redirectTargetFrom } from './redirect'

function SessionLoading() {
  return <StatusMessage>Loading your session...</StatusMessage>
}

/** Protected routes: logged-out visitors go to /login, which sends them back here afterwards. */
export function RequireAuth() {
  const me = useMe()
  const location = useLocation()

  // Check data first: a failed background refetch keeps the user signed in.
  if (me.data) return <Outlet />
  if (me.data === null) {
    return <Navigate to="/login" replace state={redirectStateFor(location)} />
  }
  if (me.isError) {
    return (
      <StatusMessage
        tone="error"
        action={
          <button type="button" className="button" onClick={() => void me.refetch()}>
            Try again
          </button>
        }
      >
        We could not check your session. {me.error.message}
      </StatusMessage>
    )
  }
  return <SessionLoading />
}

/** /login and /register: signed-in users go to the page they asked for, or home. */
export function RequireGuest() {
  const me = useMe()
  const location = useLocation()

  if (me.data) return <Navigate to={redirectTargetFrom(location.state)} replace />
  // If the session check failed (not a 401), still offer the form: signing in is the way forward.
  if (me.data === null || me.isError) return <Outlet />
  return <SessionLoading />
}
