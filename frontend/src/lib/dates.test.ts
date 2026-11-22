import { describe, expect, it } from 'vitest'
import {
  addDays,
  formatDateOnly,
  formatDateTime,
  formatRelativeTime,
  isValidDateOnly,
  parseDateOnly,
  toDateOnly,
  todayDateOnly,
} from './dates'

describe('calendar dates (YYYY-MM-DD)', () => {
  it('writes a local calendar day', () => {
    expect(toDateOnly(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05')
    expect(todayDateOnly(new Date(2026, 10, 22, 0, 1))).toBe('2026-11-22')
  })

  it('parses to local midnight and rejects impossible dates', () => {
    const date = parseDateOnly('2026-12-01')
    expect(date?.getFullYear()).toBe(2026)
    expect(date?.getMonth()).toBe(11)
    expect(date?.getDate()).toBe(1)
    expect(date?.getHours()).toBe(0)
    for (const bad of ['2026-02-30', '2026-13-01', '2026-1-1', '01/12/2026', '']) {
      expect(isValidDateOnly(bad)).toBe(false)
    }
  })

  it('adds days across months and years', () => {
    expect(addDays('2026-11-22', 9)).toBe('2026-12-01')
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(() => addDays('nope', 1)).toThrow()
  })

  it('formats the same calendar day in any time zone (never through UTC midnight)', () => {
    const expected = new Intl.DateTimeFormat(undefined, { year: 'numeric', month: 'short', day: 'numeric' }).format(
      new Date(2026, 11, 1),
    )
    expect(formatDateOnly('2026-12-01')).toBe(expected)
    expect(formatDateOnly('not a date')).toBe('not a date')
  })
})

describe('relative timestamps', () => {
  // A fixed clock: Sunday, Nov 22, 2026, 12:00 local time.
  const now = new Date(2026, 10, 22, 12, 0, 0)
  const before = (ms: number) => new Date(now.getTime() - ms).toISOString()
  const at = (...parts: [number, number, number, number?, number?]) => new Date(...parts).toISOString()
  const relative = (timestamp: string) => formatRelativeTime(timestamp, now, 'en-US')
  const SECOND = 1000
  const MINUTE = 60 * SECOND
  const HOUR = 60 * MINUTE

  it('says "just now" under a minute, and for times ahead of the device clock', () => {
    expect(relative(before(0))).toBe('just now')
    expect(relative(before(59 * SECOND))).toBe('just now')
    expect(relative(before(-5 * MINUTE))).toBe('just now')
  })

  it('counts minutes, then hours, within the last day', () => {
    expect(relative(before(MINUTE))).toBe('1 minute ago')
    expect(relative(before(5 * MINUTE + 30 * SECOND))).toBe('5 minutes ago')
    expect(relative(before(59 * MINUTE))).toBe('59 minutes ago')
    expect(relative(before(HOUR))).toBe('1 hour ago')
    expect(relative(before(23 * HOUR + 59 * MINUTE))).toBe('23 hours ago')
  })

  it('counts calendar days after that: yesterday, then days', () => {
    expect(relative(at(2026, 10, 21, 9))).toBe('yesterday')
    expect(relative(at(2026, 10, 20, 23, 30))).toBe('2 days ago')
    expect(relative(at(2026, 10, 16, 12))).toBe('6 days ago')
  })

  it('switches to weeks, months and years', () => {
    expect(relative(at(2026, 10, 15, 12))).toBe('last week')
    expect(relative(at(2026, 10, 1, 8))).toBe('3 weeks ago')
    expect(relative(at(2026, 9, 20, 8))).toBe('last month')
    expect(relative(at(2026, 4, 30))).toBe('5 months ago')
    expect(relative(at(2025, 10, 1))).toBe('last year')
    expect(relative(at(2023, 0, 1))).toBe('3 years ago')
  })

  it('uses the current time by default and leaves an unreadable value as it is', () => {
    expect(formatRelativeTime(new Date().toISOString())).toBe('just now')
    expect(formatRelativeTime('not a time', now)).toBe('not a time')
  })

  it('formats the exact time in the user locale', () => {
    const timestamp = '2026-11-22T09:30:00Z'
    const expected = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(timestamp),
    )
    expect(formatDateTime(timestamp)).toBe(expected)
  })
})
