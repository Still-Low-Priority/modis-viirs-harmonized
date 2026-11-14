import { addDays, dayFromIndex, dayIndex, daysBetween, todayUtc } from '../../lib/dates'
import { DEFAULT_LIMIT as HOTSPOT_LIMIT, DEFAULT_MIN_COUNT, DEFAULT_RADIUS_KM, clusterDetections } from '../../lib/hotspots'
import { ApiError } from '../http'
import type {
  Api,
  DetectionFeature,
  GridCell,
  Interval,
  TimeseriesItem,
  TimeseriesQuery,
} from '../types'
import {
  AREAS,
  DATE_MIN,
  SOURCES,
  confidenceLabel,
  generateDay,
  makeEstimator,
  makeMatcher,
  pointById,
  type MockPoint,
} from './generator'

/** Ranges up to this many days are aggregated from real generated points. */
const EXACT_DAYS = 800
const DEFAULT_LIMIT = 5000
const MAX_LIMIT = 20_000

function dateMax(): string {
  return addDays(todayUtc(), -1)
}

function delay(signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    const timer = setTimeout(resolve, 120 + Math.random() * 180)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(signal.reason ?? new DOMException('Aborted', 'AbortError'))
    })
  })
}

function range(q: { date_from: string; date_to: string }): [number, number] {
  if (q.date_from > q.date_to) throw new ApiError(422, 'date_from must be <= date_to')
  const from = Math.max(dayIndex(q.date_from), dayIndex(DATE_MIN))
  const to = Math.min(dayIndex(q.date_to), dayIndex(dateMax()))
  return [from, to]
}

function collect(q: Parameters<typeof makeMatcher>[0]): MockPoint[] {
  const [from, to] = range(q)
  const match = makeMatcher(q)
  const out: MockPoint[] = []
  for (let i = from; i <= to; i++) for (const p of generateDay(i)) if (match(p)) out.push(p)
  return out
}

/** Second precision, like the backend: 2026-08-15T11:20:00Z */
function isoSeconds(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`
}

function toFeature(p: MockPoint): DetectionFeature {
  const s = SOURCES[p.src]
  return {
    type: 'Feature',
    id: p.id,
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
    properties: {
      acquired_at: isoSeconds(p.t),
      source_product: s.source_product,
      instrument: s.instrument,
      confidence: confidenceLabel(p.conf),
      frp: p.frp,
      daynight: p.dn,
    },
  }
}

function periodOf(day: string, interval: Interval): string {
  return interval === 'day' ? day : interval === 'month' ? day.slice(0, 7) : day.slice(0, 4)
}

function timeseries(q: TimeseriesQuery): TimeseriesItem[] {
  const fromDay = q.date_from < DATE_MIN ? DATE_MIN : q.date_from
  const toDay = q.date_to > dateMax() ? dateMax() : q.date_to
  if (q.date_from > q.date_to) throw new ApiError(422, 'date_from must be <= date_to')

  const buckets = new Map<string, { count: number; frp: number; src: number[] }>()
  const bucket = (period: string) => {
    let b = buckets.get(period)
    if (!b) buckets.set(period, (b = { count: 0, frp: 0, src: SOURCES.map(() => 0) }))
    return b
  }

  // Every period in the requested range is present, zeros included.
  for (let i = dayIndex(q.date_from), end = dayIndex(q.date_to); i <= end; i++) bucket(periodOf(dayFromIndex(i), q.interval))

  if (fromDay <= toDay) {
    const from = dayIndex(fromDay)
    const to = dayIndex(toDay)
    if (daysBetween(fromDay, toDay) <= EXACT_DAYS) {
      const match = makeMatcher(q)
      for (let i = from; i <= to; i++) {
        const b = bucket(periodOf(dayFromIndex(i), q.interval))
        for (const p of generateDay(i)) {
          if (!match(p)) continue
          b.count++
          b.frp += p.frp
          b.src[p.src]++
        }
      }
    } else {
      const estimate = makeEstimator(q)
      for (let i = from; i <= to; i++) {
        const b = bucket(periodOf(dayFromIndex(i), q.interval))
        const e = estimate(i)
        b.count += e.count
        b.frp += e.frpSum
        e.bySource.forEach((c, s) => (b.src[s] += c))
      }
    }
  }

  return [...buckets.entries()].map(([period, b]) => {
    const item: TimeseriesItem = { period, count: Math.round(b.count), frp_sum: +b.frp.toFixed(1) }
    if (q.group_by === 'source') {
      item.by_source = {}
      SOURCES.forEach((s, i) => (item.by_source![s.source_product] = Math.round(b.src[i])))
    }
    return item
  })
}

export const mockApi: Api = {
  async getMeta(signal) {
    await delay(signal)
    return {
      sources: SOURCES.map(({ source_product, instrument, satellites }) => ({ source_product, instrument, satellites })),
      date_min: DATE_MIN,
      date_max: dateMax(),
      last_ingested_at: `${todayUtc()}T03:15:00Z`,
    }
  },

  async getDetections(q, signal) {
    await delay(signal)
    const limit = Math.min(q.limit ?? DEFAULT_LIMIT, MAX_LIMIT)
    const all = collect(q)
    let picked = all
    if (all.length > limit) {
      // Even sample instead of "first N" so the truncated map still looks representative.
      const step = all.length / limit
      picked = Array.from({ length: limit }, (_, i) => all[Math.floor(i * step)])
    }
    return {
      type: 'FeatureCollection',
      total: all.length,
      truncated: all.length > limit,
      features: picked.map(toFeature),
    }
  },

  async getDetection(id, signal) {
    await delay(signal)
    const p = pointById(id)
    if (!p) throw new ApiError(404, 'Detection not found')
    const s = SOURCES[p.src]
    const modis = s.instrument === 'MODIS'
    const hot = 300 + Math.min(67, Math.log1p(p.frp) * 14)
    return {
      id: p.id,
      latitude: p.lat,
      longitude: p.lon,
      acquired_at: isoSeconds(p.t),
      source_product: s.source_product,
      satellite: p.sat,
      instrument: s.instrument,
      confidence: confidenceLabel(p.conf),
      confidence_raw: p.confRaw,
      detection_type: 0,
      frp: p.frp,
      brightness: modis ? +hot.toFixed(1) : null,
      bright_t31: modis ? +(hot - 28).toFixed(1) : null,
      bright_ti4: modis ? null : +hot.toFixed(1),
      bright_ti5: modis ? null : +(hot - 42).toFixed(1),
      scan: modis ? 1.1 : 0.39,
      track: modis ? 1.0 : 0.36,
      daynight: p.dn,
      version: modis ? '6.1NRT' : '2.0NRT',
    }
  },

  async getTimeseries(q, signal) {
    await delay(signal)
    return { interval: q.interval, items: timeseries(q) }
  },

  async getAreas(signal) {
    await delay(signal)
    return AREAS
  },

  async getGrid(q, signal) {
    await delay(signal)
    const cells = new Map<string, GridCell>()
    for (const p of collect(q)) {
      const lat = (Math.floor(p.lat / q.cell) + 0.5) * q.cell
      const lon = (Math.floor(p.lon / q.cell) + 0.5) * q.cell
      const key = `${lat}:${lon}`
      const c = cells.get(key)
      if (c) {
        c.count++
        c.frp_sum += p.frp
      } else cells.set(key, { lat: +lat.toFixed(4), lon: +lon.toFixed(4), count: 1, frp_sum: p.frp })
    }
    return [...cells.values()].map((c) => ({ ...c, frp_sum: +c.frp_sum.toFixed(1) }))
  },

  async getHotspots(q, signal) {
    await delay(signal)
    const radius_km = q.radius_km ?? DEFAULT_RADIUS_KM
    const min_count = q.min_count ?? DEFAULT_MIN_COUNT
    const points = collect(q).map((p) => ({ lat: p.lat, lon: p.lon, frp: p.frp, t: p.t, source: SOURCES[p.src].source_product }))
    const { total, items } = clusterDetections(points, { radiusKm: radius_km, minCount: min_count, limit: q.limit ?? HOTSPOT_LIMIT })
    return { radius_km, min_count, total, approximate: false, items }
  },
}
