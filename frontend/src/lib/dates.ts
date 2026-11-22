// Date display helpers. API timestamps are ISO 8601 UTC (contract 1.2); they are shown in the
// user's locale and time zone. Calendar dates (`due_date`, `YYYY-MM-DD`) have no time or zone:
// they are read and compared as local calendar days, never through `new Date('YYYY-MM-DD')`
// (which means UTC midnight, the previous day west of Greenwich).

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/** "Nov 22, 2026" (in the user's locale). */
export function formatDate(timestamp: string): string {
  return DATE_FORMAT.format(new Date(timestamp))
}

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/

function pad(value: number, length = 2): string {
  return String(value).padStart(length, '0')
}

/** A local calendar day as `YYYY-MM-DD`. */
export function toDateOnly(date: Date): string {
  return `${pad(date.getFullYear(), 4)}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

/** Today in the user's time zone, as `YYYY-MM-DD`. */
export function todayDateOnly(now: Date = new Date()): string {
  return toDateOnly(now)
}

/** The local midnight of a `YYYY-MM-DD` date, or null when it is not a real calendar date. */
export function parseDateOnly(value: string): Date | null {
  const match = DATE_ONLY_PATTERN.exec(value)
  if (!match) return null
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(year, month - 1, day)
  // Rejects overflow such as 2026-02-30 (which Date would roll into March).
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null
  return date
}

export function isValidDateOnly(value: string): boolean {
  return parseDateOnly(value) !== null
}

/** `YYYY-MM-DD` plus `days` (negative to go back). */
export function addDays(dateOnly: string, days: number): string {
  const date = parseDateOnly(dateOnly)
  if (!date) throw new Error(`Not a YYYY-MM-DD date: ${dateOnly}`)
  date.setDate(date.getDate() + days)
  return toDateOnly(date)
}

/** "Dec 1, 2026" for `2026-12-01` (in the user's locale); the raw value if it is not a date. */
export function formatDateOnly(dateOnly: string): string {
  const date = parseDateOnly(dateOnly)
  return date ? DATE_FORMAT.format(date) : dateOnly
}

// ---------------------------------------------------------------------------------------------
// Timestamps: exact and relative ("5 minutes ago")
// ---------------------------------------------------------------------------------------------

const DATE_TIME_FORMAT = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' })

/** "Nov 22, 2026, 9:30 AM" (in the user's locale and time zone). */
export function formatDateTime(timestamp: string): string {
  return DATE_TIME_FORMAT.format(new Date(timestamp))
}

const MINUTE_MS = 60_000
const HOUR_MS = 60 * MINUTE_MS
const DAY_MS = 24 * HOUR_MS

/** Whole calendar days from `earlier` to `later` in the local time zone (DST days count as one). */
function calendarDaysBetween(earlier: Date, later: Date): number {
  const start = new Date(earlier.getFullYear(), earlier.getMonth(), earlier.getDate())
  const end = new Date(later.getFullYear(), later.getMonth(), later.getDate())
  return Math.round((end.getTime() - start.getTime()) / DAY_MS)
}

/** Whole calendar months from `earlier` to `later` (Jan 31 to Feb 28 is 0, to Mar 1 is 1). */
function calendarMonthsBetween(earlier: Date, later: Date): number {
  const months = (later.getFullYear() - earlier.getFullYear()) * 12 + later.getMonth() - earlier.getMonth()
  return later.getDate() < earlier.getDate() ? months - 1 : months
}

const relativeFormats = new Map<string, Intl.RelativeTimeFormat>()

/** `numeric: 'auto'` says "yesterday" and "last week" instead of "1 day ago" and "1 week ago". */
function relativeFormat(locale: string | undefined): Intl.RelativeTimeFormat {
  const cacheKey = locale ?? ''
  let format = relativeFormats.get(cacheKey)
  if (!format) {
    format = new Intl.RelativeTimeFormat(locale, { numeric: 'auto' })
    relativeFormats.set(cacheKey, format)
  }
  return format
}

/**
 * How long before `now` a timestamp was: "just now" (under a minute), "5 minutes ago",
 * "3 hours ago" (under a day), then by calendar day: "yesterday", "4 days ago", "last week",
 * "3 weeks ago", "last month", "5 months ago", "last year", "2 years ago". A time after `now`
 * (the device clock is behind the server's) is "just now". Show the exact time next to it, e.g.
 * as a tooltip: see `formatDateTime`.
 */
export function formatRelativeTime(timestamp: string, now: Date = new Date(), locale?: string): string {
  const then = new Date(timestamp)
  const elapsed = now.getTime() - then.getTime()
  if (Number.isNaN(elapsed)) return timestamp
  if (elapsed < MINUTE_MS) return 'just now'

  const format = relativeFormat(locale)
  if (elapsed < HOUR_MS) return format.format(-Math.floor(elapsed / MINUTE_MS), 'minute')
  if (elapsed < DAY_MS) return format.format(-Math.floor(elapsed / HOUR_MS), 'hour')

  const days = Math.max(1, calendarDaysBetween(then, now))
  if (days < 7) return format.format(-days, 'day')
  if (days < 30) return format.format(-Math.floor(days / 7), 'week')
  const months = Math.max(1, calendarMonthsBetween(then, now))
  if (months < 12) return format.format(-months, 'month')
  return format.format(-Math.floor(months / 12), 'year')
}
