import { useCallback, useEffect, useRef } from 'react'

/** Whether the calling component is still mounted (for callbacks that run after a request). */
export function useIsMounted(): () => boolean {
  const mounted = useRef(false)
  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])
  return useCallback(() => mounted.current, [])
}
