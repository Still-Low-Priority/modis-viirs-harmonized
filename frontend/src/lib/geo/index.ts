// Offline gazetteer: countries, first-level regions and cities, built from
// Natural Earth (public domain) into static files under /geo/ and loaded on
// demand. No external geocoding service is called at runtime.
//
// Data is produced by scripts/build-geo.mjs; see that file for the layout of
// places.json and the data decisions (codes, antimeridian, dropped items).

import type { Bbox } from '../../api/types'
import type { MultiPolygon, NearestPlace, Place, PlaceKind } from './types'

export type * from './types'

// ---------- raw file layout (keep in sync with scripts/build-geo.mjs) ----------

type CountryRow = [code: string, name: string, alts: string, w: number, s: number, e: number, n: number, lat: number, lon: number, population: number]
type RegionRow = [id: string, name: string, alts: string, cc: string, w: number, s: number, e: number, n: number, lat: number, lon: number, areaKm2: number]
type CityRow = [id: string, name: string, alts: string, cc: string, region: string, lat: number, lon: number, population: number]

interface PlacesFile {
  v: number
  countries: CountryRow[]
  regions: RegionRow[]
  cities: CityRow[]
  extraCountryNames?: Record<string, string>
}

interface IndexEntry {
  place: Place
  /** Normalized primary name followed by normalized alternates. */
  names: string[]
  kindRank: number
  importance: number
}

interface Gazetteer {
  places: Place[]
  entries: IndexEntry[]
  cities: Place[]
  grid: Map<number, Place[]>
}

// ---------- helpers ----------

const EMPTY: Gazetteer = { places: [], entries: [], cities: [], grid: new Map() }
const KIND_RANK: Record<PlaceKind, number> = { country: 0, region: 1, city: 2 }
const EARTH_KM = 6371
const KM_PER_DEG = 111.195
const CITY_HALF_KM = 25
const CELL_DEG = 2
const GRID_COLS = 360 / CELL_DEG
const GRID_ROWS = 180 / CELL_DEG

/** Letters that NFD does not decompose. */
const FOLD: Record<string, string> = { ß: 'ss', ø: 'o', đ: 'd', ð: 'd', ł: 'l', ı: 'i', æ: 'ae', œ: 'oe', þ: 'th', ħ: 'h' }

/** Lowercase, strip diacritics and apostrophes, collapse punctuation to single spaces. */
function normalizeName(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ßøđðłıæœþħ]/g, (c) => FOLD[c] ?? c)
    .replace(/['’ʼ`]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

let warned = false
function warnOnce(message: string, err?: unknown) {
  if (warned) return
  warned = true
  console.warn(`[geo] ${message}`, err ?? '')
}

function geoUrl(path: string): string {
  const base = import.meta.env.BASE_URL ?? '/'
  return `${base.endsWith('/') ? base : `${base}/`}geo/${path}`
}

function cityBbox(lat: number, lon: number): Bbox {
  const dLat = CITY_HALF_KM / KM_PER_DEG
  const cos = Math.max(Math.cos((lat * Math.PI) / 180), 0.05)
  const dLon = Math.min(CITY_HALF_KM / (KM_PER_DEG * cos), 179)
  let w = lon - dLon
  let e = lon + dLon
  // Wrap across the antimeridian; west > east marks a crossing box.
  if (w < -180) w += 360
  if (e > 180) e -= 360
  const r = (x: number) => Math.round(x * 1000) / 1000
  return [r(w), r(Math.max(-90, lat - dLat)), r(e), r(Math.min(90, lat + dLat))]
}

function splitAlts(alts: string): string[] {
  return alts ? alts.split('|') : []
}

function cellKey(row: number, col: number): number {
  return row * GRID_COLS + col
}

function cellOf(lat: number, lon: number): [row: number, col: number] {
  const row = Math.min(GRID_ROWS - 1, Math.max(0, Math.floor((lat + 90) / CELL_DEG)))
  const col = ((Math.floor((lon + 180) / CELL_DEG) % GRID_COLS) + GRID_COLS) % GRID_COLS
  return [row, col]
}

function haversineKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const rad = Math.PI / 180
  const dLat = (lat2 - lat1) * rad
  const dLon = (lon2 - lon1) * rad
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2
  return 2 * EARTH_KM * Math.asin(Math.min(1, Math.sqrt(a)))
}

// ---------- index ----------

function decode(file: PlacesFile): Gazetteer {
  const countryNames = new Map<string, string>(Object.entries(file.extraCountryNames ?? {}))
  for (const c of file.countries) countryNames.set(c[0], c[1])
  const nameOf = (cc: string) => countryNames.get(cc) ?? cc

  const places: Place[] = []
  const entries: IndexEntry[] = []
  const cities: Place[] = []
  const grid = new Map<number, Place[]>()

  const add = (place: Place, alts: string[], importance: number) => {
    places.push(place)
    const names = [normalizeName(place.name)]
    for (const a of alts) {
      const n = normalizeName(a)
      if (n && !names.includes(n)) names.push(n)
    }
    entries.push({ place, names, kindRank: KIND_RANK[place.kind], importance })
  }

  for (const [code, name, alts, w, s, e, n, lat, lon, pop] of file.countries) {
    add({ id: `country:${code}`, kind: 'country', name, countryCode: code, countryName: name, bbox: [w, s, e, n], lat, lon }, splitAlts(alts), pop)
  }
  for (const [id, name, alts, cc, w, s, e, n, lat, lon, area] of file.regions) {
    add({ id: `region:${id}`, kind: 'region', name, countryCode: cc, countryName: nameOf(cc), bbox: [w, s, e, n], lat, lon }, splitAlts(alts), area)
  }
  for (const [id, name, alts, cc, region, lat, lon, pop] of file.cities) {
    const place: Place = {
      id: `city:${id}`,
      kind: 'city',
      name,
      countryCode: cc,
      countryName: nameOf(cc),
      ...(region ? { regionName: region } : {}),
      bbox: cityBbox(lat, lon),
      lat,
      lon,
    }
    add(place, splitAlts(alts), pop)
    cities.push(place)
    const [row, col] = cellOf(lat, lon)
    const key = cellKey(row, col)
    const bucket = grid.get(key)
    if (bucket) bucket.push(place)
    else grid.set(key, [place])
  }
  return { places, entries, cities, grid }
}

let gazetteer: Promise<Gazetteer> | null = null

/** Resolves to the decoded index, or to an empty one when the file cannot be loaded. */
function loadGazetteer(): Promise<Gazetteer> {
  if (!gazetteer) {
    gazetteer = (async () => {
      try {
        const res = await fetch(geoUrl('places.json'))
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const file = (await res.json()) as PlacesFile
        if (!file || !Array.isArray(file.countries) || !Array.isArray(file.regions) || !Array.isArray(file.cities)) {
          throw new Error('unexpected places.json layout')
        }
        return decode(file)
      } catch (err) {
        warnOnce('place index unavailable; search and place names are disabled', err)
        // Allow a later call to retry (e.g. after a network blip).
        gazetteer = null
        return EMPTY
      }
    })()
  }
  return gazetteer
}

/** Loads the place index once. Safe to call repeatedly. */
export async function loadPlaces(): Promise<Place[]> {
  return (await loadGazetteer()).places
}

// ---------- search ----------

/** 0 exact, 1 prefix, 2 word prefix, 3 substring, -1 no match. */
function matchScore(name: string, q: string): number {
  if (name === q) return 0
  if (name.startsWith(q)) return 1
  if (name.includes(` ${q}`)) return 2
  return name.includes(q) ? 3 : -1
}

/**
 * Ranked search over countries, regions and cities. Case- and
 * diacritic-insensitive, prefix matches first. Resolves to [] for a blank query.
 */
export async function searchPlaces(query: string, limit = 8): Promise<Place[]> {
  const q = normalizeName(query)
  if (!q || limit <= 0) return []
  const { entries } = await loadGazetteer()
  const hits: { entry: IndexEntry; score: number; viaAlt: number }[] = []
  for (const entry of entries) {
    let best = -1
    let viaAlt = 0
    for (let i = 0; i < entry.names.length; i++) {
      const s = matchScore(entry.names[i], q)
      if (s >= 0 && (best < 0 || s < best)) {
        best = s
        viaAlt = i === 0 ? 0 : 1
        if (s === 0) break
      }
    }
    if (best >= 0) hits.push({ entry, score: best, viaAlt })
  }
  hits.sort(
    (a, b) =>
      a.score - b.score ||
      a.viaAlt - b.viaAlt ||
      a.entry.kindRank - b.entry.kindRank ||
      b.entry.importance - a.entry.importance ||
      a.entry.place.name.localeCompare(b.entry.place.name),
  )
  return hits.slice(0, limit).map((h) => h.entry.place)
}

// ---------- nearest city ----------

/** Nearest city to a point, with its region and country; null when the index is unavailable. */
export async function nearestPlace(lat: number, lon: number): Promise<NearestPlace | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null
  const { grid, cities } = await loadGazetteer()
  if (cities.length === 0) return null

  const [row0, col0] = cellOf(lat, lon)
  let best: Place | null = null
  let bestKm = Infinity
  const visit = (row: number, col: number) => {
    if (row < 0 || row >= GRID_ROWS) return
    const bucket = grid.get(cellKey(row, ((col % GRID_COLS) + GRID_COLS) % GRID_COLS))
    if (!bucket) return
    for (const c of bucket) {
      const d = haversineKm(lat, lon, c.lat, c.lon)
      if (d < bestKm) {
        bestKm = d
        best = c
      }
    }
  }

  const maxRing = Math.max(GRID_ROWS, GRID_COLS / 2)
  for (let r = 0; r <= maxRing; r++) {
    if (r === 0) visit(row0, col0)
    else {
      const lonSpan = 2 * r + 1 >= GRID_COLS
      for (let dc = -r; dc <= r; dc++) {
        visit(row0 - r, col0 + dc)
        visit(row0 + r, col0 + dc)
      }
      if (!lonSpan) {
        for (let dr = -r + 1; dr <= r - 1; dr++) {
          visit(row0 + dr, col0 - r)
          visit(row0 + dr, col0 + r)
        }
      }
    }
    if (best) {
      // Lower bound on the distance to any city outside the scanned box.
      const south = (row0 - r) * CELL_DEG - 90
      const north = (row0 + r + 1) * CELL_DEG - 90
      const latKm = Math.min(south <= -90 ? Infinity : lat - south, north >= 90 ? Infinity : north - lat) * KM_PER_DEG
      let lonKm = Infinity
      if ((2 * r + 1) * CELL_DEG < 360) {
        const west = (col0 - r) * CELL_DEG - 180
        const east = (col0 + r + 1) * CELL_DEG - 180
        const maxAbsLat = Math.min(90, Math.max(Math.abs(south), Math.abs(north)))
        lonKm = Math.min(lon - west, east - lon) * KM_PER_DEG * Math.cos((maxAbsLat * Math.PI) / 180)
      }
      // Margin for the difference between parallels and great circles.
      if (Math.min(latKm, lonKm) * 0.8 >= bestKm) break
    }
  }
  if (!best) return null
  const city: Place = best
  return {
    city: city.name,
    ...(city.regionName ? { region: city.regionName } : {}),
    countryCode: city.countryCode,
    countryName: city.countryName,
    distanceKm: Math.round(bestKm * 10) / 10,
  }
}

// ---------- country outlines ----------

const outlines = new Map<string, Promise<MultiPolygon | null>>()

/** Outline of a country by ISO alpha-2 code; null when there is none for that code. */
export async function loadCountryPolygon(countryCode: string): Promise<MultiPolygon | null> {
  const code = countryCode.trim().toUpperCase()
  if (!/^[A-Z]{2}$/.test(code)) return null
  let pending = outlines.get(code)
  if (!pending) {
    pending = (async () => {
      let res: Response
      try {
        res = await fetch(geoUrl(`countries/${code}.json`))
      } catch (err) {
        warnOnce(`country outline ${code} unavailable`, err)
        outlines.delete(code)
        return null
      }
      if (!res.ok) {
        if (res.status !== 404) {
          warnOnce(`country outline ${code}: HTTP ${res.status}`)
          outlines.delete(code)
        }
        return null
      }
      try {
        const data: unknown = await res.json()
        // A dev server may answer unknown paths with index.html; treat anything
        // that is not an array of polygons as "no outline".
        return Array.isArray(data) && data.length > 0 ? (data as MultiPolygon) : null
      } catch {
        return null
      }
    })()
    outlines.set(code, pending)
  }
  return pending
}

// ---------- point in polygon ----------

const polygonBoxes = new WeakMap<MultiPolygon, Bbox[]>()

function boxesOf(polygon: MultiPolygon): Bbox[] {
  let boxes = polygonBoxes.get(polygon)
  if (!boxes) {
    boxes = polygon.map((rings) => {
      let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity
      for (const [x, y] of rings[0] ?? []) {
        if (x < w) w = x
        if (x > e) e = x
        if (y < s) s = y
        if (y > n) n = y
      }
      return [w, s, e, n] as Bbox
    })
    polygonBoxes.set(polygon, boxes)
  }
  return boxes
}

function inRing(lat: number, lon: number, ring: [number, number][]): boolean {
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i]
    const [xj, yj] = ring[j]
    if (yi > lat !== yj > lat && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Ray-casting point-in-polygon test, holes respected. */
export function pointInPolygon(lat: number, lon: number, polygon: MultiPolygon): boolean {
  const boxes = boxesOf(polygon)
  for (let p = 0; p < polygon.length; p++) {
    const [w, s, e, n] = boxes[p]
    if (lon < w || lon > e || lat < s || lat > n) continue
    const rings = polygon[p]
    if (!inRing(lat, lon, rings[0])) continue
    let inHole = false
    for (let h = 1; h < rings.length; h++) {
      if (inRing(lat, lon, rings[h])) {
        inHole = true
        break
      }
    }
    if (!inHole) return true
  }
  return false
}
