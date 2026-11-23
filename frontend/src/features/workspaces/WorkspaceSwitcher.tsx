import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent } from 'react'
import { Link } from 'react-router'
import { ErrorState } from '../../components/ErrorState'
import { RoleBadge } from '../../components/RoleBadge'
import { useMe } from '../auth/hooks'
import { CreateWorkspaceModal } from './CreateWorkspaceModal'
import { useCurrentWorkspace } from './hooks'
import './workspaces.css'

/** The header's workspace menu; only for signed-in users (it loads their workspaces). */
export function WorkspaceSwitcher() {
  const me = useMe()
  return me.data ? <WorkspaceSwitcherMenu /> : null
}

/**
 * A disclosure button (current workspace name) that reveals the user's workspaces, each with
 * the user's role, and a "Create workspace" entry. Escape closes it and returns focus to the
 * button; so does clicking or tabbing outside.
 */
function WorkspaceSwitcherMenu() {
  const { workspace: current, query } = useCurrentWorkspace()
  const [open, setOpen] = useState(false)
  const [creating, setCreating] = useState(false)
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

  function startCreating() {
    setOpen(false)
    setCreating(true)
  }

  let list
  if (query.isPending) {
    list = <p className="switcher__message">Loading workspaces...</p>
  } else if (query.isError) {
    list = <ErrorState compact message="Could not load your workspaces." onRetry={() => void query.refetch()} />
  } else if (query.data.length === 0) {
    list = <p className="switcher__message">You are not in any workspace yet.</p>
  } else {
    list = (
      <ul className="switcher__list" aria-label="Your workspaces">
        {query.data.map((workspace) => (
          <li key={workspace.id}>
            <Link
              to={`/w/${workspace.slug}`}
              className="switcher__item"
              aria-current={workspace.id === current?.id ? 'true' : undefined}
              onClick={() => setOpen(false)}
            >
              <span className="switcher__name">{workspace.name}</span>
              <RoleBadge role={workspace.my_role} />
            </Link>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <>
      <div className="switcher" ref={containerRef} onKeyDown={handleKeyDown} onBlur={handleBlur}>
        <button
          ref={toggleRef}
          type="button"
          className="switcher__toggle"
          aria-expanded={open}
          aria-controls={panelId}
          onClick={() => setOpen((value) => !value)}
        >
          {current ? (
            <>
              {/* The space stays outside the hidden span, or it is lost from the name. */}
              <span className="visually-hidden">Current workspace:</span> {current.name}
            </>
          ) : (
            'Workspaces'
          )}
          <span className="switcher__chevron" aria-hidden="true">
            ▾
          </span>
        </button>
        <div id={panelId} className="switcher__panel" hidden={!open}>
          {list}
          <button type="button" className="button switcher__create" onClick={startCreating}>
            Create workspace
          </button>
        </div>
      </div>
      {creating ? <CreateWorkspaceModal onClose={() => setCreating(false)} returnFocusRef={toggleRef} /> : null}
    </>
  )
}
