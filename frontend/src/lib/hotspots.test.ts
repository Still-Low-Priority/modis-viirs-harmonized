import { describe, expect, it } from 'vitest'
import type { Hotspot } from '../api/types'
import {
  DEFAULT_LIMIT,
  DEFAULT_MIN_COUNT,
  DEFAULT_RADIUS_KM,
  SEVERITY_ORDER,
  SEVERITY_RULES,
  clusterDetections,
  compareHotspots,
  haversineKm,
  severityOf,
  type ClusterPoint,
} from './hotspots'

const T0 = Date.UTC(2026, 7, 1, 12)
const KM_PER_DEG = 6371.0088 * (Math.PI / 180)

const pt = (lat: number, lon: number, frp = 1, t = T0, source = 'VIIRS_SNPP_NRT'): ClusterPoint => ({ lat, lon, frp, t, source })

/** `n` points within about 1 km of (lat, lon). */
function group(lat: number, lon: number, n: number, frp = 1): ClusterPoint[] {
  const cos = Math.cos((lat * Math.PI) / 180)
  return Array.from({ length: n }, (_, i) => {
    const a = (i * 2.399963) % (2 * Math.PI)
    const r = (0.8 * Math.sqrt((i + 0.5) / n)) / KM_PER_DEG
    return pt(lat + r * Math.sin(a), lon + (r * Math.cos(a)) / cos, frp, T0 + i * 60_000)
  })
}

/** Moves `km` east of (lat, lon) along the parallel. */
const lonEast = (lat: number, km: number) => km / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180))

function lcg(seed: number) {
  let s = seed >>> 0
  return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296)
}

/** Reference single linkage: O(n^2) union-find. Returns cluster sizes, sorted descending. */
function bruteSizes(points: ClusterPoint[], radiusKm: number): number[] {
  const parent = points.map((_, i) => i)
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])))
  for (let i = 0; i < points.length; i++)
    for (let j = i + 1; j < points.length; j++)
      if (haversineKm(points[i].lat, points[i].lon, points[j].lat, points[j].lon) <= radiusKm) parent[find(i)] = find(j)
  const sizes = new Map<number, number>()
  points.forEach((_, i) => sizes.set(find(i), (sizes.get(find(i)) ?? 0) + 1))
  return [...sizes.values()].sort((a, b) => b - a)
}

const sizes = (items: Hotspot[]) => items.map((h) => h.count).sort((a, b) => b - a)

describe('constants and helpers', () => {
  it('exposes the documented defaults', () => {
    expect([DEFAULT_RADIUS_KM, DEFAULT_MIN_COUNT, DEFAULT_LIMIT]).toEqual([10, 10, 50])
    expect(SEVERITY_ORDER).toEqual(['critical', 'high', 'elevated'])
    expect(SEVERITY_RULES.map((r) => r.severity)).toEqual(SEVERITY_ORDER)
  })

  it('haversineKm matches known distances', () => {
    expect(haversineKm(0, 0, 0, 1)).toBeCloseTo(111.195, 2)
    expect(haversineKm(50.45, 30.52, 49.84, 24.03)).toBeCloseTo(469, -1) // Kyiv - Lviv
    expect(haversineKm(0, 179.97, 0, -179.97)).toBeCloseTo(6.67, 1)
    expect(haversineKm(10, 20, 10, 20)).toBe(0)
  })

  it('severityOf passes a level on either threshold', () => {
    expect(severityOf(10, 0)).toBe('elevated')
    expect(severityOf(29, 499.9)).toBe('elevated')
    expect(severityOf(30, 0)).toBe('high')
    expect(severityOf(10, 500)).toBe('high')
    expect(severityOf(99, 1999)).toBe('high')
    expect(severityOf(100, 0)).toBe('critical')
    expect(severityOf(10, 2000)).toBe('critical')
  })

  it('compareHotspots orders by severity, then count, then FRP, then id', () => {
    const h = (id: string, severity: Hotspot['severity'], count: number, frp_sum: number) => ({ id, severity, count, frp_sum }) as Hotspot
    const list = [h('a', 'elevated', 99, 1), h('b', 'high', 30, 1), h('c', 'high', 30, 5), h('d', 'critical', 10, 0), h('e', 'high', 40, 0), h('f', 'high', 30, 5)]
    expect(list.sort(compareHotspots).map((x) => x.id)).toEqual(['d', 'e', 'c', 'f', 'b', 'a'])
  })
})

describe('clusterDetections: linkage', () => {
  it('keeps two tight groups 30 km apart separate', () => {
    const r = clusterDetections([...group(10, 20, 15), ...group(10, 20 + lonEast(10, 30), 12)])
    expect(r.total).toBe(2)
    expect(sizes(r.items)).toEqual([15, 12])
  })

  it('links a chain of points 8 km apart into one cluster (single linkage)', () => {
    const chain = Array.from({ length: 20 }, (_, i) => pt(-5, 30 + lonEast(-5, 8 * i)))
    const r = clusterDetections(chain)
    expect(r.total).toBe(1)
    expect(r.items[0].count).toBe(20)
    expect(r.items[0].radius_km).toBeGreaterThan(70)
  })

  it('splits a chain where one gap exceeds the radius', () => {
    const chain = Array.from({ length: 20 }, (_, i) => pt(-5, 30 + lonEast(-5, 8 * i + (i >= 10 ? 4 : 0))))
    expect(sizes(clusterDetections(chain).items)).toEqual([10, 10])
  })

  it('drops groups under minCount and respects a custom minCount and radius', () => {
    const pts = [...group(0, 0, 9), ...group(0, 1, 10)]
    expect(sizes(clusterDetections(pts).items)).toEqual([10])
    expect(sizes(clusterDetections(pts, { minCount: 5 }).items)).toEqual([10, 9])
    // 0.5 km apart links at radius 1, not at radius 0.3.
    const pair = [pt(0, 0), pt(0, lonEast(0, 0.5))]
    expect(clusterDetections(pair, { minCount: 1, radiusKm: 1 }).total).toBe(1)
    expect(clusterDetections(pair, { minCount: 1, radiusKm: 0.3 }).total).toBe(2)
  })

  it('applies limit after sorting and reports the pre-limit total', () => {
    const pts = [...group(0, 0, 12), ...group(0, 1, 40), ...group(0, 2, 20), ...group(0, 3, 150)]
    const r = clusterDetections(pts, { limit: 2 })
    expect(r.total).toBe(4)
    expect(r.items.map((h) => h.count)).toEqual([150, 40])
    expect(clusterDetections(pts, { limit: 0 })).toEqual({ total: 4, items: [] })
  })

  it('matches a brute-force single linkage on random data, including polar and antimeridian areas', () => {
    const rand = lcg(42)
    const areas: [number, number, number, number][] = [
      // lat, lon, lat spread, lon spread (degrees)
      [10, 20, 0.6, 0.6],
      [62, 100, 0.5, 1.5],
      [74, -60, 0.4, 3],
      [88.5, 0, 1.4, 360],
      [-3, 180, 0.5, 0.6],
    ]
    for (const [la, lo, sLa, sLo] of areas) {
      for (const radiusKm of [3, 5, 7, 10]) {
        const pts = Array.from({ length: 250 }, () => pt(Math.min(90, la + (rand() - 0.5) * sLa), lo + (rand() - 0.5) * sLo))
        const r = clusterDetections(pts, { minCount: 1, radiusKm, limit: Infinity })
        expect(sizes(r.items), `area ${la},${lo} r=${radiusKm}`).toEqual(bruteSizes(pts, radiusKm))
      }
    }
  })
})

describe('clusterDetections: high latitudes and the antimeridian', () => {
  it.each([60, 63.7, 66.6, 70, 72.5, 75, 80, 86, 89.5])('links points 9.9 km apart along the parallel at %s N', (lat) => {
    const rand = lcg(lat * 100)
    for (let k = 0; k < 50; k++) {
      const la = lat + rand() * 0.2
      const lo = rand() * 3
      const pair = [pt(la, lo), pt(la, lo + lonEast(la, 9.9))]
      if (haversineKm(pair[0].lat, pair[0].lon, pair[1].lat, pair[1].lon) > DEFAULT_RADIUS_KM) continue
      expect(clusterDetections(pair, { minCount: 1 }).total).toBe(1)
    }
  })

  it.each([60, 70, 75])('keeps points 10.5 km apart along the parallel at %s N separate', (lat) => {
    const pair = [pt(lat, 10), pt(lat, 10 + lonEast(lat, 10.5))]
    expect(clusterDetections(pair, { minCount: 1 }).total).toBe(2)
  })

  it('links points on both sides of the pole', () => {
    // 89.97 N on opposite meridians: about 6.7 km apart over the pole.
    expect(clusterDetections([pt(89.97, 0), pt(89.97, 180)], { minCount: 1 }).total).toBe(1)
  })

  // Odd radii give a grid whose cell count per row is odd; the wrap must still be exact.
  it.each([7, 9, 10, 13, 25])('links 179.97 and -179.97 at the equator (radius %s km)', (radiusKm) => {
    const r = clusterDetections([pt(0, 179.97), pt(0, -179.97)], { minCount: 1, radiusKm })
    expect(r.total).toBe(1)
  })

  it('does not link across the antimeridian when the gap exceeds the radius', () => {
    expect(clusterDetections([pt(0, 179.97), pt(0, -179.97)], { minCount: 1, radiusKm: 5 }).total).toBe(2)
  })

  it('gives a sensible centre and a crossing bbox for a cluster on the antimeridian', () => {
    const pts = [...Array.from({ length: 6 }, (_, i) => pt(-0.01 + i * 0.004, 179.97)), ...Array.from({ length: 6 }, (_, i) => pt(-0.01 + i * 0.004, -179.97))]
    const r = clusterDetections(pts)
    expect(r.total).toBe(1)
    const h = r.items[0]
    expect(h.count).toBe(12)
    expect(Math.abs(h.lon)).toBeGreaterThan(179.9) // not 0
    expect(h.lat).toBeCloseTo(0, 3)
    const [w, s, e, n] = h.bbox
    expect(w).toBeGreaterThan(e)
    expect(w).toBeCloseTo(179.97, 4)
    expect(e).toBeCloseTo(-179.97, 4)
    expect(s).toBeCloseTo(-0.01, 4)
    expect(n).toBeCloseTo(0.01, 4)
    expect(h.radius_km).toBeGreaterThanOrEqual(3.3)
    expect(h.radius_km).toBeLessThan(4)
  })

  it('normalises longitudes outside [-180, 180)', () => {
    const r = clusterDetections([pt(0, 190), pt(0, -170.001)], { minCount: 1 })
    expect(r.total).toBe(1)
    expect(r.items[0].lon).toBeCloseTo(-170, 2)
  })

  it('keeps an east edge of exactly 180 as a non-crossing box', () => {
    const r = clusterDetections([pt(0, 179.95), pt(0, 180)], { minCount: 1 })
    const [w, , e] = r.items[0].bbox
    expect(w).toBeLessThanOrEqual(e)
  })
})

describe('clusterDetections: summary of one cluster', () => {
  const pts: ClusterPoint[] = [
    pt(10.0, 20.0, 5, Date.UTC(2026, 7, 3, 1, 30, 0), 'MODIS_NRT'),
    pt(10.02, 20.0, 15, Date.UTC(2026, 7, 1, 13, 0, 0), 'VIIRS_SNPP_NRT'),
    pt(10.0, 20.03, 30, Date.UTC(2026, 7, 2, 13, 0, 0), 'VIIRS_SNPP_NRT'),
    pt(10.02, 20.03, 50, Date.UTC(2026, 7, 4, 1, 0, 59), 'VIIRS_NOAA20_NRT'),
  ]
  const h = clusterDetections(pts, { minCount: 4 }).items[0]

  it('computes centre, bbox and radius', () => {
    expect(h.lat).toBeCloseTo(10.01, 6)
    expect(h.lon).toBeCloseTo(20.015, 6)
    expect(h.bbox).toEqual([20, 10, 20.03, 10.02])
    const far = Math.max(...pts.map((p) => haversineKm(h.lat, h.lon, p.lat, p.lon)))
    expect(h.radius_km).toBeGreaterThanOrEqual(far)
    expect(h.radius_km).toBeLessThan(far + 0.11)
  })

  it('computes FRP, time span, sources and severity', () => {
    expect(h.count).toBe(4)
    expect(h.frp_sum).toBe(100)
    expect(h.frp_max).toBe(50)
    expect(h.first_seen).toBe('2026-08-01T13:00:00Z')
    expect(h.last_seen).toBe('2026-08-04T01:00:59Z')
    expect(h.by_source).toEqual({ MODIS_NRT: 1, VIIRS_SNPP_NRT: 2, VIIRS_NOAA20_NRT: 1 })
    expect(h.severity).toBe('elevated')
  })

  it('never reports a radius below 1 km', () => {
    const r = clusterDetections(Array.from({ length: 10 }, () => pt(5, 5)))
    expect(r.items[0].radius_km).toBe(1)
  })

  it('rates severity by count or FRP sum', () => {
    expect(clusterDetections(group(0, 0, 100)).items[0].severity).toBe('critical')
    expect(clusterDetections(group(0, 0, 30)).items[0].severity).toBe('high')
    expect(clusterDetections(group(0, 0, 10, 50)).items[0].severity).toBe('high')
    expect(clusterDetections(group(0, 0, 10, 200)).items[0].severity).toBe('critical')
  })

  it('sorts by severity, then count, then FRP', () => {
    const r = clusterDetections([
      ...group(0, 0, 12), // elevated
      ...group(0, 1, 15, 40), // high by FRP (600)
      ...group(0, 2, 15, 50), // high by FRP (750)
      ...group(0, 3, 35), // high by count
      ...group(0, 4, 11, 300), // critical by FRP
      ...group(0, 5, 20), // elevated
    ])
    expect(r.items.map((x) => [x.severity, x.count, x.frp_sum])).toEqual([
      ['critical', 11, 3300],
      ['high', 35, 35],
      ['high', 15, 750],
      ['high', 15, 600],
      ['elevated', 20, 20],
      ['elevated', 12, 12],
    ])
  })
})

describe('clusterDetections: ids', () => {
  it('are deterministic and independent of input order', () => {
    const pts = [...group(0, 0, 12), ...group(0, 1, 40), ...group(30, 2, 20)]
    const a = clusterDetections(pts).items
    const b = clusterDetections([...pts].reverse()).items
    expect(b.map((h) => h.id)).toEqual(a.map((h) => h.id))
    expect(b).toEqual(a)
  })

  it('are unique when two clusters share centre and size (ring around a core)', () => {
    const ring = Array.from({ length: 40 }, (_, i) => pt(0.5 * Math.sin((i * Math.PI) / 20), 0.5 * Math.cos((i * Math.PI) / 20)))
    const core = Array.from({ length: 40 }, (_, i) => pt(0.01 * Math.sin((i * Math.PI) / 20), 0.01 * Math.cos((i * Math.PI) / 20)))
    const r = clusterDetections([...ring, ...core])
    expect(r.total).toBe(2)
    expect(new Set(r.items.map((h) => h.id)).size).toBe(2)
  })

  it('are unique across many clusters', () => {
    const many = clusterDetections(Array.from({ length: 200 }, (_, i) => group((i % 20) * 2, Math.floor(i / 20) * 2, 10)).flat(), { limit: Infinity })
    expect(many.total).toBe(200)
    expect(new Set(many.items.map((h) => h.id)).size).toBe(200)
  })
})

describe('clusterDetections: performance', () => {
  it('clusters 20 000 points in realistic clusters quickly', () => {
    const rand = lcg(7)
    const pts: ClusterPoint[] = []
    for (let c = 0; c < 400; c++) {
      const la = -50 + rand() * 120
      const lo = -180 + rand() * 360
      for (let i = 0; i < 50; i++) pts.push(pt(la + (rand() - 0.5) * 0.3, lo + (rand() - 0.5) * 0.3, rand() * 20, T0 + i))
    }
    const start = performance.now()
    const r = clusterDetections(pts)
    expect(performance.now() - start).toBeLessThan(800)
    expect(r.total).toBeGreaterThan(100)
  })

  it('handles 20 000 points piled into one place without going quadratic', () => {
    const pts = Array.from({ length: 20_000 }, (_, i) => pt(10 + (i % 100) * 0.0004, 20 + Math.floor(i / 100) * 0.0002))
    const start = performance.now()
    const r = clusterDetections(pts)
    expect(performance.now() - start).toBeLessThan(500)
    expect(r.items[0].count).toBe(20_000)
  })

  it('handles two dense piles just out of reach of each other', () => {
    const a = Array.from({ length: 5000 }, (_, i) => pt(10 + (i % 50) * 0.0001, 20 + Math.floor(i / 50) * 0.00001))
    const b = a.map((p) => pt(p.lat, p.lon + lonEast(10, 10.5) + 0.001))
    const start = performance.now()
    const r = clusterDetections([...a, ...b])
    expect(performance.now() - start).toBeLessThan(800)
    expect(sizes(r.items)).toEqual([5000, 5000])
  })
})

describe('clusterDetections: robustness', () => {
  it('returns nothing for empty input', () => {
    expect(clusterDetections([])).toEqual({ total: 0, items: [] })
  })

  it('skips points with NaN, infinite or out-of-range coordinates or time', () => {
    const good = group(10, 20, 10)
    const bad = [pt(NaN, 20), pt(10, NaN), pt(Infinity, 20), pt(95, 20), pt(-91, 20), pt(10, 20, 1, NaN)]
    const r = clusterDetections([...bad, ...good, ...bad])
    expect(r.total).toBe(1)
    const h = r.items[0]
    expect(h.count).toBe(10)
    expect(Number.isFinite(h.lat) && Number.isFinite(h.lon) && Number.isFinite(h.radius_km)).toBe(true)
    expect(h.bbox.every(Number.isFinite)).toBe(true)
    expect(clusterDetections(bad, { minCount: 1 }).total).toBe(0)
  })

  it('treats a NaN or negative FRP as zero instead of poisoning the sum', () => {
    const pts = group(10, 20, 10, 100)
    pts[3] = { ...pts[3], frp: NaN }
    pts[4] = { ...pts[4], frp: -5 }
    const h = clusterDetections(pts).items[0]
    expect(h.frp_sum).toBe(800)
    expect(h.severity).toBe('high')
  })

  it('falls back to defaults for a nonsensical radius', () => {
    const pts = group(0, 0, 10)
    expect(clusterDetections(pts, { radiusKm: 0 }).total).toBe(1)
    expect(clusterDetections(pts, { radiusKm: NaN }).total).toBe(1)
  })
})
