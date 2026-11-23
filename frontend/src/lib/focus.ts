// Focus management for when the element that had focus goes away (a deleted row, a dialog whose
// opener was removed): focus moves to a nearby heading instead of falling back to the page body.

const FOCUSABLE = 'a[href], button, input, select, textarea, summary, [tabindex]'

/** The id of the app's `<main>` landmark (the skip link's target). */
export const MAIN_CONTENT_ID = 'main-content'

/** Moves focus to `element`; headings and regions are made focusable from script first (tabindex -1). */
export function focusElement(element: HTMLElement, options?: FocusOptions): void {
  if (!element.matches(FOCUSABLE)) element.setAttribute('tabindex', '-1')
  element.focus(options)
}

/**
 * The heading that names the closest `<section aria-labelledby>` around `element` (e.g. the
 * "Members" heading for a button in the members table), or null.
 */
export function sectionHeadingOf(element: Element | null): HTMLElement | null {
  const section = element?.closest('section[aria-labelledby]')
  const labelId = section?.getAttribute('aria-labelledby')?.split(' ')[0]
  const label = labelId ? document.getElementById(labelId) : null
  return label?.closest<HTMLElement>('h1, h2, h3, h4, h5, h6') ?? label
}

/** The page's main heading, or else the main landmark itself. */
export function mainFocusTarget(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(`#${MAIN_CONTENT_ID} h1`) ?? document.getElementById(MAIN_CONTENT_ID)
  )
}

/** Focuses the first candidate that is still in the document. Returns whether one was found. */
export function focusFirstConnected(
  candidates: readonly (HTMLElement | null | undefined)[],
  options?: FocusOptions,
): boolean {
  const target = candidates.find((candidate) => candidate?.isConnected)
  if (!target) return false
  focusElement(target, options)
  return true
}
