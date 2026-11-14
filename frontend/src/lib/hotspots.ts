// Critical hotspots: dense clusters of fire detections.
//
// Two detections are neighbours when they are at most `radiusKm` apart
// (default 10 km). Neighbours of neighbours join the same cluster, so a long
// fire front becomes one hotspot while separate fires stay separate. Why 10 km:
// a VIIRS pixel is 375 m and a MODIS pixel about 1 km, one burning front shows
// up as detections a few km apart, and large fire complexes span 10-50 km.
// Clusters with fewer than `minCount` detections are ordinary fires and are
// dropped.

import type { Bbox, Hotspot, Severity } from '../api/types'

export const DEFAULT_RADIUS_KM = 10
export const DEFAULT_MIN_COUNT = 10
export const DEFAULT_LIMIT = 50

/** A hotspot is `critical` or `high` when it passes either threshold. */
export const SEVERITY_RULES: { severity: Severity; minCount: number; minFrp: number }[] = [
  { severity: 'critical', minCount: 100, minFrp: 2000 },
  { severity: 'high', minCount: 30, minFrp: 500 },
  { severity: 'elevated', minCount: 0, minFrp: 0 },
]

export const SEVERITY_ORDER: Severity[] = ['critical', 'high', 'elevated']

export interface ClusterPoint {
  lat: number
  lon: number
  frp: number
  /** Epoch ms. */
  t: number
  source: string
}

export interface ClusterOptions {
  radiusKm?: number
  minCount?: number
  limit?: number
}

export interface ClusterResult {
  /** Clusters found before `limit` was applied. */
  total: number
  items: Hotspot[]
}

const EARTH_KM = 6371.0088
const RAD = Math.PI / 180
/** Kilometres per degree of latitude on the same sphere `haversineKm` uses. */
const KM_PER_DEG = EARTH_KM * RAD

/** Great-circle distance in km. */
export function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * RAD
  const dLon = (lon2 - lon1) * RAD
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * RAD) * Math.cos(lat2 * RAD) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

export function severityOf(count: number, frpSum: number): Severity {
  for (const rule of SEVERITY_RULES) if (count >= rule.minCount || frpSum >= rule.minFrp) return rule.severity
  return 'elevated'
}

/** Strongest first: severity, then detections, then radiative power; ties broken by id so the order is stable. */
export function compareHotspots(a: Hotspot, b: Hotspot): number {
  return (
    SEVERITY_ORDER.indexOf(a.severity) - SEVERITY_ORDER.indexOf(b.severity) ||
    b.count - a.count ||
    b.frp_sum - a.frp_sum ||
    (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
  )
}

function iso(ms: number): string {
  return `${new Date(ms).toISOString().slice(0, 19)}Z`
}

/** Longitude into [-180, 180). */
function wrapLon(v: number): number {
  return ((((v + 180) % 360) + 360) % 360) - 180
}

/** Signed longitude difference b - a in (-180, 180]. */
function lonDelta(a: number, b: number): number {
  const d = wrapLon(b - a)
  return d === -180 ? 180 : d
}

const floor4 = (v: number) => Math.floor(v * 1e4 + 1e-9) / 1e4
const ceil4 = (v: number) => Math.ceil(v * 1e4 - 1e-9) / 1e4

/** Small FNV-1a hash, base 36. */
function hash36(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 0x01000193)
  }
  return (h >>> 0).toString(36)
}

interface Cell {
  row: number
  col: number
  members: number[]
  minLat: number
  maxLat: number
  minLon: number
  maxLon: number
  /** Cluster index, -1 while unvisited. */
  label: number
}

/**
 * Single-linkage clustering with a latitude-aware grid as the neighbour index.
 *
 * Cells are small enough (side radius / sqrt 2, measured at the widest part of
 * the cell) that any two detections in one cell are neighbours, so a cell
 * joins a cluster as a whole and a pile of points in one place costs O(n).
 * Every latitude row is split into a whole number of cells, so the grid wraps
 * exactly at the antimeridian, and the longitude reach of a neighbour search
 * is derived from the haversine formula, so it stays correct up to the poles.
 * Points with non-finite or out-of-range coordinates or time are skipped.
 */
export function clusterDetections(points: ClusterPoint[], opts: ClusterOptions = {}): ClusterResult {
  const radiusKm = opts.radiusKm != null && opts.radiusKm > 0 && Number.isFinite(opts.radiusKm) ? opts.radiusKm : DEFAULT_RADIUS_KM
  const minCount = Math.max(1, opts.minCount ?? DEFAULT_MIN_COUNT)
  const limit = opts.limit != null && opts.limit >= 0 ? opts.limit : DEFAULT_LIMIT

  // --- valid points, longitudes normalised ---
  const lat: number[] = []
  const lon: number[] = []
  const src: ClusterPoint[] = []
  for (const p of points) {
    if (!p || !Number.isFinite(p.lat) || !Number.isFinite(p.lon) || !Number.isFinite(p.t)) continue
    if (p.lat < -90 || p.lat > 90) continue
    lat.push(p.lat)
    lon.push(wrapLon(p.lon))
    src.push(p)
  }
  const n = src.length
  if (n === 0) return { total: 0, items: [] }

  // --- grid ---
  // 0.999 leaves room for floating point and for asin(x) > x in the bound below.
  const sideKm = (radiusKm / Math.SQRT2) * 0.999
  const cellLat = sideKm / KM_PER_DEG
  const rows = Math.ceil(180 / cellLat)
  const rowLo = (r: number) => r * cellLat - 90
  const rowHi = (r: number) => Math.min(90, (r + 1) * cellLat - 90)
  const rowOf = (la: number) => Math.min(rows - 1, Math.floor((la + 90) / cellLat))
  const colsCache = new Map<number, number>()
  /** Cells in a row: as many as fit with a width of `sideKm` at the row's widest latitude. */
  const colsOf = (r: number): number => {
    let c = colsCache.get(r)
    if (c == null) {
      const lo = rowLo(r)
      const hi = rowHi(r)
      const minAbs = lo <= 0 && hi >= 0 ? 0 : Math.min(Math.abs(lo), Math.abs(hi))
      const widest = 360 * KM_PER_DEG * Math.cos(minAbs * RAD)
      c = Math.max(1, Math.ceil(widest / sideKm))
      colsCache.set(r, c)
    }
    return c
  }
  const colOf = (r: number, lo: number) => {
    const cols = colsOf(r)
    return Math.min(cols - 1, Math.floor(((lo + 180) / 360) * cols))
  }
  const maxCols = Math.ceil((360 * KM_PER_DEG) / sideKm) + 1
  const cellKey = (r: number, c: number) => r * maxCols + c

  const cells = new Map<number, Cell>()
  for (let i = 0; i < n; i++) {
    const r = rowOf(lat[i])
    const c = colOf(r, lon[i])
    const k = cellKey(r, c)
    let cell = cells.get(k)
    if (!cell) cells.set(k, (cell = { row: r, col: c, members: [], minLat: lat[i], maxLat: lat[i], minLon: lon[i], maxLon: lon[i], label: -1 }))
    cell.members.push(i)
    if (lat[i] < cell.minLat) cell.minLat = lat[i]
    if (lat[i] > cell.maxLat) cell.maxLat = lat[i]
    if (lon[i] < cell.minLon) cell.minLon = lon[i]
    if (lon[i] > cell.maxLon) cell.maxLon = lon[i]
  }

  // Two points within radiusKm differ by at most dLatDeg in latitude, and by at
  // most 2 asin(sin(d / 2R) / cos(maxAbsLat)) in longitude (from the haversine formula).
  const dLatDeg = radiusKm / KM_PER_DEG
  const sinHalf = Math.sin(radiusKm / EARTH_KM / 2)
  const lonReachDeg = (maxAbsLat: number) => {
    const c = Math.cos(Math.min(90, maxAbsLat) * RAD)
    const s = c > 1e-12 ? sinHalf / c : 2
    return s >= 1 ? 360 : (2 * Math.asin(s)) / RAD
  }

  /**
   * Lower bound of the distance in km between any point of the box
   * [la0, la1] x [lo0, lo1] and any point of cell `b`, from the haversine
   * formula: sin^2(d / 2R) >= cos^2(maxAbsLat) sin^2(dLon / 2).
   */
  const gapKm = (la0: number, la1: number, lo0: number, lo1: number, b: Cell): number => {
    const dLat = Math.max(0, b.minLat - la1, la0 - b.maxLat)
    // Gap between the two longitude ranges, the shorter way round the globe.
    let dLon = Math.max(0, b.minLon - lo1, lo0 - b.maxLon)
    if (dLon > 0) dLon = Math.min(dLon, Math.max(0, 360 - (Math.max(lo1, b.maxLon) - Math.min(lo0, b.minLon))))
    const maxAbs = Math.max(Math.abs(la0), Math.abs(la1), Math.abs(b.minLat), Math.abs(b.maxLat))
    const byLon = 2 * EARTH_KM * Math.asin(Math.min(1, Math.cos(maxAbs * RAD) * Math.sin((dLon * RAD) / 2)))
    return Math.max(dLat * KM_PER_DEG, byLon)
  }

  const linked = (a: Cell, b: Cell): boolean => {
    if (gapKm(a.minLat, a.maxLat, a.minLon, a.maxLon, b) > radiusKm) return false
    for (const i of a.members) {
      if (gapKm(lat[i], lat[i], lon[i], lon[i], b) > radiusKm) continue
      for (const j of b.members) if (haversineKm(lat[i], lon[i], lat[j], lon[j]) <= radiusKm) return true
    }
    return false
  }

  const clusters: Cell[][] = []
  const queue: Cell[] = []
  for (const start of cells.values()) {
    if (start.label !== -1) continue
    const id = clusters.length
    const group: Cell[] = []
    start.label = id
    queue.push(start)
    while (queue.length) {
      const a = queue.pop() as Cell
      group.push(a)
      const aCols = colsOf(a.row)
      const aWest = (a.col / aCols) * 360 - 180
      const aEast = ((a.col + 1) / aCols) * 360 - 180
      const r0 = Math.max(0, rowOf(Math.max(-90, a.minLat - dLatDeg)))
      const r1 = rowOf(Math.min(90, a.maxLat + dLatDeg))
      for (let r = r0; r <= r1; r++) {
        const cols = colsOf(r)
        const maxAbs = Math.max(Math.abs(a.minLat), Math.abs(a.maxLat), Math.abs(rowLo(r)), Math.abs(rowHi(r)))
        const reach = lonReachDeg(maxAbs)
        let c0: number
        let c1: number
        if (reach >= 180) {
          c0 = 0
          c1 = cols - 1
        } else {
          c0 = Math.floor(((aWest - reach + 180) / 360) * cols)
          c1 = Math.floor(((aEast + reach + 180) / 360) * cols)
          if (c1 - c0 + 1 >= cols) {
            c0 = 0
            c1 = cols - 1
          }
        }
        for (let c = c0; c <= c1; c++) {
          const b = cells.get(cellKey(r, ((c % cols) + cols) % cols))
          if (!b || b.label !== -1) continue
          if (linked(a, b)) {
            b.label = id
            queue.push(b)
          }
        }
      }
    }
    clusters.push(group)
  }

  // --- summaries ---
  const items: Hotspot[] = []
  for (const group of clusters) {
    let count = 0
    for (const cell of group) count += cell.members.length
    if (count < minCount) continue
    const members: number[] = []
    for (const cell of group) for (const i of cell.members) members.push(i)
    // Deterministic member order, whatever order the cells were visited in.
    members.sort((x, y) => lat[x] - lat[y] || lon[x] - lon[y] || src[x].t - src[y].t)

    const ref = lon[members[0]]
    let sumLat = 0
    let sumDx = 0
    let frpSum = 0
    let frpMax = 0
    let first = Infinity
    let last = -Infinity
    const bySource: Record<string, number> = {}
    for (const i of members) {
      const p = src[i]
      // Longitudes relative to one member, so a cluster on the antimeridian averages correctly.
      sumLat += lat[i]
      sumDx += lonDelta(ref, lon[i])
      const frp = Number.isFinite(p.frp) && p.frp > 0 ? p.frp : 0
      frpSum += frp
      if (frp > frpMax) frpMax = frp
      if (p.t < first) first = p.t
      if (p.t > last) last = p.t
      bySource[p.source] = (bySource[p.source] ?? 0) + 1
    }
    const cLat = +(sumLat / count).toFixed(4)
    const cLon = +wrapLon(ref + sumDx / count).toFixed(4)

    let radius = 1
    let south = 90
    let north = -90
    let minDx = Infinity
    let maxDx = -Infinity
    for (const i of members) {
      // Measured from the rounded centre that is returned, so every member lies inside the circle.
      const d = haversineKm(cLat, cLon, lat[i], lon[i])
      if (d > radius) radius = d
      if (lat[i] < south) south = lat[i]
      if (lat[i] > north) north = lat[i]
      const dx = lonDelta(cLon, lon[i])
      if (dx < minDx) minDx = dx
      if (dx > maxDx) maxDx = dx
    }
    // An edge that only touches +-180 stays there; one that goes past it wraps, so west > east.
    const EPS = 1e-9
    const west = cLon + minDx
    const east = cLon + maxDx
    const bbox: Bbox = [
      west < -180 - EPS ? floor4(wrapLon(west)) : Math.max(-180, floor4(west)),
      floor4(south),
      east > 180 + EPS ? ceil4(wrapLon(east)) : Math.min(180, ceil4(east)),
      ceil4(north),
    ]
    const frpRounded = +frpSum.toFixed(1)

    items.push({
      id: `${cLat.toFixed(3)}_${cLon.toFixed(3)}_${count}_${hash36(`${first}|${last}|${frpRounded}|${south}|${north}`)}`,
      lat: cLat,
      lon: cLon,
      radius_km: Math.ceil(radius * 10 - 1e-9) / 10,
      bbox,
      count,
      frp_sum: frpRounded,
      frp_max: +frpMax.toFixed(1),
      first_seen: iso(first),
      last_seen: iso(last),
      by_source: bySource,
      severity: severityOf(count, frpSum),
    })
  }

  items.sort(compareHotspots)
  // Identical summaries (possible only for pathological input) still get distinct ids.
  const seen = new Map<string, number>()
  for (const h of items) {
    const k = seen.get(h.id) ?? 0
    seen.set(h.id, k + 1)
    if (k > 0) h.id = `${h.id}-${k + 1}`
  }
  return { total: items.length, items: items.slice(0, limit) }
}
