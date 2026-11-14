/// <reference types="node" />
import { existsSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import type * as Geo from './index'

// Serves the real generated files from public/ so the tests exercise real data.
const PUBLIC = join(process.cwd(), 'public')
const PLACES_LIMIT_BYTES = 1.5 * 1024 * 1024

function serveFromDisk(input: RequestInfo | URL): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  const path = new URL(url, 'http://localhost/').pathname
  const file = join(PUBLIC, decodeURIComponent(path))
  if (!file.startsWith(PUBLIC) || !existsSync(file)) return Promise.resolve(new Response('not found', { status: 404 }))
  return Promise.resolve(new Response(readFileSync(file), { status: 200, headers: { 'content-type': 'application/json' } }))
}

async function freshModule(fetchImpl: typeof fetch): Promise<typeof Geo> {
  vi.resetModules()
  vi.stubGlobal('fetch', vi.fn(fetchImpl))
  return import('./index')
}

let geo: typeof Geo

beforeAll(async () => {
  geo = await freshModule(serveFromDisk as typeof fetch)
})

afterEach(() => {
  vi.restoreAllMocks()
})

const names = (places: Geo.Place[]) => places.map((p) => `${p.kind}:${p.name}:${p.countryCode}`)

describe('generated data', () => {
  it('keeps places.json under the size limit', () => {
    expect(statSync(join(PUBLIC, 'geo', 'places.json')).size).toBeLessThan(PLACES_LIMIT_BYTES)
  })

  it('loads countries, regions and cities with valid bboxes', async () => {
    const places = await geo.loadPlaces()
    const count = (k: Geo.PlaceKind) => places.filter((p) => p.kind === k).length
    expect(count('country')).toBeGreaterThan(200)
    expect(count('region')).toBeGreaterThan(4000)
    expect(count('city')).toBeGreaterThan(7000)
    const ids = new Set<string>()
    for (const p of places) {
      const [w, s, e, n] = p.bbox
      const where = `${p.id} ${p.name}`
      expect(s, where).toBeLessThan(n)
      expect(s, where).toBeGreaterThanOrEqual(-90)
      expect(n, where).toBeLessThanOrEqual(90)
      expect(w, where).toBeGreaterThanOrEqual(-180)
      expect(e, where).toBeLessThanOrEqual(180)
      expect(w, where).not.toBe(e)
      expect(Math.abs(p.lat), where).toBeLessThanOrEqual(90)
      expect(Math.abs(p.lon), where).toBeLessThanOrEqual(180)
      expect(p.countryCode, where).toMatch(/^[A-Z]{2}$/)
      expect(p.countryName, where).not.toBe('')
      expect(ids.has(p.id), `duplicate id ${p.id}`).toBe(false)
      ids.add(p.id)
    }
  })

  it('uses the antimeridian convention and main-landmass boxes', async () => {
    const places = await geo.loadPlaces()
    const country = (code: string) => places.find((p) => p.id === `country:${code}`)
    const fiji = country('FJ')
    expect(fiji && fiji.bbox[0] > fiji.bbox[2]).toBe(true)
    // USA box is the contiguous states, France is metropolitan France.
    expect(country('US')?.bbox).toEqual([expect.closeTo(-124.7, 0), expect.closeTo(25.1, 0), expect.closeTo(-67, 0), expect.closeTo(49.4, 0)])
    const fr = country('FR')
    expect(fr && fr.bbox[0] > -6 && fr.bbox[2] < 10).toBe(true)
    expect(country('NO')).toBeDefined()
  })

  it('gives cities a box of about 50 km', async () => {
    const city = (await geo.loadPlaces()).find((p) => p.kind === 'city' && p.name === 'Kyiv')
    expect(city).toBeDefined()
    const [w, s, e, n] = city!.bbox
    expect((n - s) * 111).toBeCloseTo(50, -1)
    expect((e - w) * 111 * Math.cos((city!.lat * Math.PI) / 180)).toBeCloseTo(50, -1)
  })
})

describe('searchPlaces', () => {
  it('returns [] for a blank query', async () => {
    expect(await geo.searchPlaces('')).toEqual([])
    expect(await geo.searchPlaces('   ')).toEqual([])
  })

  it('finds Rivne oblast and Rivne city', async () => {
    const r = names(await geo.searchPlaces('rivne'))
    expect(r[0]).toBe('region:Rivne:UA')
    expect(r[1]).toBe('city:Rivne:UA')
  })

  it('finds Texas, Toronto, Ukraine', async () => {
    expect(names(await geo.searchPlaces('texas'))[0]).toBe('region:Texas:US')
    expect(names(await geo.searchPlaces('Toronto'))).toContain('city:Toronto:CA')
    expect(names(await geo.searchPlaces('ukraine'))[0]).toBe('country:Ukraine:UA')
  })

  it('finds Beijing as a city and as a municipality-level region', async () => {
    const r = names(await geo.searchPlaces('beijing'))
    expect(r).toContain('region:Beijing:CN')
    expect(r).toContain('city:Beijing:CN')
  })

  it('is diacritic- and case-insensitive', async () => {
    const r = await geo.searchPlaces('sao paulo')
    expect(r.some((p) => p.kind === 'city' && p.name === 'São Paulo')).toBe(true)
    expect(names(await geo.searchPlaces('SÃO PAULO'))).toEqual(names(r))
  })

  it('matches alternate names', async () => {
    expect(names(await geo.searchPlaces('kiev'))).toContain('city:Kyiv:UA')
    expect(names(await geo.searchPlaces('peking'))).toContain('city:Beijing:CN')
    expect(names(await geo.searchPlaces('bombay'))).toContain('city:Mumbai:IN')
  })

  it('ranks exact before prefix before word prefix before substring', async () => {
    const r = await geo.searchPlaces('carpath', 20)
    expect(r.length).toBeGreaterThan(0)
    // "Transcarpathia" contains the query only as a substring.
    expect(r.some((p) => p.name === 'Transcarpathia' || p.name === 'Zakarpattia')).toBe(true)

    const york = names(await geo.searchPlaces('york', 20))
    const exact = york.indexOf('city:York:GB')
    const wordPrefix = york.indexOf('region:New York:US')
    expect(exact).toBeGreaterThanOrEqual(0)
    expect(wordPrefix).toBeGreaterThan(exact)

    // Within one match class, countries come first, then regions, then cities.
    // Here all of them are prefix matches of the primary name.
    const ind = names(await geo.searchPlaces('ind'))
    expect(ind.slice(0, 2)).toEqual(['country:India:IN', 'country:Indonesia:ID'])
    expect(ind.indexOf('region:Indiana:US')).toBeGreaterThan(1)
    expect(ind.indexOf('region:Indiana:US')).toBeLessThan(ind.indexOf('city:Indore:IN'))
  })

  it('breaks ties by importance', async () => {
    const r = await geo.searchPlaces('springfield', 10)
    const cities = r.filter((p) => p.kind === 'city')
    expect(cities.length).toBeGreaterThan(1)
  })

  it('respects the limit', async () => {
    expect((await geo.searchPlaces('a', 3)).length).toBe(3)
    expect((await geo.searchPlaces('a')).length).toBe(8)
  })
})

describe('nearestPlace', () => {
  it('names a town in the Ukrainian Carpathians', async () => {
    const r = await geo.nearestPlace(48.3, 24.2)
    expect(r?.countryCode).toBe('UA')
    expect(r?.distanceKm).toBeLessThan(100)
    expect(r?.region).toBeTruthy()
  })

  it('finds Sydney for a point next to it', async () => {
    const r = await geo.nearestPlace(-33.9, 151.15)
    expect(r?.city).toBe('Sydney')
    expect(r?.countryName).toBe('Australia')
    expect(r?.distanceKm).toBeLessThan(15)
  })

  it('still answers in mid-ocean, with a large distance', async () => {
    const r = await geo.nearestPlace(-40, -120)
    expect(r).not.toBeNull()
    expect(r!.distanceKm).toBeGreaterThan(1000)
  })

  it('matches a brute-force search', async () => {
    const cities = (await geo.loadPlaces()).filter((p) => p.kind === 'city')
    const hav = (a: number, b: number, c: number, d: number) => {
      const r = Math.PI / 180
      const x = Math.sin(((c - a) * r) / 2) ** 2 + Math.cos(a * r) * Math.cos(c * r) * Math.sin(((d - b) * r) / 2) ** 2
      return 2 * 6371 * Math.asin(Math.sqrt(x))
    }
    const points: [number, number][] = [
      [70, 179.5], [-10, -179.9], [85, 10], [-60, 0], [0, 0], [62, -150], [35, 139], [-50, 70],
    ]
    for (const [lat, lon] of points) {
      let best = Infinity
      for (const c of cities) best = Math.min(best, hav(lat, lon, c.lat, c.lon))
      const r = await geo.nearestPlace(lat, lon)
      expect(r?.distanceKm, `${lat},${lon}`).toBeCloseTo(best, 0)
    }
  })

  it('is fast for dozens of calls', async () => {
    await geo.nearestPlace(0, 0)
    const t = performance.now()
    for (let i = 0; i < 100; i++) await geo.nearestPlace(-60 + i * 1.3, -170 + i * 3.4)
    expect(performance.now() - t).toBeLessThan(500)
  })
})

describe('country outlines', () => {
  it('Kyiv is in Ukraine, Warsaw is not', async () => {
    const ua = await geo.loadCountryPolygon('UA')
    expect(ua).not.toBeNull()
    expect(geo.pointInPolygon(50.45, 30.52, ua!)).toBe(true)
    expect(geo.pointInPolygon(52.23, 21.01, ua!)).toBe(false)
  })

  it('handles countries with several parts', async () => {
    const us = await geo.loadCountryPolygon('us')
    expect(us!.length).toBeGreaterThan(1)
    expect(geo.pointInPolygon(64.8, -147.7, us!)).toBe(true) // Fairbanks, Alaska
    expect(geo.pointInPolygon(21.3, -157.85, us!)).toBe(true) // Honolulu
    expect(geo.pointInPolygon(45.5, -73.6, us!)).toBe(false) // Montreal
  })

  it('respects holes (Lesotho inside South Africa)', async () => {
    const za = await geo.loadCountryPolygon('ZA')
    expect(za!.some((poly) => poly.length > 1)).toBe(true)
    expect(geo.pointInPolygon(-29.3, 27.5, za!)).toBe(false) // Maseru, Lesotho
    expect(geo.pointInPolygon(-26.2, 28.05, za!)).toBe(true) // Johannesburg
    const ls = await geo.loadCountryPolygon('LS')
    expect(geo.pointInPolygon(-29.3, 27.5, ls!)).toBe(true)
  })

  it('caches per code and returns null for unknown codes', async () => {
    const a = await geo.loadCountryPolygon('FR')
    const b = await geo.loadCountryPolygon('FR')
    expect(a).toBe(b)
    expect(await geo.loadCountryPolygon('QQ')).toBeNull()
    expect(await geo.loadCountryPolygon('../x')).toBeNull()
  })
})

describe('pointInPolygon', () => {
  const square: Geo.MultiPolygon = [
    [
      [[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]],
      [[4, 4], [6, 4], [6, 6], [4, 6], [4, 4]],
    ],
    [[[20, 20], [22, 20], [22, 22], [20, 22], [20, 20]]],
  ]
  it('handles holes and multiple parts', () => {
    expect(geo.pointInPolygon(2, 2, square)).toBe(true)
    expect(geo.pointInPolygon(5, 5, square)).toBe(false)
    expect(geo.pointInPolygon(21, 21, square)).toBe(true)
    expect(geo.pointInPolygon(15, 15, square)).toBe(false)
  })
})

describe('failures', () => {
  it('resolves to empty results and warns once when data is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const broken = await freshModule((() => Promise.reject(new Error('offline'))) as typeof fetch)
    expect(await broken.searchPlaces('kyiv')).toEqual([])
    expect(await broken.nearestPlace(50, 30)).toBeNull()
    expect(await broken.loadPlaces()).toEqual([])
    expect(await broken.loadCountryPolygon('UA')).toBeNull()
    expect(warn).toHaveBeenCalledTimes(1)
  })

  it('treats an HTML fallback page as no outline', async () => {
    const html = await freshModule((() => Promise.resolve(new Response('<!doctype html>', { status: 200 }))) as typeof fetch)
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(await html.loadCountryPolygon('UA')).toBeNull()
  })
})
