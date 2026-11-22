import { useTheme } from '../lib/theme'

/**
 * The header's dark theme switch: a toggle button (aria-pressed). The choice is saved in
 * localStorage; until one is made the theme follows the system setting.
 */
export function ThemeToggle() {
  const [theme, setTheme] = useTheme()
  const dark = theme === 'dark'
  return (
    <button
      type="button"
      className="theme-toggle"
      aria-pressed={dark}
      title={dark ? 'Dark theme is on' : 'Dark theme is off'}
      onClick={() => setTheme(dark ? 'light' : 'dark')}
    >
      <svg className="theme-toggle__icon" aria-hidden="true" viewBox="0 0 16 16" width="16" height="16">
        {dark ? (
          <path d="M9.6 1.6a6.5 6.5 0 1 0 4.8 9.9A5.5 5.5 0 0 1 9.6 1.6z" fill="currentColor" />
        ) : (
          <g fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <circle cx="8" cy="8" r="3" />
            <path d="M8 1v1.5M8 13.5V15M1 8h1.5M13.5 8H15M3 3l1 1M12 12l1 1M3 13l1-1M12 4l1-1" />
          </g>
        )}
      </svg>
      <span className="visually-hidden">Dark theme</span>
    </button>
  )
}
