// Where to send the user after they sign in. RequireAuth stores the page they asked for in the
// router location state (never in the URL, so it cannot be used as an open redirect).
import type { Location } from 'react-router'

export interface AuthRedirectState {
  from?: Pick<Location, 'pathname' | 'search' | 'hash'>
}

const AUTH_PAGES = new Set(['/login', '/register'])

export function redirectStateFor(location: Location): AuthRedirectState {
  return { from: { pathname: location.pathname, search: location.search, hash: location.hash } }
}

function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/** The remembered in-app path from `location.state`, or `/`. */
export function redirectTargetFrom(state: unknown): string {
  if (typeof state !== 'object' || state === null || !('from' in state)) return '/'
  const { from } = state
  if (typeof from !== 'object' || from === null || !('pathname' in from)) return '/'
  const { pathname } = from
  const search = 'search' in from && isString(from.search) ? from.search : ''
  const hash = 'hash' in from && isString(from.hash) ? from.hash : ''
  if (!isString(pathname) || !pathname.startsWith('/') || pathname.startsWith('//')) return '/'
  if (AUTH_PAGES.has(pathname)) return '/'
  return `${pathname}${search}${hash}`
}
