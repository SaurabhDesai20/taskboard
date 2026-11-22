import { useEffect, useState } from 'react'

/**
 * The current time, refreshed every `intervalMs` (a minute by default), so relative timestamps
 * ("5 minutes ago") keep up while a view stays open. One clock per list, not one per row.
 */
export function useNow(intervalMs = 60_000): Date {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}
