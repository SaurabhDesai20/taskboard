// Date display helpers. API timestamps are ISO 8601 UTC (contract 1.2); they are shown in the
// user's locale and time zone.

const DATE_FORMAT = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' })

/** "Nov 22, 2026" (in the user's locale). */
export function formatDate(timestamp: string): string {
  return DATE_FORMAT.format(new Date(timestamp))
}
