import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { focusFirstConnected, mainFocusTarget } from '../lib/focus'
import {
  MAX_TOASTS,
  TOAST_DURATIONS,
  ToastContext,
  type ToastOptions,
  type Toasts,
  type ToastTone,
} from './toastContext'

/** A toast resumed after a pause gets at least this long. */
const MIN_REMAINING_MS = 1500

const TOAST_ICONS: Readonly<Record<ToastTone, string>> = { success: '✓', info: 'i', error: '!' }

interface Toast {
  id: number
  message: string
  tone: ToastTone
  duration: number
}

/**
 * Provides `useToast()` and renders the toasts. The two live regions (polite, assertive) are in
 * the page from the start, so screen readers announce each toast as it is added. Toasts close by
 * themselves, except while the pointer is over them or focus is in them; Escape or the
 * dismiss button closes one at once.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const lastId = useRef(0)

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), [])

  const show = useCallback((message: string, { tone = 'info', duration }: ToastOptions = {}) => {
    lastId.current += 1
    const toast: Toast = { id: lastId.current, message, tone, duration: duration ?? TOAST_DURATIONS[tone] }
    setToasts((list) => [...list, toast].slice(-MAX_TOASTS))
  }, [])

  const api = useMemo<Toasts>(
    () => ({
      show,
      success: (message) => show(message, { tone: 'success' }),
      error: (message) => show(message, { tone: 'error' }),
    }),
    [show],
  )

  return (
    <ToastContext.Provider value={api}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  )
}

interface ToastViewportProps {
  toasts: readonly Toast[]
  onDismiss: (id: number) => void
}

function ToastViewport({ toasts, onDismiss }: ToastViewportProps) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const regionRef = useRef<HTMLDivElement>(null)
  // Where focus was before it came into the toasts, to go back there.
  const focusOrigin = useRef<HTMLElement | null>(null)
  const paused = hovered || focused

  // Closing the toast that has focus: focus goes to the next toast, else back where it came from.
  const dismissWithFocus = useCallback(
    (id: number) => {
      const buttons = Array.from(regionRef.current?.querySelectorAll<HTMLButtonElement>('.toast__dismiss') ?? [])
      const index = buttons.findIndex((button) => button.dataset.toastId === String(id))
      if (index !== -1 && buttons[index] === document.activeElement) {
        const next = buttons[index + 1] ?? buttons[index - 1]
        if (next) next.focus({ preventScroll: true })
        else focusFirstConnected([focusOrigin.current, mainFocusTarget()], { preventScroll: true })
      }
      onDismiss(id)
    },
    [onDismiss],
  )

  const focusLost = useCallback(() => setFocused(false), [])

  function handleFocus(event: FocusEvent<HTMLElement>) {
    const from = event.relatedTarget
    if (from instanceof HTMLElement && !event.currentTarget.contains(from)) focusOrigin.current = from
    setFocused(true)
  }

  function handleBlur(event: FocusEvent<HTMLElement>) {
    if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(false)
  }

  const item = (toast: Toast) => (
    <ToastItem
      key={toast.id}
      toast={toast}
      paused={paused}
      onTimeout={onDismiss}
      onDismiss={dismissWithFocus}
      onHover={setHovered}
      onFocusLost={focusLost}
    />
  )

  // Not a landmark: the live regions do the announcing, and an always-present empty region would
  // only clutter the landmark list.
  return createPortal(
    <div ref={regionRef} className="toasts" onFocus={handleFocus} onBlur={handleBlur}>
      <ol className="toasts__list" aria-live="assertive" aria-label="Error notifications">
        {toasts.filter((toast) => toast.tone === 'error').map(item)}
      </ol>
      <ol className="toasts__list" aria-live="polite" aria-label="Notifications">
        {toasts.filter((toast) => toast.tone !== 'error').map(item)}
      </ol>
    </div>,
    document.body,
  )
}

interface ToastItemProps {
  toast: Toast
  paused: boolean
  onTimeout: (id: number) => void
  onDismiss: (id: number) => void
  onHover: (hovered: boolean) => void
  onFocusLost: () => void
}

function ToastItem({ toast, paused, onTimeout, onDismiss, onHover, onFocusLost }: ToastItemProps) {
  const remaining = useRef(toast.duration)
  // A toast removed under the pointer or with focus in it gets no mouseleave or blur event.
  const hovered = useRef(false)
  const focused = useRef(false)
  useEffect(
    () => () => {
      if (hovered.current) onHover(false)
      if (focused.current) onFocusLost()
    },
    [onHover, onFocusLost],
  )

  // Counts down only while not paused; a pause keeps the time that was left.
  useEffect(() => {
    if (paused) return undefined
    const started = Date.now()
    const timer = window.setTimeout(() => onTimeout(toast.id), remaining.current)
    return () => {
      window.clearTimeout(timer)
      remaining.current = Math.max(MIN_REMAINING_MS, remaining.current - (Date.now() - started))
    }
  }, [paused, toast.id, onTimeout])

  function handleKeyDown(event: KeyboardEvent<HTMLLIElement>) {
    if (event.key !== 'Escape') return
    event.stopPropagation()
    onDismiss(toast.id)
  }

  return (
    <li
      className={`toast toast--${toast.tone}`}
      onMouseEnter={() => {
        hovered.current = true
        onHover(true)
      }}
      onMouseLeave={() => {
        hovered.current = false
        onHover(false)
      }}
      onFocus={() => {
        focused.current = true
      }}
      onBlur={() => {
        focused.current = false
      }}
      onKeyDown={handleKeyDown}
    >
      {toast.tone === 'error' ? <span className="visually-hidden">Error: </span> : null}
      <span className="toast__icon" aria-hidden="true">
        {TOAST_ICONS[toast.tone]}
      </span>
      <p className="toast__message">{toast.message}</p>
      <button
        type="button"
        className="toast__dismiss"
        aria-label="Dismiss notification"
        data-toast-id={toast.id}
        onClick={() => onDismiss(toast.id)}
      >
        <span aria-hidden="true">×</span>
      </button>
    </li>
  )
}
