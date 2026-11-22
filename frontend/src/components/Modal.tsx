import { useEffect, useId, useRef, useState, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { focusFirstConnected, mainFocusTarget, sectionHeadingOf } from '../lib/focus'

const FOCUSABLE = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled]):not([type="hidden"])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(',')

function focusableIn(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE)).filter(
    (element) => !element.closest('[hidden]'),
  )
}

interface ModalProps {
  /** Shown as the dialog heading and used as its accessible name. */
  title: string
  /** Escape, the backdrop and the caller's Cancel button call it; the caller unmounts the modal. */
  onClose: () => void
  children: ReactNode
  /** Focused when the modal opens. Defaults to the first focusable element inside it. */
  initialFocusRef?: RefObject<HTMLElement | null>
  /**
   * Focused after the modal closes; read at that moment, so a caller can point it somewhere else
   * just before closing (e.g. at a list heading after deleting the row that opened the modal).
   * Defaults to whatever had focus when the modal opened.
   */
  returnFocusRef?: RefObject<HTMLElement | null>
  /** Id of the text that describes the dialog (e.g. the question a confirmation asks). */
  describedBy?: string
  /** `drawer`: a full-height panel on the right (e.g. task details) instead of a centered box. */
  variant?: 'dialog' | 'drawer'
}

/**
 * An accessible modal dialog, rendered while mounted (open it by rendering it): focus moves in,
 * Tab and Shift+Tab stay inside, Escape closes, and focus returns to where it came from. If that
 * element is gone by then (its row was deleted, or a role change hid it), focus goes to the
 * heading of the section it was in, else to the page's main heading, never to the page body.
 */
export function Modal({
  title,
  onClose,
  children,
  initialFocusRef,
  returnFocusRef,
  describedBy,
  variant = 'dialog',
}: ModalProps) {
  const titleId = useId()
  const dialogRef = useRef<HTMLDivElement>(null)
  // Read during the first render, before anything inside the modal can take focus.
  const [openedFrom] = useState(() => document.activeElement)

  // Runs once per opening: ref objects are stable, so the dependencies do not change.
  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return undefined
    // Null when nothing had focus (e.g. a drawer opened straight from the URL).
    const opener = openedFrom instanceof HTMLElement && openedFrom !== document.body ? openedFrom : null
    // Worked out now, while the opener is still in the page.
    const openerSection = sectionHeadingOf(opener)
    const focusFirst = () => (initialFocusRef?.current ?? focusableIn(dialog)[0] ?? dialog).focus()
    focusFirst()

    // Focus that escapes anyway (e.g. a click on the page behind) is pulled back in.
    function handleFocusIn(event: FocusEvent) {
      if (event.target instanceof Node && !dialog?.contains(event.target)) focusFirst()
    }
    document.addEventListener('focusin', handleFocusIn)

    return () => {
      document.removeEventListener('focusin', handleFocusIn)
      // Read on close on purpose: callers point the ref elsewhere just before closing.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      focusFirstConnected([returnFocusRef?.current, opener, openerSection, mainFocusTarget()])
    }
  }, [initialFocusRef, returnFocusRef, openedFrom])

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === 'Escape') {
      event.stopPropagation()
      onClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = focusableIn(dialogRef.current)
    if (focusable.length === 0) {
      event.preventDefault()
      return
    }
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || active === dialogRef.current)) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function handleBackdropMouseDown(event: MouseEvent<HTMLDivElement>) {
    if (event.target === event.currentTarget) onClose()
  }

  return createPortal(
    <div className={`modal-backdrop modal-backdrop--${variant}`} onMouseDown={handleBackdropMouseDown}>
      <div
        ref={dialogRef}
        className={`modal modal--${variant}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={describedBy}
        tabIndex={-1}
        onKeyDown={handleKeyDown}
      >
        <h2 id={titleId} className="modal__title">
          {title}
        </h2>
        {children}
      </div>
    </div>,
    document.body,
  )
}
