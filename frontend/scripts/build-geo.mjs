#!/usr/bin/env node
// Builds the offline gazetteer under public/geo/ from Natural Earth (public
// domain) GeoJSON published in the nvkelso/natural-earth-vector repository.
//
//   node scripts/build-geo.mjs              download and build
//   node scripts/build-geo.mjs --cache DIR  reuse/keep downloaded files in DIR
//
// Node built-ins only (fetch, fs, zlib). Output:
//
//   public/geo/places.json          search index (layout below)
//   public/geo/countries/<ISO2>.json one MultiPolygon per country
//
// places.json layout (arrays of arrays, column order fixed by `v`):
//   {
//     "v": 1,
//     "countries": [[code, name, alts, west, south, east, north, lat, lon, population], ...],
//     "regions":   [[id, name, alts, countryCode, west, south, east, north, lat, lon, areaKm2], ...],
//     "cities":    [[id, name, alts, countryCode, regionName, lat, lon, population], ...],
//     "extraCountryNames": { code: name }  // country names for codes without an outline
//   }
//   `alts` is a "|"-separated list of alternate English names ("" when none).
//   Bboxes use the project convention: west > east means the box crosses the
//   antimeridian.
//
// Data decisions:
// - Country codes: ISO_A2, falling back to ISO_A2_EH, WB_A2 and a manual map
//   (France and Norway have ISO_A2 "-99"). Features that resolve to the same
//   code are merged (Somaliland into SO, Northern Cyprus into CY, Indian Ocean
//   Territories and Ashmore and Cartier Islands into AU). Features with no
//   resolvable code (Siachen Glacier) are dropped.
// - Country bbox = the main landmass: the largest part plus parts that are at
//   least 1% of its area and lie within ~30 degrees of it. So the USA box is
//   the contiguous states (Alaska and Hawaii stay in the outline, only the
//   fly-to box excludes them), France is metropolitan France, Russia runs from
//   the Baltic to 180 (the sliver of Chukotka east of 180 is not included).
//   Regions use the same rule with the same thresholds, which keeps Alaska's
//   box off the Aleutians. If the kept parts still cross the antimeridian the
//   box is emitted with west > east.
// - Outlines: 50m geometry, coordinates rounded to 2 decimals, parts smaller
//   than ~25 km2 dropped (the largest part of a country is always kept).

import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = join(ROOT, 'public', 'geo')
const BASE = 'https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/'
const SOURCES = {
  countries: 'ne_50m_admin_0_countries.geojson',
  regions: 'ne_10m_admin_1_states_provinces.geojson',
  cities: 'ne_10m_populated_places.geojson',
}

/** Codes for features whose ISO_A2, ISO_A2_EH and WB_A2 are all unusable. */
const MANUAL_CODES = { Somaliland: 'SO', 'N. Cyprus': 'CY' }
/** ADM0_A3 -> ISO2 for regions and cities whose own ISO code is missing. */
const MANUAL_A3 = { SOL: 'SO', CYN: 'CY', KOS: 'XK' }
/** Extra English names (historic or common exonyms) by "CC|name". */
const EXTRA_ALTS = {
  'CN|Beijing': ['Peking'],
  'CN|Guangzhou': ['Canton'],
  'CN|Nanjing': ['Nanking'],
  'CN|Chongqing': ['Chungking'],
  'IN|Mumbai': ['Bombay'],
  'IN|Kolkata': ['Calcutta'],
  'IN|Chennai': ['Madras'],
  'IN|Bengaluru': ['Bangalore'],
  'IN|Bangalore': ['Bengaluru'],
  'VN|Ho Chi Minh City': ['Saigon'],
  'MM|Yangon': ['Rangoon'],
  'UA|Kyiv': ['Kiev'],
  'UA|Odessa': ['Odesa'],
  'UA|Kharkiv': ['Kharkov'],
  'UA|Lviv': ['Lvov', 'Lemberg'],
  'KZ|Almaty': ['Alma-Ata'],
  'TR|Istanbul': ['Constantinople'],
}

/**
 * Names for codes that appear on regions or cities but have no outline of
 * their own (Natural Earth folds them into the sovereign country).
 */
const DEPENDENCY_NAMES = {
  GF: 'French Guiana',
  GP: 'Guadeloupe',
  MQ: 'Martinique',
  RE: 'Reunion',
  YT: 'Mayotte',
  TK: 'Tokelau',
  GI: 'Gibraltar',
  SJ: 'Svalbard and Jan Mayen',
  UM: 'United States Minor Outlying Islands',
  BQ: 'Caribbean Netherlands',
  CX: 'Christmas Island',
  CC: 'Cocos (Keeling) Islands',
}

const MIN_PART_KM2 = 25
const BBOX_MIN_SHARE = 0.01
const BBOX_MAX_DEG = 30

const args = process.argv.slice(2)
const cacheIdx = args.indexOf('--cache')
const cacheDir = cacheIdx >= 0 ? args[cacheIdx + 1] : null

async function download(file) {
  if (cacheDir) {
    const p = join(cacheDir, file)
    if (existsSync(p)) {
      console.log(`using cached ${p}`)
      return JSON.parse(readFileSync(p, 'utf8'))
    }
  }
  const url = BASE + file
  console.log(`downloading ${url}`)
  const res = await fetch(url)
  if (!res.ok) throw new Error(`download failed: ${url} -> HTTP ${res.status}`)
  const text = await res.text()
  let json
  try {
    json = JSON.parse(text)
  } catch (err) {
    throw new Error(`download of ${url} is not valid JSON: ${err.message}`)
  }
  if (!Array.isArray(json.features) || json.features.length === 0) {
    throw new Error(`download of ${url} has no features`)
  }
  if (cacheDir) {
    mkdirSync(cacheDir, { recursive: true })
    writeFileSync(join(cacheDir, file), text)
  }
  return json
}

// ---------- helpers ----------

const r2 = (x) => Math.round(x * 100) / 100
const r3 = (x) => Math.round(x * 1000) / 1000
const validIso2 = (c) => typeof c === 'string' && /^[A-Z]{2}$/.test(c)
const clean = (s) => (typeof s === 'string' ? s.trim() : '')

function norm(s) {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()
}

/** Primary name first, then unique alternates; returns [name, "alt|alt"]. */
function names(primary, candidates) {
  const seen = new Set([norm(primary)])
  const alts = []
  for (const c of candidates) {
    for (const part of clean(c).split('|')) {
      const v = part.trim()
      if (!v || v.length > 60) continue
      // Abbreviations ("Tex.", "TX", "Ind.") would win exact matches against
      // real names, and comma lists ("Dongguan, Guangdong") are not names.
      if (v.endsWith('.') || /^[A-Z]{1,3}$/.test(v) || v.includes(',')) continue
      // Skip non-Latin script entries: search is for English names.
      if (!/^[\p{Script=Latin}\p{N}\s'’.,()-]+$/u.test(v)) continue
      const n = norm(v)
      if (!n || seen.has(n)) continue
      seen.add(n)
      alts.push(v)
    }
  }
  return [primary, alts.join('|')]
}

function polygonsOf(geometry) {
  if (!geometry) return []
  if (geometry.type === 'Polygon') return [geometry.coordinates]
  if (geometry.type === 'MultiPolygon') return geometry.coordinates
  return []
}

/** Approximate area of a ring in km2 (equirectangular, fine for ranking). */
function ringAreaKm2(ring) {
  let a = 0
  let latSum = 0
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    a += (ring[j][0] - ring[i][0]) * (ring[j][1] + ring[i][1])
    latSum += ring[i][1]
  }
  const lat = latSum / ring.length
  return (Math.abs(a / 2) * 111.32 * 111.32 * Math.cos((lat * Math.PI) / 180))
}

function partInfo(poly) {
  const outer = poly[0]
  let w = Infinity, s = Infinity, e = -Infinity, n = -Infinity, sx = 0, sy = 0
  for (const [x, y] of outer) {
    if (x < w) w = x
    if (x > e) e = x
    if (y < s) s = y
    if (y > n) n = y
    sx += x
    sy += y
  }
  return { poly, area: ringAreaKm2(outer), w, s, e, n, cx: sx / outer.length, cy: sy / outer.length }
}

/** Degree-equivalent distance between two points, wrapping longitude. */
function degDist(ax, ay, bx, by) {
  let dx = Math.abs(ax - bx)
  if (dx > 180) dx = 360 - dx
  dx *= Math.cos((((ay + by) / 2) * Math.PI) / 180)
  return Math.hypot(dx, ay - by)
}

/**
 * Bbox of the main landmass of a set of polygons. Returns [w, s, e, n] where
 * w > e means the box crosses the antimeridian.
 */
function mainBbox(polys) {
  const parts = polys.map(partInfo).filter((p) => Number.isFinite(p.w))
  if (parts.length === 0) return null
  parts.sort((a, b) => b.area - a.area)
  const main = parts[0]
  const kept = parts.filter(
    (p) => p === main || (p.area >= main.area * BBOX_MIN_SHARE && degDist(p.cx, p.cy, main.cx, main.cy) <= BBOX_MAX_DEG),
  )
  let s = Infinity, n = -Infinity
  let w1 = Infinity, e1 = -Infinity, w2 = Infinity, e2 = -Infinity
  for (const p of kept) {
    s = Math.min(s, p.s)
    n = Math.max(n, p.n)
    w1 = Math.min(w1, p.w)
    e1 = Math.max(e1, p.e)
    // Same extent with longitudes shifted to 0..360.
    const pw = p.w < 0 ? p.w + 360 : p.w
    const pe = p.e < 0 ? p.e + 360 : p.e
    // A part that itself straddles 0 cannot be expressed in the shifted frame.
    if (p.w < 0 && p.e >= 0) {
      w2 = -Infinity
    } else {
      w2 = Math.min(w2, pw)
      e2 = Math.max(e2, pe)
    }
  }
  const span1 = e1 - w1
  const span2 = Number.isFinite(w2) ? e2 - w2 : Infinity
  let w = w1, e = e1
  if (span2 + 1e-9 < span1) {
    w = w2 > 180 ? w2 - 360 : w2
    e = e2 > 180 ? e2 - 360 : e2
  }
  // Round outwards so the box still contains the shape.
  const box = [Math.floor(w * 100) / 100, Math.floor(s * 100) / 100, Math.ceil(e * 100) / 100, Math.ceil(n * 100) / 100]
  box[0] = Math.max(-180, box[0])
  box[2] = Math.min(180, box[2])
  box[1] = Math.max(-90, box[1])
  box[3] = Math.min(90, box[3])
  return box
}

function roundRing(ring) {
  const out = []
  for (const [x, y] of ring) {
    const p = [r2(x), r2(y)]
    const last = out[out.length - 1]
    if (last && last[0] === p[0] && last[1] === p[1]) continue
    out.push(p)
  }
  // Drop collinear middle points on straight runs (common after rounding).
  const simplified = []
  for (let i = 0; i < out.length; i++) {
    const a = simplified[simplified.length - 1]
    const b = out[i]
    const c = out[i + 1]
    if (a && c && (b[0] - a[0]) * (c[1] - a[1]) === (b[1] - a[1]) * (c[0] - a[0])) continue
    simplified.push(b)
  }
  const first = simplified[0]
  const last = simplified[simplified.length - 1]
  if (first && (first[0] !== last[0] || first[1] !== last[1])) simplified.push([first[0], first[1]])
  return simplified.length >= 4 ? simplified : null
}

function outline(polys) {
  const parts = polys.map((poly) => ({ poly, area: ringAreaKm2(poly[0]) })).sort((a, b) => b.area - a.area)
  const result = []
  parts.forEach(({ poly, area }, i) => {
    if (i > 0 && area < MIN_PART_KM2) return
    const outer = roundRing(poly[0])
    if (!outer) return
    const holes = []
    for (const h of poly.slice(1)) {
      if (ringAreaKm2(h) < MIN_PART_KM2) continue
      const rh = roundRing(h)
      if (rh) holes.push(rh)
    }
    result.push([outer, ...holes])
  })
  return result
}

// ---------- build ----------

const [countriesGj, regionsGj, citiesGj] = await Promise.all([
  download(SOURCES.countries),
  download(SOURCES.regions),
  download(SOURCES.cities),
])

// Countries
const byCode = new Map()
const a3ToCode = new Map(Object.entries(MANUAL_A3))
const dropped = []
const merged = []
for (const f of countriesGj.features) {
  const p = f.properties
  const name = clean(p.NAME_EN) || clean(p.NAME)
  const primaryIso = validIso2(p.ISO_A2) ? p.ISO_A2 : null
  const code = primaryIso || [p.ISO_A2_EH, p.WB_A2].find(validIso2) || MANUAL_CODES[clean(p.NAME)] || null
  if (!code) {
    dropped.push(`country ${p.NAME} (no ISO code)`)
    continue
  }
  if (p.ADM0_A3) a3ToCode.set(p.ADM0_A3, code)
  const polys = polygonsOf(f.geometry)
  const entry = byCode.get(code)
  if (entry) {
    merged.push(`${p.NAME} -> ${code}`)
    entry.polys.push(...polys)
    entry.population += Number(p.POP_EST) || 0
    // The feature whose own ISO_A2 is this code names the country.
    if (primaryIso && !entry.primary) {
      Object.assign(entry, { name, primary: true, labelX: p.LABEL_X, labelY: p.LABEL_Y, altSrc: [p.NAME, p.NAME_LONG, p.NAME_ALT, p.ADMIN, p.NAME_SORT] })
    }
    continue
  }
  byCode.set(code, {
    code,
    name,
    primary: Boolean(primaryIso),
    polys: [...polys],
    population: Number(p.POP_EST) || 0,
    labelX: p.LABEL_X,
    labelY: p.LABEL_Y,
    altSrc: [p.NAME, p.NAME_LONG, p.NAME_ALT, p.ADMIN, p.NAME_SORT],
  })
}

const countryName = new Map()
const countryRows = []
rmSync(join(OUT, 'countries'), { recursive: true, force: true })
mkdirSync(join(OUT, 'countries'), { recursive: true })
let outlineBytes = 0
let outlineGzip = 0
for (const c of [...byCode.values()].sort((a, b) => a.code.localeCompare(b.code))) {
  const bbox = mainBbox(c.polys)
  if (!bbox) {
    dropped.push(`country ${c.name} (no geometry)`)
    continue
  }
  countryName.set(c.code, c.name)
  const [name, alts] = names(c.name, [...c.altSrc, ...(EXTRA_ALTS[`${c.code}|${c.name}`] ?? [])])
  countryRows.push([c.code, name, alts, ...bbox, r3(c.labelY), r3(c.labelX), c.population])
  const shape = JSON.stringify(outline(c.polys))
  writeFileSync(join(OUT, 'countries', `${c.code}.json`), shape)
  outlineBytes += shape.length
  outlineGzip += gzipSync(shape).length
}

const codeFor = (iso, a3) => (validIso2(iso) ? iso : a3ToCode.get(a3) ?? null)
const extraCountryNames = {}

// Regions
const regionRows = []
const usedIds = new Set()
const regionNamesByCountry = new Map()
for (const f of regionsGj.features) {
  const p = f.properties
  const cc = codeFor(p.iso_a2, p.adm0_a3)
  if (!cc) {
    dropped.push(`region ${p.name} in ${p.admin} (no country code)`)
    continue
  }
  const bbox = mainBbox(polygonsOf(f.geometry))
  if (!bbox) {
    dropped.push(`region ${p.name} (no geometry)`)
    continue
  }
  if (!countryName.has(cc) && !extraCountryNames[cc]) extraCountryNames[cc] = DEPENDENCY_NAMES[cc] ?? clean(p.admin)
  let id = /^[A-Z]{2}-[A-Z0-9]+$/.test(p.iso_3166_2 || '') ? p.iso_3166_2 : clean(p.adm1_code)
  if (usedIds.has(id)) id = clean(p.adm1_code)
  if (usedIds.has(id)) id = `${id}-${p.ne_id}`
  usedIds.add(id)
  const primary = clean(p.name_en) || clean(p.name)
  const lat = Number.isFinite(p.latitude) ? p.latitude : (bbox[1] + bbox[3]) / 2
  const lon = Number.isFinite(p.longitude) ? p.longitude : (bbox[0] + bbox[2]) / 2
  const row = {
    id,
    cc,
    primary,
    type: clean(p.type_en),
    altSrc: [p.name, p.name_alt, ...(EXTRA_ALTS[`${cc}|${primary}`] ?? []), ...(EXTRA_ALTS[`${cc}|${clean(p.name)}`] ?? [])],
    bbox,
    lat,
    lon,
    area: Math.round(polygonsOf(f.geometry).reduce((sum, poly) => sum + ringAreaKm2(poly[0]), 0)),
  }
  const key = `${cc}|${norm(primary)}`
  if (!regionNamesByCountry.has(key)) regionNamesByCountry.set(key, [])
  regionNamesByCountry.get(key).push(row)
  regionRows.push(row)
}
// Disambiguate same-named regions in one country (e.g. Kyiv oblast and Kyiv
// city both carry name_en "Kyiv"): the city-like one becomes "Kyiv City".
for (const group of regionNamesByCountry.values()) {
  if (group.length < 2) continue
  for (const r of group) {
    if (/municipality|city|capital/i.test(r.type) && !/\bcity\b/i.test(r.primary)) r.primary = `${r.primary} City`
  }
  const seen = new Set()
  for (const r of group) {
    if (seen.has(r.primary) && r.type) r.primary = `${r.primary} (${r.type})`
    seen.add(r.primary)
  }
}
const regionOut = regionRows.map((r) => {
  const [name, alts] = names(r.primary, r.altSrc)
  return [r.id, name, alts, r.cc, ...r.bbox, r3(r.lat), r3(r.lon), r.area]
})

// Cities
const cityOut = []
for (const f of citiesGj.features) {
  const p = f.properties
  const cc = codeFor(p.ISO_A2, p.ADM0_A3) ?? codeFor(null, p.SOV_A3)
  if (!cc) {
    dropped.push(`city ${p.NAME} (no country code)`)
    continue
  }
  if (!countryName.has(cc) && !extraCountryNames[cc]) extraCountryNames[cc] = DEPENDENCY_NAMES[cc] ?? clean(p.ADM0NAME)
  const primary = clean(p.NAME_EN) || clean(p.NAME)
  const lat = Number(p.LATITUDE)
  const lon = Number(p.LONGITUDE)
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    dropped.push(`city ${p.NAME} (no coordinates)`)
    continue
  }
  const [name, alts] = names(primary, [
    p.NAME,
    p.NAMEASCII,
    p.NAMEALT,
    p.NAMEPAR,
    ...(EXTRA_ALTS[`${cc}|${primary}`] ?? []),
    ...(EXTRA_ALTS[`${cc}|${clean(p.NAME)}`] ?? []),
  ])
  cityOut.push([String(p.NE_ID), name, alts, cc, clean(p.ADM1NAME), r3(lat), r3(lon), Math.max(0, Number(p.POP_MAX) || 0)])
}

const places = { v: 1, countries: countryRows, regions: regionOut, cities: cityOut, extraCountryNames }
const placesText = JSON.stringify(places)
writeFileSync(join(OUT, 'places.json'), placesText)

const kb = (n) => `${(n / 1024).toFixed(0)} KB`
console.log('')
console.log(`countries: ${countryRows.length}  regions: ${regionOut.length}  cities: ${cityOut.length}`)
console.log(`merged into an existing code: ${merged.join(', ') || 'none'}`)
console.log(`dropped (${dropped.length}):`)
for (const d of dropped) console.log(`  ${d}`)
console.log(`places.json            ${kb(placesText.length)} raw, ${kb(gzipSync(placesText).length)} gzip`)
console.log(`countries/*.json (${countryRows.length})  ${kb(outlineBytes)} raw, ${kb(outlineGzip)} gzip in total`)
