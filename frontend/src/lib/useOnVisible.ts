import { useEffect, useRef, useState } from 'react'

/** How far below the visible area the element may be and still count (start loading early). */
const LOOKAHEAD = '0px 0px 200px 0px'

/**
 * Calls `onVisible` when the element given to the returned ref callback scrolls into view (or
 * close to it), for infinite scrolling: put it after a list and load more. Watches only while
 * `enabled`, and checks again each time it becomes enabled, so a short list that still shows
 * the element after a load keeps loading. Without `IntersectionObserver` it never fires: keep a
 * button next to it that does the same.
 */
export function useOnVisible(onVisible: () => void, enabled: boolean): (element: Element | null) => void {
  const [element, setElement] = useState<Element | null>(null)
  // The latest callback, so a new one each render does not restart the observer.
  const callback = useRef(onVisible)
  useEffect(() => {
    callback.current = onVisible
  })

  useEffect(() => {
    if (!enabled || !element || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) callback.current()
      },
      { rootMargin: LOOKAHEAD },
    )
    observer.observe(element)
    return () => observer.disconnect()
  }, [enabled, element])

  return setElement
}
