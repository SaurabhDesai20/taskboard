// UI preferences (theme, collapsed sidebar) kept in localStorage. Never auth data: the session
// lives only in the httpOnly cookie. Storage can be unavailable (private mode, blocked), so every
// access is guarded and falls back to the default.
import { useCallback, useState } from 'react'

const PREFIX = 'taskboard.'

export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(PREFIX + key)
  } catch {
    return null
  }
}

export function writePreference(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(PREFIX + key)
    else window.localStorage.setItem(PREFIX + key, value)
  } catch {
    // Not saved; the choice still applies until the page is reloaded.
  }
}

/** A boolean UI preference that survives reloads. */
export function useBooleanPreference(key: string, fallback: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(() => {
    const stored = readPreference(key)
    return stored === null ? fallback : stored === 'true'
  })
  const update = useCallback(
    (next: boolean) => {
      setValue(next)
      writePreference(key, String(next))
    },
    [key],
  )
  return [value, update]
}
