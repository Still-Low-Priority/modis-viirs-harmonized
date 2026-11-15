import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addDays, todayUtc } from '../../lib/dates'
import type { Bbox } from '../types'
import { AREAS, DATE_MIN } from './generator'
import { mockApi } from './index'

// The mock sleeps 120-300 ms per call to imitate latency; collapse that so the suite stays fast.
const realSetTimeout = globalThis.setTimeout
beforeEach(() => {
  vi.spyOn(globalThis, 'setTimeout').mockImplementation(((fn: () => void, ms?: number, ...rest: unknown[]) =>
    realSetTimeout(fn, ms !== undefined && ms >= 120 && ms <= 300 ? 0 : ms, ...rest)) as typeof setTimeout)
})
afterEach(() => vi.restoreAllMocks())

const getGrid = async (q: Parameters<typeof mockApi.getGrid>[0]) => (await mockApi.getGrid(q))!
const week = { date_from: '2026-08-01', date_to: '2026-08-07' }
const big = { limit: 20000 }

describe('mock api: filters', () => {
  it('antimeridian bbox (west > east) returns only points on the correct side', async () => {
    const bbox: Bbox = [100, -30, -100, 70]
    const r = await mockApi.getDetections({ ...week, bbox, ...big })
    expect(r.total).toBeGreaterThan(50)
    for (const f of r.features) {
      const [lon, lat] = f.geometry.coordinates
      expect(lon >= 100 || lon <= -100).toBe(true)
      expect(lat).toBeGreaterThanOrEqual(-30)
      expect(lat).toBeLessThanOrEqual(70)
    }
  })

  it('antimeridian bbox and its complement partition the world', async () => {
    const all = await mockApi.getDetections({ ...week, ...big })
    const wrap = await mockApi.getDetections({ ...week, bbox: [100, -90, -100, 90], ...big })
    const mid = await mockApi.getDetections({ ...week, bbox: [-100, -90, 100, 90], ...big })
    // Points exactly on a meridian edge count in both; there are practically none, so allow a tiny overlap.
    expect(wrap.total + mid.total).toBeGreaterThanOrEqual(all.total)
    expect(wrap.total + mid.total - all.total).toBeLessThan(5)
  })

  it('min_confidence=high returns only high', async () => {
    const r = await mockApi.getDetections({ ...week, min_confidence: 'high', ...big })
    expect(r.total).toBeGreaterThan(0)
    for (const f of r.features) expect(f.properties.confidence).toBe('high')
  })

  it('min_confidence=nominal returns nominal and high but not low', async () => {
    const r = await mockApi.getDetections({ ...week, min_confidence: 'nominal', ...big })
    const set = new Set(r.features.map((f) => f.properties.confidence))
    expect(set.has('low')).toBe(false)
    expect(set.has('nominal')).toBe(true)
    expect(set.has('high')).toBe(true)
  })

  it('min_confidence=low equals no filter', async () => {
    const a = await mockApi.getDetections({ ...week, min_confidence: 'low', ...big })
    const b = await mockApi.getDetections({ ...week, ...big })
    expect(a.total).toBe(b.total)
  })

  it('daynight filter returns only that flag and D + N = all', async () => {
    const d = await mockApi.getDetections({ ...week, daynight: 'D', ...big })
    const n = await mockApi.getDetections({ ...week, daynight: 'N', ...big })
    const all = await mockApi.getDetections({ ...week, ...big })
    expect(d.features.every((f) => f.properties.daynight === 'D')).toBe(true)
    expect(n.features.every((f) => f.properties.daynight === 'N')).toBe(true)
    expect(d.total + n.total).toBe(all.total)
    expect(d.total).toBeGreaterThan(n.total)
  })

  it('source filter with two sources returns exactly those', async () => {
    const r = await mockApi.getDetections({ ...week, source: ['MODIS_NRT', 'VIIRS_NOAA20_NRT'], ...big })
    expect(new Set(r.features.map((f) => f.properties.source_product))).toEqual(new Set(['MODIS_NRT', 'VIIRS_NOAA20_NRT']))
  })

  it('an unknown source returns nothing', async () => {
    const r = await mockApi.getDetections({ ...week, source: ['NOPE'] })
    expect(r.total).toBe(0)
    expect(r.features).toEqual([])
    expect(r.truncated).toBe(false)
  })

  it('area_id gives the same result as that area bbox', async () => {
    for (const area of [AREAS[0], AREAS[1], AREAS[5]]) {
      const byId = await mockApi.getDetections({ ...week, area_id: area.id, ...big })
      const byBox = await mockApi.getDetections({ ...week, bbox: area.bbox, ...big })
      expect(byId.total).toBe(byBox.total)
      expect(byId.features.map((f) => f.id)).toEqual(byBox.features.map((f) => f.id))
    }
  })

  it('area_id takes precedence over bbox', async () => {
    const ua = AREAS[0]
    const a = await mockApi.getDetections({ ...week, area_id: ua.id, bbox: [-180, -90, -170, -80], ...big })
    const b = await mockApi.getDetections({ ...week, area_id: ua.id, ...big })
    expect(a.total).toBe(b.total)
  })

  it('an unknown area_id is a 404, not the whole world', async () => {
    await expect(mockApi.getDetections({ ...week, area_id: 9999, limit: 1 })).rejects.toMatchObject({ status: 404 })
  })
})

describe('mock api: detections edge cases', () => {
  it('a single-day range works', async () => {
    const r = await mockApi.getDetections({ date_from: '2026-08-01', date_to: '2026-08-01', ...big })
    expect(r.total).toBeGreaterThan(0)
    for (const f of r.features) expect(f.properties.acquired_at.startsWith('2026-08-01') || f.properties.acquired_at.startsWith('2026-08-02')).toBe(true)
  })

  it('returns zero for dates before date_min', async () => {
    const r = await mockApi.getDetections({ date_from: '2010-01-01', date_to: '2010-01-31' })
    expect(r.total).toBe(0)
    expect(r.features).toEqual([])
  })

  it('returns zero for dates in the future', async () => {
    const from = addDays(todayUtc(), 10)
    const r = await mockApi.getDetections({ date_from: from, date_to: addDays(from, 5) })
    expect(r.total).toBe(0)
  })

  it('rejects date_from > date_to with a 422', async () => {
    await expect(mockApi.getDetections({ date_from: '2026-08-07', date_to: '2026-08-01' })).rejects.toMatchObject({ status: 422, name: 'ApiError' })
    await expect(mockApi.getTimeseries({ date_from: '2026-08-07', date_to: '2026-08-01', interval: 'day' })).rejects.toMatchObject({ status: 422 })
    await expect(getGrid({ date_from: '2026-08-07', date_to: '2026-08-01', cell: 1 })).rejects.toMatchObject({ status: 422 })
  })

  it('caps the limit at 20000', async () => {
    const r = await mockApi.getDetections({ date_from: '2026-06-01', date_to: '2026-08-31', limit: 1_000_000 })
    expect(r.features.length).toBeLessThanOrEqual(20000)
    expect(r.truncated).toBe(r.total > 20000)
  })

  it('does not truncate when total equals the limit', async () => {
    const all = await mockApi.getDetections({ ...week, ...big })
    const r = await mockApi.getDetections({ ...week, limit: all.total })
    expect(r.truncated).toBe(false)
    expect(r.features).toHaveLength(all.total)
  })

  it('a truncated sample has unique ids', async () => {
    const r = await mockApi.getDetections({ ...week, limit: 100 })
    expect(new Set(r.features.map((f) => f.id)).size).toBe(100)
  })

  it('returns ISO-8601 UTC timestamps', async () => {
    const r = await mockApi.getDetections({ date_from: '2026-08-05', date_to: '2026-08-05', ...big })
    for (const f of r.features) expect(f.properties.acquired_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/)
  })

  it('rejects when the signal is already aborted', async () => {
    const ctrl = new AbortController()
    ctrl.abort()
    // delay() only reacts to a later abort event; an already-aborted signal must still not hang forever.
    const p = mockApi.getMeta(ctrl.signal)
    const outcome = await Promise.race([p.then(() => 'resolved', () => 'rejected'), new Promise((r) => setTimeout(() => r('hung'), 1000))])
    expect(outcome).not.toBe('hung')
  })

  it('rejects when aborted while waiting', async () => {
    const ctrl = new AbortController()
    const p = mockApi.getMeta(ctrl.signal)
    ctrl.abort()
    await expect(p).rejects.toBeDefined()
  })
})

describe('mock api: meta and areas', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-15T10:00:00Z'))
  })
  afterEach(() => vi.useRealTimers())

  it('reports date_min, yesterday as date_max and an ingest time today', async () => {
    const m = await mockApi.getMeta()
    expect(m.date_min).toBe(DATE_MIN)
    expect(m.date_max).toBe('2026-08-14')
    expect(m.last_ingested_at).toBe('2026-08-15T03:15:00Z')
    expect(m.sources.map((s) => s.source_product)).toEqual(['MODIS_NRT', 'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT'])
  })

  it('does not return the share/since/meanFrp internals in meta sources', async () => {
    const m = await mockApi.getMeta()
    for (const s of m.sources) expect(Object.keys(s).sort()).toEqual(['instrument', 'satellites', 'source_product'])
  })

  it('data stops at yesterday: today is not included', async () => {
    const r = await mockApi.getTimeseries({ date_from: '2026-08-13', date_to: '2026-08-16', interval: 'day' })
    expect(r.items.map((i) => i.period)).toEqual(['2026-08-13', '2026-08-14', '2026-08-15', '2026-08-16'])
    expect(r.items[1].count).toBeGreaterThan(0)
    expect(r.items[2].count).toBe(0)
    expect(r.items[3].count).toBe(0)
  })

  it('lists areas with ids, names and valid bboxes', async () => {
    const a = await mockApi.getAreas()
    expect(a.length).toBeGreaterThan(0)
    expect(new Set(a.map((x) => x.id)).size).toBe(a.length)
    for (const x of a) {
      expect(x.bbox[1]).toBeLessThan(x.bbox[3])
      expect(x.name).not.toBe('')
    }
  })
})

describe('mock api: timeseries periods', () => {
  it('returns zeros but every period for a range before date_min', async () => {
    const r = await mockApi.getTimeseries({ date_from: '2010-01-01', date_to: '2010-01-05', interval: 'day', group_by: 'source' })
    expect(r.items.map((i) => i.period)).toEqual(['2010-01-01', '2010-01-02', '2010-01-03', '2010-01-04', '2010-01-05'])
    for (const i of r.items) {
      expect(i.count).toBe(0)
      expect(i.frp_sum).toBe(0)
      expect(Object.values(i.by_source!).every((v) => v === 0)).toBe(true)
    }
  })

  it('returns zeros but every period for a future range', async () => {
    const from = addDays(todayUtc(), 30)
    const r = await mockApi.getTimeseries({ date_from: from, date_to: addDays(from, 2), interval: 'day' })
    expect(r.items).toHaveLength(3)
    expect(r.items.every((i) => i.count === 0)).toBe(true)
  })

  it('a range straddling date_min lists all periods with zeros before it', async () => {
    const r = await mockApi.getTimeseries({ date_from: '2014-12-30', date_to: '2015-01-02', interval: 'day' })
    expect(r.items.map((i) => i.period)).toEqual(['2014-12-30', '2014-12-31', '2015-01-01', '2015-01-02'])
    expect(r.items[0].count).toBe(0)
    expect(r.items[1].count).toBe(0)
    expect(r.items[2].count).toBeGreaterThan(0)
  })

  it('omits by_source unless requested', async () => {
    const r = await mockApi.getTimeseries({ ...week, interval: 'day' })
    expect(r.items.every((i) => i.by_source === undefined)).toBe(true)
  })

  it('echoes the interval', async () => {
    expect((await mockApi.getTimeseries({ ...week, interval: 'month' })).interval).toBe('month')
  })

  it('month interval gives YYYY-MM periods without gaps across a year end', async () => {
    const r = await mockApi.getTimeseries({ date_from: '2025-10-15', date_to: '2026-03-10', interval: 'month' })
    expect(r.items.map((i) => i.period)).toEqual(['2025-10', '2025-11', '2025-12', '2026-01', '2026-02', '2026-03'])
  })

  it('month totals equal the day totals for the same range', async () => {
    const range = { date_from: '2026-05-01', date_to: '2026-07-31' }
    const m = await mockApi.getTimeseries({ ...range, interval: 'month' })
    const d = await mockApi.getTimeseries({ ...range, interval: 'day' })
    expect(m.items.reduce((a, i) => a + i.count, 0)).toBe(d.items.reduce((a, i) => a + i.count, 0))
    const june = d.items.filter((i) => i.period.startsWith('2026-06')).reduce((a, i) => a + i.count, 0)
    expect(m.items.find((i) => i.period === '2026-06')!.count).toBe(june)
  })

  it('year interval gives YYYY periods, gap-free', async () => {
    const r = await mockApi.getTimeseries({ date_from: '2022-06-01', date_to: '2025-02-01', interval: 'year' })
    expect(r.items.map((i) => i.period)).toEqual(['2022', '2023', '2024', '2025'])
  })

  it('a single day is a single period', async () => {
    for (const interval of ['day', 'month', 'year'] as const) {
      const r = await mockApi.getTimeseries({ date_from: '2026-02-28', date_to: '2026-02-28', interval })
      expect(r.items).toHaveLength(1)
    }
  })

  it('daily periods cross the leap day', async () => {
    const r = await mockApi.getTimeseries({ date_from: '2024-02-28', date_to: '2024-03-01', interval: 'day' })
    expect(r.items.map((i) => i.period)).toEqual(['2024-02-28', '2024-02-29', '2024-03-01'])
  })

  it('has one by_source key per mock source and frp_sum rounded to 1 decimal', async () => {
    const r = await mockApi.getTimeseries({ ...week, interval: 'day', group_by: 'source' })
    for (const i of r.items) {
      expect(Object.keys(i.by_source!)).toEqual(['MODIS_NRT', 'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT'])
      expect(Math.round(i.frp_sum * 10) / 10).toBe(i.frp_sum)
    }
  })

  it('timeseries frp_sum matches the sum of detection frp', async () => {
    const det = await mockApi.getDetections({ date_from: '2026-08-03', date_to: '2026-08-03', ...big })
    const ts = await mockApi.getTimeseries({ date_from: '2026-08-03', date_to: '2026-08-03', interval: 'day' })
    const sum = det.features.reduce((a, f) => a + f.properties.frp, 0)
    expect(ts.items[0].frp_sum).toBeCloseTo(sum, 0)
  })

  it('timeseries respects filters (bbox, daynight, confidence, source)', async () => {
    const filters = { ...week, bbox: [-124.5, 32.5, -114.1, 42] as Bbox, daynight: 'D' as const, min_confidence: 'nominal' as const, source: ['VIIRS_SNPP_NRT'] }
    const ts = await mockApi.getTimeseries({ ...filters, interval: 'day' })
    const det = await mockApi.getDetections({ ...filters, ...big })
    expect(ts.items.reduce((a, i) => a + i.count, 0)).toBe(det.total)
  })

  it('area_id works in the timeseries', async () => {
    const byId = await mockApi.getTimeseries({ ...week, area_id: 2, interval: 'day' })
    const byBox = await mockApi.getTimeseries({ ...week, bbox: AREAS[1].bbox, interval: 'day' })
    expect(byId.items).toEqual(byBox.items)
  })

  it('zero VIIRS NOAA-20 before 2018 and zero SNPP before 2012', async () => {
    const r = await mockApi.getTimeseries({ date_from: '2015-06-01', date_to: '2015-06-05', interval: 'day', group_by: 'source' })
    for (const i of r.items) {
      expect(i.by_source!.VIIRS_NOAA20_NRT).toBe(0)
      expect(i.by_source!.VIIRS_SNPP_NRT).toBeGreaterThan(0)
    }
  })
})

describe('mock api: exact vs estimate path', () => {
  // EXACT_DAYS = 800: 800 days is exact, 801+ uses the analytic estimate.
  const exactRange = { date_from: '2023-01-01', date_to: '2025-02-10' } // 772 days
  const estRange = { date_from: '2023-01-01', date_to: '2025-03-20' } // 810 days

  it('estimate by_source sums approximately to count', async () => {
    const r = await mockApi.getTimeseries({ ...estRange, interval: 'month', group_by: 'source' })
    for (const i of r.items) {
      const sum = Object.values(i.by_source!).reduce((a, b) => a + b, 0)
      expect(Math.abs(sum - i.count)).toBeLessThanOrEqual(3)
    }
  })

  it('estimate is the same order of magnitude as the exact generation', async () => {
    const est = await mockApi.getTimeseries({ ...estRange, interval: 'year' })
    // Exact reference for the identical span, computed by shrinking each call below the threshold.
    const parts = [
      { date_from: '2023-01-01', date_to: '2023-12-31' },
      { date_from: '2024-01-01', date_to: '2024-12-31' },
      { date_from: '2025-01-01', date_to: '2025-03-20' },
    ]
    const exact: number[] = []
    for (const p of parts) exact.push((await mockApi.getTimeseries({ ...p, interval: 'year' })).items[0].count)
    est.items.forEach((item, i) => {
      expect(item.count / exact[i]).toBeGreaterThan(0.5)
      expect(item.count / exact[i]).toBeLessThan(2)
    })
  })

  it('estimate with a bbox stays in range of the exact count', async () => {
    const bbox: Bbox = [-124.5, 32.5, -114.1, 42]
    const est = await mockApi.getTimeseries({ ...estRange, bbox, interval: 'year' })
    const exact = await mockApi.getTimeseries({ date_from: '2023-01-01', date_to: '2023-12-31', bbox, interval: 'year' })
    const e = est.items[0].count
    expect(e).toBeGreaterThan(0)
    expect(e / exact.items[0].count).toBeGreaterThan(0.4)
    expect(e / exact.items[0].count).toBeLessThan(2.5)
  })

  it('exact path (772 days) sums by_source exactly to count', async () => {
    const r = await mockApi.getTimeseries({ ...exactRange, interval: 'year', group_by: 'source' })
    for (const i of r.items) expect(Object.values(i.by_source!).reduce((a, b) => a + b, 0)).toBe(i.count)
  })

  it('estimate honours filters: source reduces the count', async () => {
    const all = await mockApi.getTimeseries({ ...estRange, interval: 'year' })
    const modis = await mockApi.getTimeseries({ ...estRange, interval: 'year', source: ['MODIS_NRT'] })
    all.items.forEach((a, i) => expect(modis.items[i].count).toBeLessThan(a.count))
  })

  it('estimate honours daynight: D + N is about all', async () => {
    const all = (await mockApi.getTimeseries({ ...estRange, interval: 'year' })).items.reduce((a, i) => a + i.count, 0)
    const d = (await mockApi.getTimeseries({ ...estRange, interval: 'year', daynight: 'D' })).items.reduce((a, i) => a + i.count, 0)
    const n = (await mockApi.getTimeseries({ ...estRange, interval: 'year', daynight: 'N' })).items.reduce((a, i) => a + i.count, 0)
    expect(Math.abs(d + n - all) / all).toBeLessThan(0.001)
  })

  it('estimate for an antimeridian bbox is positive and below the whole-world total', async () => {
    const world = await mockApi.getTimeseries({ ...estRange, interval: 'year' })
    const wrap = await mockApi.getTimeseries({ ...estRange, bbox: [100, -30, -100, 70], interval: 'year' })
    const w = wrap.items.reduce((a, i) => a + i.count, 0)
    expect(w).toBeGreaterThan(0)
    expect(w).toBeLessThan(world.items.reduce((a, i) => a + i.count, 0))
  })
})

describe('mock api: grid', () => {
  const area = AREAS[0]
  const q = { ...week, area_id: area.id }

  it('cell counts sum to the detections total', async () => {
    const det = await mockApi.getDetections({ ...q, limit: 1 })
    for (const cell of [0.5, 1, 5]) {
      const grid = await getGrid({ ...q, cell })
      expect(grid.reduce((a, c) => a + c.count, 0)).toBe(det.total)
    }
  })

  it('cell centres are aligned to the cell size', async () => {
    for (const cell of [0.5, 1, 2.5]) {
      const grid = await getGrid({ ...week, cell })
      expect(grid.length).toBeGreaterThan(0)
      for (const c of grid) {
        const a = c.lat / cell - 0.5
        const b = c.lon / cell - 0.5
        expect(Math.abs(a - Math.round(a))).toBeLessThan(1e-3)
        expect(Math.abs(b - Math.round(b))).toBeLessThan(1e-3)
      }
    }
  })

  it('has unique cells', async () => {
    const grid = await getGrid({ ...week, cell: 1 })
    expect(new Set(grid.map((c) => `${c.lat}:${c.lon}`)).size).toBe(grid.length)
  })

  it('frp_sum of all cells equals the frp sum of detections', async () => {
    const det = await mockApi.getDetections({ ...q, ...big })
    const grid = await getGrid({ ...q, cell: 1 })
    const a = det.features.reduce((s, f) => s + f.properties.frp, 0)
    const b = grid.reduce((s, c) => s + c.frp_sum, 0)
    expect(b).toBeCloseTo(a, 0)
  })

  it('every point falls into the cell around its centre', async () => {
    const cell = 1
    const det = await mockApi.getDetections({ ...q, ...big })
    const grid = await getGrid({ ...q, cell })
    const keys = new Set(grid.map((c) => `${c.lat}:${c.lon}`))
    for (const f of det.features.slice(0, 200)) {
      const [lon, lat] = f.geometry.coordinates
      const clat = +((Math.floor(lat / cell) + 0.5) * cell).toFixed(4)
      const clon = +((Math.floor(lon / cell) + 0.5) * cell).toFixed(4)
      expect(keys.has(`${clat}:${clon}`)).toBe(true)
    }
  })

  it('is empty when nothing matches', async () => {
    expect(await getGrid({ date_from: '2010-01-01', date_to: '2010-01-05', cell: 1 })).toEqual([])
  })

  it('respects the antimeridian bbox', async () => {
    const grid = await getGrid({ ...week, bbox: [100, -30, -100, 70], cell: 1 })
    for (const c of grid) expect(c.lon >= 99.5 || c.lon <= -99.5).toBe(true)
  })
})

describe('mock api: detail', () => {
  it('matches the feature for the same id for a MODIS and a VIIRS point', async () => {
    const r = await mockApi.getDetections({ ...week, limit: 20000 })
    const modisF = r.features.find((f) => f.properties.instrument === 'MODIS')!
    const viirsF = r.features.find((f) => f.properties.instrument === 'VIIRS')!
    expect(modisF).toBeDefined()
    expect(viirsF).toBeDefined()
    for (const f of [modisF, viirsF]) {
      const d = await mockApi.getDetection(f.id)
      expect(d.id).toBe(f.id)
      expect(d.longitude).toBe(f.geometry.coordinates[0])
      expect(d.latitude).toBe(f.geometry.coordinates[1])
      expect(d.acquired_at).toBe(f.properties.acquired_at)
      expect(d.source_product).toBe(f.properties.source_product)
      expect(d.instrument).toBe(f.properties.instrument)
      expect(d.confidence).toBe(f.properties.confidence)
      expect(d.frp).toBe(f.properties.frp)
      expect(d.daynight).toBe(f.properties.daynight)
    }
  })

  it('MODIS has brightness/t31 and no I-band; VIIRS the reverse', async () => {
    const r = await mockApi.getDetections({ ...week, limit: 20000 })
    const d1 = await mockApi.getDetection(r.features.find((f) => f.properties.instrument === 'MODIS')!.id)
    expect(d1.brightness).not.toBeNull()
    expect(d1.bright_t31).not.toBeNull()
    expect(d1.bright_ti4).toBeNull()
    expect(d1.bright_ti5).toBeNull()
    const d2 = await mockApi.getDetection(r.features.find((f) => f.properties.instrument === 'VIIRS')!.id)
    expect(d2.brightness).toBeNull()
    expect(d2.bright_t31).toBeNull()
    expect(d2.bright_ti4).not.toBeNull()
    expect(d2.bright_ti5).not.toBeNull()
  })

  it('confidence_raw is numeric for MODIS and a letter for VIIRS, and agrees with confidence', async () => {
    const r = await mockApi.getDetections({ ...week, limit: 20000 })
    for (const f of r.features.slice(0, 300)) {
      const d = await mockApi.getDetection(f.id)
      if (d.instrument === 'MODIS') {
        const n = Number(d.confidence_raw)
        const expected = n < 30 ? 'low' : n < 80 ? 'nominal' : 'high'
        expect(d.confidence).toBe(expected)
      } else {
        expect(d.confidence_raw).toBe({ low: 'l', nominal: 'n', high: 'h' }[d.confidence!])
      }
    }
  })

  it('satellite belongs to the source', async () => {
    const r = await mockApi.getDetections({ ...week, limit: 200 })
    for (const f of r.features) {
      const d = await mockApi.getDetection(f.id)
      if (d.source_product === 'MODIS_NRT') expect(['Terra', 'Aqua']).toContain(d.satellite)
      if (d.source_product === 'VIIRS_SNPP_NRT') expect(d.satellite).toBe('N')
      if (d.source_product === 'VIIRS_NOAA20_NRT') expect(d.satellite).toBe('N20')
    }
  })

  it('404s on an unknown id and on an id of a day without that sequence number', async () => {
    await expect(mockApi.getDetection(999_999_999)).rejects.toMatchObject({ status: 404, message: 'Detection not found' })
    await expect(mockApi.getDetection(-1)).rejects.toMatchObject({ status: 404 })
  })
})
