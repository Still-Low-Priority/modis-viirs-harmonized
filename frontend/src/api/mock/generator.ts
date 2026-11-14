// Deterministic synthetic fire detections for demo mode.
// The same day always yields the same points, so map, calendar and chart agree.

import { dayFromIndex, dayIndex } from '../../lib/dates'
import { ApiError } from '../http'
import type { Bbox, CommonFilters, Confidence, DayNight } from '../types'

export interface MockSource {
  source_product: string
  instrument: string
  satellites: string[]
  share: number
  /** First day with data. */
  since: string
  meanFrp: number
}

export const SOURCES: MockSource[] = [
  { source_product: 'MODIS_NRT', instrument: 'MODIS', satellites: ['Terra', 'Aqua'], share: 0.22, since: '2000-11-01', meanFrp: 38 },
  { source_product: 'VIIRS_SNPP_NRT', instrument: 'VIIRS', satellites: ['N'], share: 0.4, since: '2012-01-20', meanFrp: 9 },
  { source_product: 'VIIRS_NOAA20_NRT', instrument: 'VIIRS', satellites: ['N20'], share: 0.38, since: '2018-01-01', meanFrp: 9 },
]

export const DATE_MIN = '2015-01-01'

export const AREAS: { id: number; name: string; country_code: string | null; bbox: Bbox }[] = [
  { id: 1, name: 'Ukraine', country_code: 'UA', bbox: [22.1, 44.3, 40.3, 52.4] },
  { id: 2, name: 'California', country_code: 'US', bbox: [-124.5, 32.5, -114.1, 42.0] },
  { id: 3, name: 'Amazon Basin', country_code: null, bbox: [-74, -18, -44, 4] },
  { id: 4, name: 'Central Africa', country_code: null, bbox: [8, -18, 40, 14] },
  { id: 5, name: 'Southeast Asia', country_code: null, bbox: [92, 5, 110, 26] },
  { id: 6, name: 'Northern Australia', country_code: 'AU', bbox: [113, -26, 154, -10] },
  { id: 7, name: 'Siberia', country_code: 'RU', bbox: [70, 48, 150, 70] },
  { id: 8, name: 'Mediterranean', country_code: null, bbox: [-10, 30, 36, 46] },
]

interface Region {
  lat: number
  lon: number
  sLat: number
  sLon: number
  /** Mean detections per day at the seasonal peak. */
  weight: number
  /** Day of year of the peak. */
  peak: number
  /** Season half-width in days. */
  width: number
}

const REGIONS: Region[] = [
  { lat: 8, lon: 20, sLat: 3.5, sLon: 12, weight: 160, peak: 15, width: 45 },
  { lat: -12, lon: 25, sLat: 5, sLon: 9, weight: 220, peak: 230, width: 50 },
  { lat: -10, lon: -58, sLat: 5, sLon: 8, weight: 180, peak: 250, width: 35 },
  { lat: 18, lon: 101, sLat: 3.5, sLon: 4, weight: 120, peak: 80, width: 30 },
  { lat: -1, lon: 112, sLat: 2.5, sLon: 6, weight: 60, peak: 265, width: 30 },
  { lat: -16, lon: 133, sLat: 3, sLon: 9, weight: 90, peak: 290, width: 45 },
  { lat: 60, lon: 110, sLat: 4, sLon: 20, weight: 80, peak: 200, width: 30 },
  { lat: 58, lon: -115, sLat: 4, sLon: 15, weight: 70, peak: 190, width: 30 },
  { lat: 40, lon: -120, sLat: 3, sLon: 2.5, weight: 40, peak: 230, width: 35 },
  { lat: 49, lon: 32, sLat: 1.8, sLon: 5, weight: 45, peak: 95, width: 22 },
  { lat: 48.5, lon: 34, sLat: 1.8, sLon: 5, weight: 40, peak: 225, width: 28 },
  { lat: 39, lon: 15, sLat: 2.5, sLon: 12, weight: 35, peak: 215, width: 25 },
  { lat: 22, lon: 79, sLat: 4, sLon: 5, weight: 70, peak: 100, width: 30 },
  { lat: 16, lon: -90, sLat: 2.5, sLon: 4, weight: 40, peak: 115, width: 25 },
]

const OFF_SEASON = 0.04
const CONF_LEVELS: Confidence[] = ['low', 'nominal', 'high']
/** P(low), P(nominal), P(high) */
const CONF_SHARE = [0.12, 0.63, 0.25]
const DAY_SHARE = 0.68

export interface MockPoint {
  id: number
  lat: number
  lon: number
  /** Epoch ms. */
  t: number
  src: number
  sat: string
  conf: 0 | 1 | 2
  confRaw: string
  frp: number
  dn: DayNight
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function hash2(a: number, b: number): number {
  let h = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)
  h ^= h >>> 16
  return h >>> 0
}

function gauss(rng: () => number): number {
  const u = Math.max(rng(), 1e-12)
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng())
}

function dayOfYear(idx: number): number {
  const d = new Date(idx * 86_400_000)
  return Math.floor((d.getTime() - Date.UTC(d.getUTCFullYear(), 0, 1)) / 86_400_000)
}

function season(doy: number, r: Region): number {
  let dist = Math.abs(doy - r.peak)
  if (dist > 182.5) dist = 365 - dist
  return OFF_SEASON + (1 - OFF_SEASON) * Math.exp(-0.5 * (dist / r.width) ** 2)
}

function yearFactor(year: number, regionIdx: number): number {
  return 0.75 + 0.5 * mulberry32(hash2(year, regionIdx * 977 + 13))()
}

/** Number of detections region `ri` produces on day `idx` (before any filtering). */
function regionCount(idx: number, ri: number): number {
  const r = REGIONS[ri]
  const year = new Date(idx * 86_400_000).getUTCFullYear()
  const noise = 0.55 + 0.9 * mulberry32(hash2(idx, ri))()
  return Math.round(r.weight * season(dayOfYear(idx), r) * yearFactor(year, ri) * noise)
}

/** Sources that exist on this day, with shares renormalised to 1. */
function activeSources(day: string): { idx: number; share: number }[] {
  const active = SOURCES.map((s, idx) => ({ idx, share: s.share, since: s.since })).filter((s) => s.since <= day)
  const total = active.reduce((a, s) => a + s.share, 0)
  return active.map((s) => ({ idx: s.idx, share: s.share / total }))
}

function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

// --- Persistent fire complexes ---
// Large fires that burn for days in roughly the same place: they grow, peak
// and fade, the centre drifts a few km a day, and they radiate more than the
// scattered daily fronts. They are what the hotspot list is about. Each
// complex is derived from (year, region, k) only, so any day can be generated
// on its own and the result does not depend on which days were asked for first.

export interface FireComplex {
  /** Region index. */
  ri: number
  /** First and last day index (inclusive). */
  start: number
  end: number
  /** Detections per day at the peak (before day-to-day noise). */
  peak: number
  lat0: number
  lon0: number
  /** Drift per day, degrees. */
  dLat: number
  dLon: number
  /** Multiplier on the source mean FRP. */
  frpFactor: number
  seed: number
}

/** Complexes per region per year for each unit of region weight. */
const COMPLEXES_PER_WEIGHT = 1 / 2
const COMPLEX_MIN_DAYS = 4
const COMPLEX_MAX_DAYS = 20
const COMPLEX_MIN_PEAK = 8
const COMPLEX_MAX_PEAK = 320
/** Shape of the life cycle: f(u) = u^A (1 - u)^B, peak at A / (A + B) of the lifetime. */
const LIFE_A = 1.2
const LIFE_B = 2
const LIFE_MAX = (LIFE_A / (LIFE_A + LIFE_B)) ** LIFE_A * (LIFE_B / (LIFE_A + LIFE_B)) ** LIFE_B
const KM_PER_DEG = 111.2

const complexCache = new Map<number, FireComplex[]>()

/** Complexes of region `ri` whose season belongs to `year` (some start in December or end in January). */
function complexesOf(year: number, ri: number): FireComplex[] {
  const key = year * 64 + ri
  const cached = complexCache.get(key)
  if (cached) return cached
  const r = REGIONS[ri]
  const rng = mulberry32(hash2(year * 131 + 17, ri + 4099))
  const n = Math.round(r.weight * COMPLEXES_PER_WEIGHT * yearFactor(year, ri))
  const jan1 = Math.floor(Date.UTC(year, 0, 1) / 86_400_000)
  const out: FireComplex[] = []
  for (let k = 0; k < n; k++) {
    const days = COMPLEX_MIN_DAYS + Math.floor(rng() * (COMPLEX_MAX_DAYS - COMPLEX_MIN_DAYS + 1))
    const mid = r.peak + gauss(rng) * r.width
    const start = jan1 + Math.round(mid - days / 2)
    // Log-uniform: many modest complexes, a few huge ones.
    const peak = COMPLEX_MIN_PEAK * (COMPLEX_MAX_PEAK / COMPLEX_MIN_PEAK) ** (rng() ** 4.5)
    const lat0 = Math.max(-75, Math.min(75, r.lat + gauss(rng) * r.sLat * 0.8))
    const lon0 = wrapLon(r.lon + gauss(rng) * r.sLon * 0.8)
    const heading = rng() * 2 * Math.PI
    const speedKm = 0.5 + rng() * 3
    out.push({
      ri,
      start,
      end: start + days - 1,
      peak,
      lat0,
      lon0,
      dLat: (speedKm * Math.sin(heading)) / KM_PER_DEG,
      dLon: (speedKm * Math.cos(heading)) / (KM_PER_DEG * Math.cos(lat0 * (Math.PI / 180))),
      frpFactor: 1.4 + rng(),
      seed: hash2(year * 7919 + ri, k + 1),
    })
  }
  if (complexCache.size > 4000) complexCache.clear()
  complexCache.set(key, out)
  return out
}

/** Complexes burning on day `idx`, in a fixed order. */
export function activeComplexes(idx: number): FireComplex[] {
  const year = new Date(idx * 86_400_000).getUTCFullYear()
  const out: FireComplex[] = []
  for (let ri = 0; ri < REGIONS.length; ri++) {
    for (let y = year - 1; y <= year + 1; y++) for (const c of complexesOf(y, ri)) if (c.start <= idx && idx <= c.end) out.push(c)
  }
  return out
}

export interface ComplexDay {
  n: number
  lat: number
  lon: number
  /** Spread of the detections around the centre, km. */
  sigmaKm: number
  /** 0..1, where the complex is in its life cycle. */
  intensity: number
}

/** Size and position of a complex on day `idx`. */
export function complexOnDay(c: FireComplex, idx: number): ComplexDay {
  const days = c.end - c.start + 1
  const u = (idx - c.start + 0.5) / days
  const intensity = (u ** LIFE_A * (1 - u) ** LIFE_B) / LIFE_MAX
  const noise = 0.75 + 0.5 * mulberry32(hash2(c.seed, idx))()
  const t = idx - c.start
  return {
    n: Math.round(c.peak * intensity * noise),
    lat: c.lat0 + c.dLat * t,
    lon: wrapLon(c.lon0 + c.dLon * t),
    sigmaKm: (1.5 + 4 * Math.sqrt(c.peak / COMPLEX_MAX_PEAK)) * (0.6 + 0.4 * intensity),
    intensity,
  }
}

const dayCache = new Map<number, MockPoint[]>()
const DAY_CACHE_MAX = 1200

/** Day ids are idx * ID_STRIDE + sequence number. */
const ID_STRIDE = 10_000

export function generateDay(idx: number): MockPoint[] {
  const cached = dayCache.get(idx)
  if (cached) return cached

  const day = dayFromIndex(idx)
  const sources = activeSources(day)
  const points: MockPoint[] = []
  if (sources.length === 0) return points
  let seq = 0

  const push = (rng: () => number, lat: number, lon: number, frpFactor: number) => {
    if (seq >= ID_STRIDE) return
    let pick = rng()
    let src = sources[sources.length - 1].idx
    for (const s of sources) {
      if (pick < s.share) {
        src = s.idx
        break
      }
      pick -= s.share
    }
    const source = SOURCES[src]

    const cr = rng()
    const conf = (cr < CONF_SHARE[0] ? 0 : cr < CONF_SHARE[0] + CONF_SHARE[1] ? 1 : 2) as 0 | 1 | 2
    const confRaw =
      source.instrument === 'MODIS'
        ? String(conf === 0 ? Math.floor(rng() * 30) : conf === 1 ? 30 + Math.floor(rng() * 50) : 80 + Math.floor(rng() * 21))
        : 'lnh'[conf]

    const dn: DayNight = rng() < DAY_SHARE ? 'D' : 'N'
    // Overpasses: early afternoon for day, after midnight for night (local solar time).
    const localHour = (dn === 'D' ? 13.5 : 1.5) + gauss(rng) * 0.6
    const utcHour = (((localHour - lon / 15) % 24) + 24) % 24
    const frp = +(source.meanFrp * 0.6 * frpFactor * Math.exp(gauss(rng) * 0.9)).toFixed(1)

    points.push({
      id: idx * ID_STRIDE + seq++,
      lat: +lat.toFixed(5),
      lon: +lon.toFixed(5),
      t: idx * 86_400_000 + Math.floor(utcHour * 3_600_000),
      src,
      sat: source.satellites[Math.floor(rng() * source.satellites.length)],
      conf,
      confRaw,
      frp,
      dn,
    })
  }

  for (let ri = 0; ri < REGIONS.length; ri++) {
    const r = REGIONS[ri]
    const n = regionCount(idx, ri)
    if (n === 0) continue
    const rng = mulberry32(hash2(idx * 31 + 7, ri))

    // A few active fire fronts per region per day; points huddle around them.
    const fronts = Math.max(1, Math.round(n / 14))
    const centres: [number, number][] = []
    for (let k = 0; k < fronts; k++) {
      centres.push([r.lat + gauss(rng) * r.sLat, r.lon + gauss(rng) * r.sLon])
    }

    for (let i = 0; i < n; i++) {
      const c = centres[Math.floor(rng() * fronts)]
      const lat = Math.max(-89.9, Math.min(89.9, c[0] + gauss(rng) * 0.12))
      push(rng, lat, wrapLon(c[1] + gauss(rng) * 0.16), 1)
    }
  }

  for (const c of activeComplexes(idx)) {
    const d = complexOnDay(c, idx)
    if (d.n <= 0) continue
    const rng = mulberry32(hash2(c.seed ^ 0x5bd1e995, idx))
    const sLat = d.sigmaKm / KM_PER_DEG
    const sLon = sLat / Math.cos(d.lat * (Math.PI / 180))
    // Hotter at the peak of the life cycle.
    const frpFactor = c.frpFactor * (0.6 + 0.4 * d.intensity)
    for (let i = 0; i < d.n; i++) push(rng, d.lat + gauss(rng) * sLat, wrapLon(d.lon + gauss(rng) * sLon), frpFactor)
  }

  if (dayCache.size >= DAY_CACHE_MAX) dayCache.delete(dayCache.keys().next().value as number)
  dayCache.set(idx, points)
  return points
}

export function pointById(id: number): MockPoint | undefined {
  if (!Number.isSafeInteger(id) || id < 0) return undefined
  const day = generateDay(Math.floor(id / ID_STRIDE))
  // Ids within a day are the sequence numbers, in order.
  const p = day[id % ID_STRIDE]
  return p?.id === id ? p : undefined
}

export function inBbox(lat: number, lon: number, b: Bbox): boolean {
  const [w, s, e, n] = b
  if (lat < s || lat > n) return false
  return w <= e ? lon >= w && lon <= e : lon >= w || lon <= e
}

export function resolveBbox(f: CommonFilters): Bbox | undefined {
  if (f.area_id != null) {
    const area = AREAS.find((a) => a.id === f.area_id)
    if (!area) throw new ApiError(404, 'Area not found')
    return area.bbox
  }
  return f.bbox
}

export function makeMatcher(f: CommonFilters): (p: MockPoint) => boolean {
  const bbox = resolveBbox(f)
  const srcSet = f.source?.length ? new Set(f.source) : null
  const minConf = f.min_confidence ? CONF_LEVELS.indexOf(f.min_confidence) : 0
  return (p) =>
    p.conf >= minConf &&
    (!f.daynight || p.dn === f.daynight) &&
    (!srcSet || srcSet.has(SOURCES[p.src].source_product)) &&
    (!bbox || inBbox(p.lat, p.lon, bbox))
}

export function confidenceLabel(c: 0 | 1 | 2): Confidence {
  return CONF_LEVELS[c]
}

// --- Analytic estimate, used for multi-year aggregations where generating
// --- every point would be wasteful.

function normCdf(x: number): number {
  // Abramowitz-Stegun 7.1.26
  const t = 1 / (1 + 0.3275911 * Math.abs(x) * Math.SQRT1_2)
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-(x * x) / 2)
  return x >= 0 ? 0.5 * (1 + y) : 0.5 * (1 - y)
}

function spatialFraction(r: Region, b: Bbox | undefined): number {
  if (!b) return 1
  const [w, s, e, n] = b
  const latF = normCdf((n - r.lat) / r.sLat) - normCdf((s - r.lat) / r.sLat)
  const span = (lo: number, hi: number) => normCdf((hi - r.lon) / r.sLon) - normCdf((lo - r.lon) / r.sLon)
  const lonF = w <= e ? span(w, e) : span(w, 180) + span(-180, e)
  return Math.max(0, latF) * Math.max(0, Math.min(1, lonF))
}

const FRP_MEAN_FACTOR = 0.6 * Math.exp(0.9 ** 2 / 2)

export interface DayEstimate {
  count: number
  frpSum: number
  bySource: number[]
}

/** Returns a function estimating one day's totals for the given filters. */
export function makeEstimator(f: CommonFilters): (idx: number) => DayEstimate {
  const bbox = resolveBbox(f)
  const fractions = REGIONS.map((r) => spatialFraction(r, bbox))
  const minConf = f.min_confidence ? CONF_LEVELS.indexOf(f.min_confidence) : 0
  const confF = CONF_SHARE.slice(minConf).reduce((a, b) => a + b, 0)
  const dnF = f.daynight === 'D' ? DAY_SHARE : f.daynight === 'N' ? 1 - DAY_SHARE : 1
  const srcSet = f.source?.length ? new Set(f.source) : null

  /** Share of a complex's detections inside the bbox, from its centre and spread. */
  const complexFraction = (d: ComplexDay): number => {
    if (!bbox) return 1
    const sLat = d.sigmaKm / KM_PER_DEG
    const sLon = sLat / Math.cos(d.lat * (Math.PI / 180))
    return spatialFraction({ lat: d.lat, lon: d.lon, sLat, sLon, weight: 0, peak: 0, width: 1 }, bbox)
  }

  return (idx) => {
    let base = 0
    for (let ri = 0; ri < REGIONS.length; ri++) {
      if (fractions[ri] > 1e-4) base += regionCount(idx, ri) * fractions[ri]
    }
    // Complexes: detections and their extra radiative power.
    let extra = 0
    let extraFrpWeight = 0
    for (const c of activeComplexes(idx)) {
      const d = complexOnDay(c, idx)
      if (d.n <= 0) continue
      const f = complexFraction(d)
      if (f <= 1e-4) continue
      extra += d.n * f
      extraFrpWeight += d.n * f * c.frpFactor * (0.6 + 0.4 * d.intensity)
    }
    const filterF = confF * dnF
    base *= filterF
    extra *= filterF
    extraFrpWeight *= filterF
    const bySource = SOURCES.map(() => 0)
    let count = 0
    let frpSum = 0
    for (const s of activeSources(dayFromIndex(idx))) {
      if (srcSet && !srcSet.has(SOURCES[s.idx].source_product)) continue
      const c = (base + extra) * s.share
      bySource[s.idx] = c
      count += c
      // E[0.6 exp(0.9 g)] = 0.6 exp(0.405), about 0.9 of the source mean.
      frpSum += (base + extraFrpWeight) * s.share * SOURCES[s.idx].meanFrp * FRP_MEAN_FACTOR
    }
    return { count, frpSum, bySource }
  }
}

export { dayIndex }
