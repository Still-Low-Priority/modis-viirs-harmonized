// Pure layout maths for the activity calendar. All dates are UTC YYYY-MM-DD strings.
import { addDays, dayIndex, parseDay } from '../../lib/dates'

/** Monday = 0 ... Sunday = 6. */
export function weekdayIndex(day: string): number {
  return (parseDay(day).getUTCDay() + 6) % 7
}

export function yearOf(day: string): number {
  return Number(day.slice(0, 4))
}

export function yearStart(year: number): string {
  return `${String(year).padStart(4, '0')}-01-01`
}

export function yearEnd(year: number): string {
  return `${String(year).padStart(4, '0')}-12-31`
}

export function daysInYear(year: number): number {
  return dayIndex(yearEnd(year)) - dayIndex(yearStart(year)) + 1
}

/** Week columns (Monday first). Entries outside the year are null. */
export function buildWeeks(year: number): (string | null)[][] {
  const first = yearStart(year)
  const total = daysInYear(year)
  const offset = weekdayIndex(first)
  const cols = Math.ceil((offset + total) / 7)
  const weeks: (string | null)[][] = []
  for (let c = 0; c < cols; c++) {
    const col: (string | null)[] = []
    for (let r = 0; r < 7; r++) {
      const n = c * 7 + r - offset
      col.push(n >= 0 && n < total ? addDays(first, n) : null)
    }
    weeks.push(col)
  }
  return weeks
}

export interface MonthLabel {
  /** 0-based month. */
  month: number
  /** Week column holding the first day of the month. */
  col: number
  from: string
  to: string
}

export function monthLabels(year: number): MonthLabel[] {
  const weeks = buildWeeks(year)
  const out: MonthLabel[] = []
  for (let m = 0; m < 12; m++) {
    const mm = String(m + 1).padStart(2, '0')
    const from = `${String(year).padStart(4, '0')}-${mm}-01`
    const to = addDays(m === 11 ? yearEnd(year) : `${String(year).padStart(4, '0')}-${String(m + 2).padStart(2, '0')}-01`, m === 11 ? 0 : -1)
    const col = weeks.findIndex((w) => w.includes(from))
    out.push({ month: m, col, from, to })
  }
  return out
}

export type CellStatus = 'data' | 'nodata'

/** Days outside [dateMin, dateMax] have no data. Missing bounds = no data at all. */
export function dayStatus(day: string, dateMin: string | null, dateMax: string | null): CellStatus {
  if (!dateMin || !dateMax) return 'nodata'
  return day < dateMin || day > dateMax ? 'nodata' : 'data'
}

/** Last day to request for a year: end of year, but not after date_max. */
export function queryEnd(year: number, dateMax: string | null): string {
  const end = yearEnd(year)
  return dateMax && dateMax < end ? dateMax : end
}

/** Inclusive range intersected with [min, max]; null when empty. */
export function clampRange(from: string, to: string, min: string, max: string): [string, string] | null {
  const a = from < min ? min : from
  const b = to > max ? max : to
  return a <= b ? [a, b] : null
}

/** Linear-interpolated percentile (p in 0..1) of a list of numbers. */
export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0
  const s = [...values].sort((a, b) => a - b)
  const pos = Math.min(1, Math.max(0, p)) * (s.length - 1)
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

/** Robust maximum: 95th percentile of the non-zero days (at least 1). */
export function robustMax(counts: number[], p = 0.95): number {
  return Math.max(1, percentile(counts.filter((c) => c > 0), p))
}

/** sqrt scale into [0, 1]; zero stays exactly 0, anything above `max` saturates. */
export function normalise(count: number, max: number): number {
  if (!(count > 0) || !(max > 0)) return 0
  return Math.min(1, Math.sqrt(count / max))
}

/** Cell size from the available width, clamped to [min, max]. */
export function cellSize(availWidth: number, cols: number, gap: number, min: number, max: number): number {
  const raw = Math.floor((availWidth + gap) / cols - gap)
  return Math.max(min, Math.min(max, raw))
}
