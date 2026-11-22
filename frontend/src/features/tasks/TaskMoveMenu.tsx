import { useEffect, useId, useRef, useState, type FocusEvent, type KeyboardEvent, type RefObject } from 'react'
import type { TaskMoveRequest } from '../../api/types'
import type { MoveOption } from './ordering'

interface TaskMoveMenuProps {
  taskKey: string
  options: MoveOption[]
  onMove: (request: TaskMoveRequest) => void
  /** The toggle button, so the board can put focus back on it after a move. */
  toggleRef: RefObject<HTMLButtonElement>
}

/**
 * The keyboard (and pointer) alternative to dragging a card: a disclosure button that reveals
 * "Move up", "Move down" and "Move to top/bottom of <column>". Escape closes it and returns focus
 * to the button; so does clicking or tabbing outside. It uses the same move as drag and drop.
 */
export function TaskMoveMenu({ taskKey, options, onMove, toggleRef }: TaskMoveMenuProps) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
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

  function choose(option: MoveOption) {
    setOpen(false)
    toggleRef.current?.focus()
    onMove(option.request)
  }

  if (options.length === 0) return null

  return (
    <div className="move-menu" ref={containerRef} onKeyDown={handleKeyDown} onBlur={handleBlur}>
      <button
        ref={toggleRef}
        type="button"
        className="button button--small move-menu__toggle"
        aria-label={`Move ${taskKey}`}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        Move
      </button>
      <ul id={panelId} className="move-menu__panel" hidden={!open} aria-label={`Move ${taskKey}`}>
        {options.map((option) => (
          <li key={option.id}>
            <button type="button" className="move-menu__option" onClick={() => choose(option)}>
              {option.label}
            </button>
          </li>
        ))}
      </ul>
    </div>
  )
}
