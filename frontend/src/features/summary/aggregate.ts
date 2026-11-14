import type { Interval, TimeseriesItem } from '../../api/types'
import { addDays, daysBetween, toDay } from '../../lib/dates'

/** Pick the coarsest interval that keeps the request small. */
export function chooseInterval(days: number): Interval {
  if (days <= 92) return 'day'
  if (days <= 366 * 3) return 'month'
  return 'year'
}

export interface SourceShare {
  source: string
  count: number
  /** 0..100 */
  percent: number
}

export interface Peak {
  period: string
  count: number
}

export interface Summary {
  total: number
  frpTotal: number
  sources: SourceShare[]
  peak: Peak | null
  /** Counts per item, in input order (for the sparkline). */
  series: number[]
}

export function periodDays(from: string, to: string): number {
  return Math.max(1, daysBetween(from, to))
}

export function summarize(items: readonly TimeseriesItem[]): Summary {
  let total = 0
  let frpTotal = 0
  let peak: Peak | null = null
  const bySource = new Map<string, number>()
  for (const it of items) {
    total += it.count
    frpTotal += it.frp_sum
    if (it.count > 0 && (!peak || it.count > peak.count)) peak = { period: it.period, count: it.count }
    for (const [src, n] of Object.entries(it.by_source ?? {})) bySource.set(src, (bySource.get(src) ?? 0) + n)
  }
  const sourceTotal = [...bySource.values()].reduce((a, b) => a + b, 0)
  const sources = [...bySource.entries()]
    .filter(([, n]) => n > 0)
    .map(([source, count]) => ({ source, count, percent: sourceTotal ? (count / sourceTotal) * 100 : 0 }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
  return { total, frpTotal, sources, peak, series: items.map((i) => i.count) }
}

export interface DayRange {
  from: string
  to: string
}

/** The interval a period string belongs to, judged by its shape (YYYY-MM-DD, YYYY-MM, YYYY). */
export function intervalOfPeriod(period: string): Interval {
  return period.length === 10 ? 'day' : period.length === 7 ? 'month' : 'year'
}

/** First and last day covered by a period; a real calendar day on both ends. */
export function periodRange(period: string): DayRange {
  const kind = intervalOfPeriod(period)
  if (kind === 'day') return { from: period, to: period }
  if (kind === 'year') return { from: `${period}-01-01`, to: `${period}-12-31` }
  const year = Number(period.slice(0, 4))
  const month = Number(period.slice(5, 7))
  // Date.UTC takes a 0-based month, so passing the 1-based one gives the 1st of the next month.
  const nextFirst = toDay(new Date(Date.UTC(year, month, 1)))
  return { from: `${period}-01`, to: addDays(nextFirst, -1) }
}

export interface Bar {
  x: number
  width: number
  height: number
}

export interface ChartGeometry {
  max: number
  bars: Bar[]
}

/** One bar per value in a width x height box; bars are anchored to the bottom (y = height - bar.height). */
export function chartGeometry(values: readonly number[], width: number, height: number): ChartGeometry {
  const max = Math.max(0, ...values)
  const n = values.length
  if (n === 0) return { max, bars: [] }
  const step = width / n
  const barW = Math.max(step * 0.72, Math.min(step, 1))
  const bars = values.map((v, i) => ({
    x: i * step + (step - barW) / 2,
    width: barW,
    height: max > 0 && v > 0 ? Math.max(1, (v / max) * height) : 0,
  }))
  return { max, bars }
}

/** Index of the next period for arrow keys, clamped to the series. */
export function stepIndex(current: number | null, delta: number, length: number): number {
  if (length === 0) return 0
  const from = current ?? (delta < 0 ? length : -1)
  return Math.min(length - 1, Math.max(0, from + delta))
}
