import { describe, expect, it, vi } from 'vitest'
import { compareHotspots, haversineKm } from '../../lib/hotspots'
import type { Bbox, Hotspot, HotspotsQuery } from '../types'
import { activeComplexes, complexOnDay, dayIndex, generateDay, makeEstimator, pointById } from './generator'
import { mockApi } from './index'

const week = { date_from: '2026-08-01', date_to: '2026-08-07' }
const hotspots = async (q: HotspotsQuery) => (await mockApi.getHotspots(q))!

function mix(items: Hotspot[]) {
  const m = { critical: 0, high: 0, elevated: 0 }
  for (const h of items) m[h.severity]++
  return m
}

function inBox(lat: number, lon: number, [w, s, e, n]: Bbox) {
  return lat >= s && lat <= n && (w <= e ? lon >= w && lon <= e : lon >= w || lon <= e)
}

describe('mock api: getHotspots', () => {
  it('returns the defaults, strongest first', async () => {
    const r = await hotspots({ ...week })
    expect(r).toMatchObject({ radius_km: 10, min_count: 10, approximate: false })
    expect(r.items.length).toBeGreaterThan(0)
    expect(r.items.length).toBeLessThanOrEqual(50)
    expect(r.total).toBeGreaterThanOrEqual(r.items.length)
    for (let i = 1; i < r.items.length; i++) expect(compareHotspots(r.items[i - 1], r.items[i])).toBeLessThanOrEqual(0)
    expect(r.items[0].severity).toBe('critical')
    for (const h of r.items) expect(h.count).toBeGreaterThanOrEqual(10)
  })

  it('respects limit and reports the full total', async () => {
    const all = await hotspots({ ...week, limit: 10_000 })
    const top = await hotspots({ ...week, limit: 5 })
    expect(top.items).toHaveLength(5)
    expect(top.total).toBe(all.total)
    expect(all.total).toBe(all.items.length)
    expect(top.items).toEqual(all.items.slice(0, 5))
  })

  it('is deterministic, with unique ids', async () => {
    const a = await hotspots({ ...week, limit: 10_000 })
    const b = await hotspots({ ...week, limit: 10_000 })
    expect(b).toEqual(a)
    expect(new Set(a.items.map((h) => h.id)).size).toBe(a.items.length)
  })

  it('respects the bbox filter', async () => {
    const bbox: Bbox = [-80, -25, -40, 5] // South America
    const r = await hotspots({ ...week, bbox, limit: 10_000 })
    expect(r.items.length).toBeGreaterThan(0)
    for (const h of r.items) {
      expect(inBox(h.lat, h.lon, bbox)).toBe(true)
      const [w, s, e, n] = h.bbox
      expect(inBox(s, w, bbox) && inBox(n, e, bbox)).toBe(true)
    }
    expect(r.total).toBeLessThan((await hotspots({ ...week, limit: 10_000 })).total)
  })

  it('respects the source filter', async () => {
    const r = await hotspots({ ...week, source: ['MODIS_NRT'], limit: 10_000 })
    expect(r.items.length).toBeGreaterThan(0)
    for (const h of r.items) expect(Object.keys(h.by_source)).toEqual(['MODIS_NRT'])
  })

  it('honours radius_km and min_count', async () => {
    const r = await hotspots({ ...week, radius_km: 5, min_count: 40, limit: 10_000 })
    expect(r).toMatchObject({ radius_km: 5, min_count: 40 })
    for (const h of r.items) expect(h.count).toBeGreaterThanOrEqual(40)
    expect(r.total).toBeLessThan((await hotspots({ ...week, limit: 10_000 })).total)
  })

  it('gives a plausible severity mix for a 7-day window', async () => {
    const r = await hotspots({ ...week, limit: 10_000 })
    const m = mix(r.items)
    expect(m.critical).toBeGreaterThanOrEqual(3)
    expect(m.critical).toBeLessThanOrEqual(15)
    expect(m.high).toBeGreaterThanOrEqual(8)
    expect(m.high).toBeLessThanOrEqual(40)
    expect(m.elevated).toBeGreaterThan(m.high)
  })

  it('still finds strong hotspots in a single day', async () => {
    const r = await hotspots({ date_from: '2026-08-01', date_to: '2026-08-01', limit: 10_000 })
    const m = mix(r.items)
    expect(m.critical + m.high).toBeGreaterThanOrEqual(3)
  })

  it('every hotspot count matches the detections inside its radius', async () => {
    const r = await hotspots({ ...week, limit: 10_000 })
    const det = await mockApi.getDetections({ ...week, limit: 20_000 })
    expect(det.truncated).toBe(false)
    let off = 0
    for (const h of r.items) {
      let inside = 0
      for (const f of det.features) {
        const [lon, lat] = f.geometry.coordinates
        if (Math.abs(lat - h.lat) > 1) continue
        if (haversineKm(h.lat, h.lon, lat, lon) <= h.radius_km + 1e-6) inside++
      }
      // Every member is inside the circle; a neighbouring fire may poke into it.
      expect(inside).toBeGreaterThanOrEqual(h.count)
      if (inside > h.count * 1.15 + 3) off++
    }
    expect(off / r.items.length).toBeLessThan(0.1)
  })

  it('returns an empty collection outside the data range', async () => {
    const r = await hotspots({ date_from: '2010-01-01', date_to: '2010-01-07' })
    expect(r).toMatchObject({ total: 0, items: [] })
  })
})

describe('mock generator: fire complexes', () => {
  const d = dayIndex('2026-08-04')

  it('burn for 4-20 days, drifting slowly', () => {
    const list = activeComplexes(d)
    expect(list.length).toBeGreaterThan(5)
    for (const c of list) {
      const days = c.end - c.start + 1
      expect(days).toBeGreaterThanOrEqual(4)
      expect(days).toBeLessThanOrEqual(20)
      const a = complexOnDay(c, c.start)
      const b = complexOnDay(c, c.end)
      expect(haversineKm(a.lat, a.lon, b.lat, b.lon)).toBeLessThan(4 * days)
    }
  })

  it('grow, peak and fade', () => {
    const c = activeComplexes(d).find((x) => x.end - x.start >= 9 && x.peak > 100)!
    expect(c).toBeDefined()
    const n = Array.from({ length: c.end - c.start + 1 }, (_, i) => complexOnDay(c, c.start + i).n)
    const peakAt = n.indexOf(Math.max(...n))
    expect(peakAt).toBeGreaterThan(0)
    expect(peakAt).toBeLessThan(n.length - 1)
    expect(n[0]).toBeLessThan(n[peakAt])
    expect(n.at(-1)!).toBeLessThan(n[peakAt])
    expect(Math.max(...n)).toBeGreaterThan(50)
  })

  it('a day is the same whatever was generated before it', async () => {
    // Fresh module instances, so neither the day cache nor the complex cache is shared.
    vi.resetModules()
    const fresh = await import('./generator')
    const direct = JSON.stringify(fresh.generateDay(d))
    vi.resetModules()
    const other = await import('./generator')
    for (const x of [d + 9, d - 400, d - 3, d + 1, d - 1]) other.generateDay(x)
    expect(JSON.stringify(other.generateDay(d))).toBe(direct)
    expect(JSON.stringify(generateDay(d))).toBe(direct)
  })

  it('keeps ids unique and findable', () => {
    const day = generateDay(d)
    expect(new Set(day.map((p) => p.id)).size).toBe(day.length)
    expect(day.length).toBeLessThan(10_000)
    for (const p of [day[0], day[Math.floor(day.length / 2)], day.at(-1)!]) expect(pointById(p.id)).toBe(p)
    expect(pointById(d * 10_000 + day.length)).toBeUndefined()
  })

  it('the estimator accounts for the complexes', () => {
    for (const day of [d, dayIndex('2026-03-03'), dayIndex('2025-12-20')]) {
      const exact = generateDay(day).length
      const est = makeEstimator({ date_from: '2026-01-01', date_to: '2026-01-01' })(day).count
      expect(est / exact).toBeGreaterThan(0.8)
      expect(est / exact).toBeLessThan(1.25)
    }
    const bbox: Bbox = [-80, -25, -40, 5]
    const inside = generateDay(d).filter((p) => inBox(p.lat, p.lon, bbox)).length
    const est = makeEstimator({ date_from: '2026-01-01', date_to: '2026-01-01', bbox })(d).count
    expect(est / inside).toBeGreaterThan(0.6)
    expect(est / inside).toBeLessThan(1.6)
  })

  it('a 90-day world request stays fast', async () => {
    const t = performance.now()
    const r = await hotspots({ date_from: '2026-05-01', date_to: '2026-07-29' })
    expect(r.total).toBeGreaterThan(100)
    expect(performance.now() - t).toBeLessThan(3000)
  })
})
