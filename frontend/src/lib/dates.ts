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
