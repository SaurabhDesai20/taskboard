import { createContext, useCallback, useContext } from 'react'
import { useIsMounted } from '../lib/useIsMounted'

/** `success` and `info` are announced politely; `error` assertively. */
export type ToastTone = 'success' | 'error' | 'info'

/** How long a toast stays, by tone: errors stay longer. */
export const TOAST_DURATIONS: Readonly<Record<ToastTone, number>> = { success: 5000, info: 5000, error: 10000 }

/** At most this many at once; the oldest goes first. */
export const MAX_TOASTS = 4

export interface ToastOptions {
  tone?: ToastTone
  /** Milliseconds before it closes by itself (paused while hovered or focused). */
  duration?: number
}

export interface Toasts {
  show: (message: string, options?: ToastOptions) => void
  success: (message: string) => void
  error: (message: string) => void
}

const NO_TOASTS: Toasts = { show: () => {}, success: () => {}, error: () => {} }

export const ToastContext = createContext<Toasts | null>(null)

/**
 * Short confirmations and errors shown in the corner of the screen (see ToastProvider). Outside
 * a provider (a hook tested on its own) toasts are silently dropped.
 */
export function useToast(): Toasts {
  return useContext(ToastContext) ?? NO_TOASTS
}

/**
 * For mutations whose errors are shown inline, next to the control that started them: if that
 * component is gone by the time the request fails (e.g. the task drawer was closed meanwhile),
 * the returned function reports the error in a toast instead, so it is never lost. While the
 * component is still there it does nothing.
 */
export function useErrorToastWhenUnmounted(): (message: string, error: unknown) => void {
  const toast = useToast()
  const isMounted = useIsMounted()
  return useCallback(
    (message: string, error: unknown) => {
      if (isMounted()) return
      const reason = error instanceof Error && error.message ? ` ${error.message}` : ''
      toast.error(`${message}${reason}`)
    },
    [toast, isMounted],
  )
}
