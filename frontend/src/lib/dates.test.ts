import { describe, expect, it } from 'vitest'
import { addDays, clampDay, dayFromIndex, dayIndex, daysBetween, eachDay, isValidDay, parseDay, toDay } from './dates'

describe('toDay / parseDay', () => {
  it('formats a fixed instant as its UTC day regardless of local timezone', () => {
    expect(toDay(new Date('2026-03-01T23:59:59Z'))).toBe('2026-03-01')
    expect(toDay(new Date('2026-03-02T00:00:00Z'))).toBe('2026-03-02')
  })
  it('parses a day as UTC midnight', () => {
    expect(parseDay('2026-08-15').toISOString()).toBe('2026-08-15T00:00:00.000Z')
  })
})

describe('dayIndex / dayFromIndex', () => {
  it('has the Unix epoch as index 0', () => {
    expect(dayIndex('1970-01-01')).toBe(0)
    expect(dayFromIndex(0)).toBe('1970-01-01')
  })
  it('handles days before the epoch', () => {
    expect(dayIndex('1969-12-31')).toBe(-1)
    expect(dayFromIndex(-1)).toBe('1969-12-31')
  })
  it('knows a fixed modern index', () => {
    expect(dayIndex('2000-01-01')).toBe(10957)
    expect(dayIndex('2026-01-01')).toBe(20454)
  })
  it.each(['2015-01-01', '2020-02-29', '2024-12-31', '2026-08-15', '1999-12-31'])('round-trips %s', (d) => {
    expect(dayFromIndex(dayIndex(d))).toBe(d)
  })
})

describe('addDays', () => {
  it('adds zero', () => expect(addDays('2026-05-05', 0)).toBe('2026-05-05'))
  it('crosses a month boundary forward and back', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
  })
  it('crosses a year boundary forward and back', () => {
    expect(addDays('2025-12-31', 1)).toBe('2026-01-01')
    expect(addDays('2026-01-01', -1)).toBe('2025-12-31')
  })
  it('handles the leap day', () => {
    expect(addDays('2024-02-28', 1)).toBe('2024-02-29')
    expect(addDays('2024-02-29', 1)).toBe('2024-03-01')
    expect(addDays('2023-02-28', 1)).toBe('2023-03-01')
    expect(addDays('2024-03-01', -1)).toBe('2024-02-29')
  })
  it('adds a full leap year and a full common year', () => {
    expect(addDays('2024-01-01', 366)).toBe('2025-01-01')
    expect(addDays('2025-01-01', 365)).toBe('2026-01-01')
  })
  it('does not skip or repeat a day across DST-change dates', () => {
    expect(addDays('2026-03-28', 1)).toBe('2026-03-29')
    expect(addDays('2026-03-29', 1)).toBe('2026-03-30')
    expect(addDays('2026-10-24', 1)).toBe('2026-10-25')
    expect(addDays('2026-10-25', 1)).toBe('2026-10-26')
    expect(addDays('2026-03-08', 1)).toBe('2026-03-09')
    expect(addDays('2026-11-01', 1)).toBe('2026-11-02')
  })
})

describe('daysBetween', () => {
  it('is 1 for the same day (inclusive)', () => expect(daysBetween('2026-05-05', '2026-05-05')).toBe(1))
  it('is 2 for adjacent days', () => expect(daysBetween('2026-05-05', '2026-05-06')).toBe(2))
  it('counts a leap year as 366 days', () => expect(daysBetween('2024-01-01', '2024-12-31')).toBe(366))
  it('counts a common year as 365 days', () => expect(daysBetween('2025-01-01', '2025-12-31')).toBe(365))
  it('is 0 when to is the day before from', () => expect(daysBetween('2026-05-05', '2026-05-04')).toBe(0))
})

describe('eachDay', () => {
  it('returns a single day when from === to', () => expect(eachDay('2026-05-05', '2026-05-05')).toEqual(['2026-05-05']))
  it('lists inclusive days across a month end', () => {
    expect(eachDay('2026-01-30', '2026-02-02')).toEqual(['2026-01-30', '2026-01-31', '2026-02-01', '2026-02-02'])
  })
  it('includes the leap day', () => {
    expect(eachDay('2024-02-28', '2024-03-01')).toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
  })
  it('is empty for a reversed range', () => expect(eachDay('2026-05-06', '2026-05-05')).toEqual([]))
  it('length equals daysBetween', () => {
    expect(eachDay('2025-12-20', '2026-01-10')).toHaveLength(daysBetween('2025-12-20', '2026-01-10'))
  })
})

describe('clampDay', () => {
  it('returns the day when inside', () => expect(clampDay('2026-05-05', '2026-05-01', '2026-05-31')).toBe('2026-05-05'))
  it('clamps below min', () => expect(clampDay('2026-04-30', '2026-05-01', '2026-05-31')).toBe('2026-05-01'))
  it('clamps above max', () => expect(clampDay('2026-06-01', '2026-05-01', '2026-05-31')).toBe('2026-05-31'))
  it('keeps the bounds themselves', () => {
    expect(clampDay('2026-05-01', '2026-05-01', '2026-05-31')).toBe('2026-05-01')
    expect(clampDay('2026-05-31', '2026-05-01', '2026-05-31')).toBe('2026-05-31')
  })
})

describe('isValidDay', () => {
  it.each(['2026-08-15', '2024-02-29', '2026-12-31', '2026-01-01'])('accepts %s', (d) => expect(isValidDay(d)).toBe(true))
  it.each(['', '2026-8-15', '15-08-2026', '2026-08-15T00:00:00Z', 'abc', '2026-13-01', '2026-00-10', '2026-08-32'])(
    'rejects malformed %j',
    (d) => expect(isValidDay(d)).toBe(false),
  )
  // BUG: parseDay uses the Date constructor which rolls 2026-02-30 over to 2026-03-02, so isValidDay says true.
  it('rejects a non-existent calendar date 2026-02-30', () => {
    expect(isValidDay('2026-02-30')).toBe(false)
  })
  it('rejects 2026-02-29 (not a leap year)', () => {
    expect(isValidDay('2026-02-29')).toBe(false)
  })
  it('rejects 2026-04-31', () => {
    expect(isValidDay('2026-04-31')).toBe(false)
  })
})
