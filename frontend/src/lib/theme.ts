// Light and dark themes. Without a saved choice the CSS follows the system (prefers-color-scheme);
// a choice made with the header toggle is saved and set as <html data-theme="...">.
import { useCallback, useState, useSyncExternalStore } from 'react'
import { readPreference, writePreference } from './preferences'

export type Theme = 'light' | 'dark'

const THEME_KEY = 'theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

export function isTheme(value: unknown): value is Theme {
  return value === 'light' || value === 'dark'
}

/** The theme chosen with the toggle, or null to follow the system. */
export function storedTheme(): Theme | null {
  const value = readPreference(THEME_KEY)
  return isTheme(value) ? value : null
}

/** Sets `data-theme` on <html> (null removes it, so the CSS follows the system again). */
export function applyTheme(theme: Theme | null): void {
  const root = document.documentElement
  if (theme) root.dataset.theme = theme
  else delete root.dataset.theme
}

const hasMatchMedia = () => typeof window !== 'undefined' && typeof window.matchMedia === 'function'

function subscribeToSystemTheme(onChange: () => void): () => void {
  if (!hasMatchMedia()) return () => {}
  const query = window.matchMedia(DARK_QUERY)
  query.addEventListener('change', onChange)
  return () => query.removeEventListener('change', onChange)
}

function systemPrefersDark(): boolean {
  return hasMatchMedia() && window.matchMedia(DARK_QUERY).matches
}

/** The theme in effect (saved choice, else the system's) and a setter that saves and applies it. */
export function useTheme(): [Theme, (theme: Theme) => void] {
  const [chosen, setChosen] = useState<Theme | null>(storedTheme)
  const systemDark = useSyncExternalStore(subscribeToSystemTheme, systemPrefersDark, () => false)
  const setTheme = useCallback((theme: Theme) => {
    setChosen(theme)
    applyTheme(theme)
    writePreference(THEME_KEY, theme)
  }, [])
  return [chosen ?? (systemDark ? 'dark' : 'light'), setTheme]
}
