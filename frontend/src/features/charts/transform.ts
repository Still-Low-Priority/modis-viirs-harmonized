import type { TimeseriesItem } from '../../api/types'

export interface YearRow {
  year: string
  count: number
  frp: number
  /** The year is not fully covered by the available history (first or last year). */
  partial: boolean
  /** Per-source counts, keyed by source_product. */
  bySource: Record<string, number>
}

const yearOf = (day: string) => Number(day.slice(0, 4))

/** One row per year in [dateMin, dateMax]; years without items are zero-filled. */
export function yearlyRows(items: readonly TimeseriesItem[], dateMin: string, dateMax: string): YearRow[] {
  const byYear = new Map(items.map((i) => [i.period.slice(0, 4), i]))
  const rows: YearRow[] = []
  const first = yearOf(dateMin)
  const last = yearOf(dateMax)
  for (let y = first; y <= last; y++) {
    const key = String(y)
    const item = byYear.get(key)
    const partial = (y === first && dateMin > `${key}-01-01`) || (y === last && dateMax < `${key}-12-31`)
    rows.push({ year: key, count: item?.count ?? 0, frp: item?.frp_sum ?? 0, partial, bySource: { ...(item?.by_source ?? {}) } })
  }
  return rows
}

/** Sorted union of all source products present in the rows. */
export function sourceKeys(rows: readonly YearRow[]): string[] {
  const set = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r.bySource)) set.add(k)
  return [...set].sort()
}

/** Flat object for recharts: { year, partial, count, frp, <source>: n }. Missing sources become 0. */
export function stackedData(rows: readonly YearRow[], keys: readonly string[]): Array<Record<string, number | string | boolean>> {
  return rows.map((r) => {
    const out: Record<string, number | string | boolean> = { year: r.year, partial: r.partial, count: r.count, frp: r.frp }
    for (const k of keys) out[k] = r.bySource[k] ?? 0
    return out
  })
}

export interface SeasonRow {
  /** 1..12 */
  month: number
  /** Mean over fully covered years; null if there is none. */
  avg: number | null
  min: number | null
  max: number | null
  /** Value in the highlighted year; null when that month is not covered. */
  current: number | null
  /** Number of years in avg/min/max. */
  years: number
}

function monthEnd(year: number, month: number): string {
  const d = new Date(Date.UTC(year, month, 0)).getUTCDate()
  return `${year}-${String(month).padStart(2, '0')}-${String(d).padStart(2, '0')}`
}

/**
 * Month-of-year profile. A month counts as covered when the whole month lies in
 * [dateMin, dateMax]; covered months missing from the items are zeros.
 * The highlighted year also shows a partially covered month, if present.
 */
export function seasonality(items: readonly TimeseriesItem[], dateMin: string, dateMax: string, currentYear: number): SeasonRow[] {
  const values = new Map(items.map((i) => [i.period.slice(0, 7), i.count]))
  const rows: SeasonRow[] = []
  for (let m = 1; m <= 12; m++) {
    const samples: number[] = []
    let current: number | null = null
    for (let y = yearOf(dateMin); y <= yearOf(dateMax); y++) {
      const mm = String(m).padStart(2, '0')
      const start = `${y}-${mm}-01`
      const full = start >= dateMin && monthEnd(y, m) <= dateMax
      const touched = monthEnd(y, m) >= dateMin && start <= dateMax
      const v = values.get(`${y}-${mm}`) ?? 0
      if (full) samples.push(v)
      if (y === currentYear && (full || (touched && values.has(`${y}-${mm}`)))) current = v
    }
    rows.push({
      month: m,
      avg: samples.length ? samples.reduce((a, b) => a + b, 0) / samples.length : null,
      min: samples.length ? Math.min(...samples) : null,
      max: samples.length ? Math.max(...samples) : null,
      current,
      years: samples.length,
    })
  }
  return rows
}

/** First and last day of a month. */
export function monthRange(year: number, month: number): [string, string] {
  return [`${year}-${String(month).padStart(2, '0')}-01`, monthEnd(year, month)]
}

/** Years touched by [from, to]. */
export function yearOverlaps(year: string, from: string, to: string): boolean {
  return year >= from.slice(0, 4) && year <= to.slice(0, 4)
}
