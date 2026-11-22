import { formatDateTime, formatRelativeTime } from '../lib/dates'

interface RelativeTimeProps {
  /** ISO 8601 UTC timestamp from the API. */
  timestamp: string
  /** The time to count from (see `useNow`). */
  now: Date
}

/** "5 minutes ago", with the exact date and time as a tooltip and in `dateTime`. */
export function RelativeTime({ timestamp, now }: RelativeTimeProps) {
  return (
    <time dateTime={timestamp} title={formatDateTime(timestamp)}>
      {formatRelativeTime(timestamp, now)}
    </time>
  )
}
