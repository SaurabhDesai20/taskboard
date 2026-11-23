import { within } from '@testing-library/react'

/** Queries scoped to the toasts (both live regions). */
export function toasts() {
  const container = document.querySelector<HTMLElement>('.toasts')
  if (!container) throw new Error('No toast container: render inside <AppProviders>')
  return within(container)
}

/** Waits for a toast with this message. */
export function findToast(message: string | RegExp) {
  return toasts().findByText(message)
}

/** The live region a toast is announced in: "polite" or "assertive". */
export function liveRegionOf(element: HTMLElement): string | null {
  return element.closest('[aria-live]')?.getAttribute('aria-live') ?? null
}
