// Keyset cursor pagination like the backend's (contract 1.6), shared by the comment and activity
// mocks. Items are ordered by `created_at`, then `id`; the cursor is the position of the previous
// page's last item, opaque to clients (base64url JSON here).
import type { FieldError } from '../api/types'

export const DEFAULT_LIMIT = 20
export const MAX_LIMIT = 100
const INVALID_CURSOR = 'Invalid cursor'

/** What a cursor encodes: the last item's `created_at` and `id`. */
export interface CursorPosition {
  c: string
  id: string
}

interface Keyed {
  created_at: string
  id: string
}

export function encodeCursor(item: Keyed): string {
  const json = JSON.stringify({ c: item.created_at, id: item.id } satisfies CursorPosition)
  return btoa(json).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

export function decodeCursor(cursor: string): CursorPosition | null {
  try {
    const value: unknown = JSON.parse(atob(cursor.replace(/-/g, '+').replace(/_/g, '/')))
    if (typeof value === 'object' && value !== null && 'c' in value && 'id' in value) {
      const { c, id } = value
      if (typeof c === 'string' && typeof id === 'string' && !Number.isNaN(Date.parse(c))) return { c, id }
    }
  } catch {
    // Falls through to "invalid".
  }
  return null
}

/** `limit`: an integer from 1 to 100, 20 when absent; a bad one is reported in `errors`. */
export function readLimit(params: URLSearchParams, errors: FieldError[]): number {
  const raw = params.get('limit')
  if (raw === null) return DEFAULT_LIMIT
  const fail = (message: string) => {
    errors.push({ field: 'limit', location: 'query', message })
    return DEFAULT_LIMIT
  }
  if (!/^\s*[+-]?\d+\s*$/.test(raw)) return fail('Input should be a valid integer, unable to parse string as an integer')
  const limit = Number(raw)
  if (limit < 1) return fail('Input should be greater than or equal to 1')
  if (limit > MAX_LIMIT) return fail(`Input should be less than or equal to ${MAX_LIMIT}`)
  return limit
}

/** `cursor`: one this server issued, or null when absent; anything else is reported in `errors`. */
export function readCursor(params: URLSearchParams, errors: FieldError[]): CursorPosition | null {
  const raw = params.get('cursor')
  if (raw === null) return null
  const position = decodeCursor(raw)
  if (!position) errors.push({ field: 'cursor', location: 'query', message: INVALID_CURSOR })
  return position
}

/** Whether `item` comes after `position` in oldest-first order. */
export const isAfter = (item: Keyed, position: CursorPosition) =>
  item.created_at > position.c || (item.created_at === position.c && item.id > position.id)

/** Whether `item` comes after `position` in newest-first order. */
export const isBefore = (item: Keyed, position: CursorPosition) =>
  item.created_at < position.c || (item.created_at === position.c && item.id < position.id)

/**
 * One page of `ordered` (already sorted and filtered) after `cursor`: `follows` says whether an
 * item comes after the cursor in that order. `next_cursor` is null on the last page.
 */
export function paginate<T extends Keyed>(
  ordered: readonly T[],
  cursor: CursorPosition | null,
  limit: number,
  follows: (item: T, position: CursorPosition) => boolean,
): { items: T[]; next_cursor: string | null } {
  const remaining = cursor ? ordered.filter((item) => follows(item, cursor)) : [...ordered]
  const items = remaining.slice(0, limit)
  const last = items[items.length - 1]
  return { items, next_cursor: remaining.length > limit && last ? encodeCursor(last) : null }
}
