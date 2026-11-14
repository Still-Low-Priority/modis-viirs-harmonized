import { describe, expect, it } from 'vitest'
import { formatCompact, formatCoord, formatDateTimeUtc, formatDay, formatFrp, formatNumber } from './format'

// Intl output uses NBSP / narrow NBSP in some locales; normalise for readable assertions.
const norm = (s: string) => s.replace(/[  ]/g, ' ')

describe('formatNumber', () => {
  it('groups thousands with a comma in en', () => expect(formatNumber(1234567, 'en')).toBe('1,234,567'))
  it('rounds to integers by default', () => expect(formatNumber(2.6, 'en')).toBe('3'))
  it('formats zero and negatives', () => {
    expect(formatNumber(0, 'en')).toBe('0')
    expect(formatNumber(-1500, 'en')).toBe('-1,500')
  })
})

describe('formatCompact', () => {
  it('leaves small numbers alone', () => expect(formatCompact(999, 'en')).toBe('999'))
  // en-GB prints a lowercase suffix ('12.4k'), unlike the '12.4K' in the doc comment of formatCompact.
  it('uses k for thousands with one decimal in en', () => expect(formatCompact(12_400, 'en')).toBe('12.4k'))
  it('uses m for millions in en', () => expect(formatCompact(3_200_000, 'en')).toBe('3.2m'))
})

describe('formatDay', () => {
  it('formats en-GB style day month year', () => expect(formatDay('2026-08-15', 'en')).toBe('15 Aug 2026'))
  it('does not shift the day for the first and last day of the year', () => {
    expect(formatDay('2026-01-01', 'en')).toBe('1 Jan 2026')
    expect(formatDay('2026-12-31', 'en')).toBe('31 Dec 2026')
  })
  it('accepts custom options and still uses UTC', () => {
    expect(formatDay('2026-08-01', 'en', { month: 'long' })).toBe('August')
  })
})

describe('formatDateTimeUtc', () => {
  it('prints the UTC wall time and a UTC suffix', () => {
    expect(norm(formatDateTimeUtc('2026-08-15T11:20:00Z', 'en'))).toBe('15 Aug 2026, 11:20 UTC')
  })
  it('converts an offset timestamp to UTC', () => {
    expect(norm(formatDateTimeUtc('2026-08-15T13:20:00+02:00', 'en'))).toBe('15 Aug 2026, 11:20 UTC')
  })
  it('shows midnight as 00:00, not 24:00', () => {
    expect(norm(formatDateTimeUtc('2026-08-15T00:05:00Z', 'en'))).toBe('15 Aug 2026, 00:05 UTC')
  })
  it('rolls the date at UTC midnight', () => {
    expect(norm(formatDateTimeUtc('2026-12-31T23:59:00Z', 'en'))).toBe('31 Dec 2026, 23:59 UTC')
    expect(norm(formatDateTimeUtc('2027-01-01T00:00:00Z', 'en'))).toBe('1 Jan 2027, 00:00 UTC')
  })
})

describe('formatCoord', () => {
  it('formats north-east', () => expect(formatCoord(50.4501, 30.5234)).toBe('50.4501°N, 30.5234°E'))
  it('formats north-west', () => expect(formatCoord(40.7128, -74.006)).toBe('40.7128°N, 74.0060°W'))
  it('formats south-east', () => expect(formatCoord(-33.8688, 151.2093)).toBe('33.8688°S, 151.2093°E'))
  it('formats south-west', () => expect(formatCoord(-12.0464, -77.0428)).toBe('12.0464°S, 77.0428°W'))
  it('treats 0,0 as N and E', () => expect(formatCoord(0, 0)).toBe('0.0000°N, 0.0000°E'))
  it('pads to four decimals', () => expect(formatCoord(1, 2)).toBe('1.0000°N, 2.0000°E'))
  it('formats the poles and antimeridian', () => {
    expect(formatCoord(90, 180)).toBe('90.0000°N, 180.0000°E')
    expect(formatCoord(-90, -180)).toBe('90.0000°S, 180.0000°W')
  })
  // A tiny negative value rounds to zero but keeps a hemisphere letter of the wrong side: "0.0000°S".
  it('does not print a southern hemisphere for a coordinate that rounds to 0.0000', () => {
    expect(formatCoord(-0.00001, -0.00001)).toBe('0.0000°N, 0.0000°E')
  })
})

describe('formatFrp', () => {
  it('uses one decimal and MW', () => expect(formatFrp(12.34, 'en')).toBe('12.3 MW'))
  it('does not add trailing zeros', () => expect(formatFrp(5, 'en')).toBe('5 MW'))
  it('groups large values', () => expect(formatFrp(1234.56, 'en')).toBe('1,234.6 MW'))
  it('formats zero', () => expect(formatFrp(0, 'en')).toBe('0 MW'))
})
