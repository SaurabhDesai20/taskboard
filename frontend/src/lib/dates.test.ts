import { describe, expect, it } from 'vitest'
import { addDays, formatDateOnly, isValidDateOnly, parseDateOnly, toDateOnly, todayDateOnly } from './dates'

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
