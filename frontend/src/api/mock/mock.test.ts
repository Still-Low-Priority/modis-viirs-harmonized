import { describe, expect, it } from 'vitest'
import { mockApi } from './index'

const week = { date_from: '2026-08-01', date_to: '2026-08-07' }

describe('mock api', () => {
  it('is deterministic and returns GeoJSON in [lon, lat] order', async () => {
    const a = await mockApi.getDetections({ ...week, limit: 20000 })
    const b = await mockApi.getDetections({ ...week, limit: 20000 })
    expect(a.total).toBe(b.total)
    expect(a.total).toBeGreaterThan(500)
    const [lon, lat] = a.features[0].geometry.coordinates
    expect(Math.abs(lat)).toBeLessThanOrEqual(90)
    expect(Math.abs(lon)).toBeLessThanOrEqual(180)
  })

  it('marks truncated results', async () => {
    const r = await mockApi.getDetections({ ...week, limit: 10 })
    expect(r.features).toHaveLength(10)
    expect(r.truncated).toBe(true)
    expect(r.total).toBeGreaterThan(10)
  })

  it('daily timeseries has every day and matches the detections total', async () => {
    const ts = await mockApi.getTimeseries({ ...week, interval: 'day', group_by: 'source' })
    expect(ts.items.map((i) => i.period)).toEqual([
      '2026-08-01', '2026-08-02', '2026-08-03', '2026-08-04', '2026-08-05', '2026-08-06', '2026-08-07',
    ])
    const det = await mockApi.getDetections({ ...week, limit: 20000 })
    const sum = ts.items.reduce((a, i) => a + i.count, 0)
    expect(sum).toBe(det.total)
    const first = ts.items[0]
    expect(Object.values(first.by_source!).reduce((a, b) => a + b, 0)).toBe(first.count)
  })

  it('respects bbox and source filters', async () => {
    const ua = await mockApi.getDetections({ ...week, bbox: [22, 44, 40, 52], source: ['MODIS_NRT'], limit: 20000 })
    for (const f of ua.features) {
      const [lon, lat] = f.geometry.coordinates
      expect(lon).toBeGreaterThanOrEqual(22)
      expect(lon).toBeLessThanOrEqual(40)
      expect(lat).toBeGreaterThanOrEqual(44)
      expect(lat).toBeLessThanOrEqual(52)
      expect(f.properties.source_product).toBe('MODIS_NRT')
    }
  })

  it('yearly estimate over many years is fast and plausible', async () => {
    const t0 = performance.now()
    const ts = await mockApi.getTimeseries({ date_from: '2015-01-01', date_to: '2025-12-31', interval: 'year', group_by: 'source' })
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(ts.items).toHaveLength(11)
    expect(ts.items[0].by_source!.VIIRS_NOAA20_NRT).toBe(0)
    expect(ts.items[10].count).toBeGreaterThan(50_000)
  })

  it('detail lookup round-trips an id', async () => {
    const det = await mockApi.getDetections({ ...week, limit: 5 })
    const d = await mockApi.getDetection(det.features[0].id)
    expect(d.longitude).toBe(det.features[0].geometry.coordinates[0])
    await expect(mockApi.getDetection(1)).rejects.toMatchObject({ status: 404 })
  })
})
