import { useEffect } from 'react'

export const APP_NAME = 'TaskBoard'

/** "Website · Acme · TaskBoard"; just "TaskBoard" without parts. */
export function documentTitle(parts: readonly (string | null | undefined)[]): string {
  return [...parts.filter((part): part is string => Boolean(part)), APP_NAME].join(' · ')
}

/**
 * Names the page in the browser tab and for screen readers (WCAG 2.4.2), most specific part
 * first. Every routed page sets one, so the title always follows the page.
 */
export function useDocumentTitle(...parts: (string | null | undefined)[]): void {
  const title = documentTitle(parts)
  useEffect(() => {
    document.title = title
  }, [title])
}
