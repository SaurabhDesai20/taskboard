import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { initialsOf } from '../../lib/initials'
import './auth.css'
import { useLogout, useMe } from './hooks'

/**
 * The signed-in user's menu in the header: a disclosure button (name) that reveals the email
 * and a "Log out" button. Escape closes it and returns focus to the button; so does clicking
 * or tabbing outside.
 */
export function UserMenu() {
  const me = useMe()
  const logout = useLogout()
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const toggleRef = useRef<HTMLButtonElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    function handlePointerDown(event: PointerEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    return () => document.removeEventListener('pointerdown', handlePointerDown)
  }, [open])

  const user = me.data
  if (!user) return null

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape' && open) {
      event.stopPropagation()
      setOpen(false)
      toggleRef.current?.focus()
    }
  }

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    const next = event.relatedTarget
    if (next instanceof Node && !event.currentTarget.contains(next)) setOpen(false)
  }

  return (
    <div className="user-menu" ref={containerRef} onKeyDown={handleKeyDown} onBlur={handleBlur}>
      <button
        ref={toggleRef}
        type="button"
        className="user-menu__toggle"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className="avatar" aria-hidden="true">
          {initialsOf(user.name)}
        </span>
        <span className="user-menu__name">{user.name}</span>
      </button>
      <div id={panelId} className="user-menu__panel" hidden={!open}>
        <p className="user-menu__identity">
          Signed in as <strong>{user.name}</strong>
          <span className="user-menu__email">{user.email}</span>
        </p>
        {logout.isError ? (
          <p className="field__error" role="alert">
            Could not log out. {logout.error.message}
          </p>
        ) : null}
        <button
          type="button"
          className="button user-menu__logout"
          disabled={logout.isPending}
          onClick={() => logout.mutate()}
        >
          {logout.isPending ? 'Logging out...' : 'Log out'}
        </button>
      </div>
    </div>
  )
}
