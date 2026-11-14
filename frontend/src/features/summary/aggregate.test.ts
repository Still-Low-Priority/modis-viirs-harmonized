import { describe, expect, it } from 'vitest'
import { chartGeometry, chooseInterval, intervalOfPeriod, periodDays, periodRange, stepIndex, summarize } from './aggregate'

describe('chooseInterval', () => {
  it('picks by period length', () => {
    expect(chooseInterval(1)).toBe('day')
    expect(chooseInterval(92)).toBe('day')
    expect(chooseInterval(93)).toBe('month')
    expect(chooseInterval(366 * 3)).toBe('month')
    expect(chooseInterval(366 * 3 + 1)).toBe('year')
  })
})

describe('periodDays', () => {
  it('is inclusive', () => {
    expect(periodDays('2026-11-08', '2026-11-14')).toBe(7)
  })
})

describe('summarize', () => {
  it('handles empty input', () => {
    expect(summarize([])).toEqual({ total: 0, frpTotal: 0, sources: [], peak: null, series: [] })
  })

  it('sums totals, shares and finds the peak', () => {
    const s = summarize([
      { period: '2026-11-08', count: 10, frp_sum: 100, by_source: { A: 6, B: 4 } },
      { period: '2026-11-09', count: 30, frp_sum: 50.5, by_source: { A: 10, B: 20 } },
      { period: '2026-11-10', count: 0, frp_sum: 0, by_source: {} },
    ])
    expect(s.total).toBe(40)
    expect(s.frpTotal).toBe(150.5)
    expect(s.peak).toEqual({ period: '2026-11-09', count: 30 })
    expect(s.series).toEqual([10, 30, 0])
    expect(s.sources.map((x) => [x.source, x.count])).toEqual([['B', 24], ['A', 16]])
    expect(s.sources[0].percent).toBeCloseTo(60)
    expect(s.sources[1].percent).toBeCloseTo(40)
  })

  it('has no peak when all zero and tolerates missing by_source', () => {
    const s = summarize([{ period: '2026', count: 0, frp_sum: 0 }])
    expect(s.peak).toBeNull()
    expect(s.sources).toEqual([])
  })
})

describe('periodRange', () => {
  it('maps day, month and year to day bounds', () => {
    expect(intervalOfPeriod('2026-11-11')).toBe('day')
    expect(intervalOfPeriod('2026-11')).toBe('month')
    expect(intervalOfPeriod('2026')).toBe('year')
    expect(periodRange('2026-11-11')).toEqual({ from: '2026-11-11', to: '2026-11-11' })
    expect(periodRange('2026-11')).toEqual({ from: '2026-11-01', to: '2026-11-30' })
    expect(periodRange('2026-12')).toEqual({ from: '2026-12-01', to: '2026-12-31' })
    expect(periodRange('2024-02')).toEqual({ from: '2024-02-01', to: '2024-02-29' })
    expect(periodRange('2026')).toEqual({ from: '2026-01-01', to: '2026-12-31' })
  })
})

describe('chartGeometry', () => {
  it('scales bars to the max and keeps empty periods flat', () => {
    const g = chartGeometry([0, 5, 10], 30, 20)
    expect(g.max).toBe(10)
    expect(g.bars.map((b) => b.height)).toEqual([0, 10, 20])
    expect(g.bars[1].x).toBeGreaterThan(10)
    expect(g.bars[1].x + g.bars[1].width).toBeLessThanOrEqual(20)
  })
  it('handles empty and all-zero input', () => {
    expect(chartGeometry([], 30, 20)).toEqual({ max: 0, bars: [] })
    expect(chartGeometry([0, 0], 30, 20).bars.every((b) => b.height === 0)).toBe(true)
  })
})

describe('stepIndex', () => {
  it('starts from the ends and clamps', () => {
    expect(stepIndex(null, 1, 5)).toBe(0)
    expect(stepIndex(null, -1, 5)).toBe(4)
    expect(stepIndex(4, 1, 5)).toBe(4)
    expect(stepIndex(0, -1, 5)).toBe(0)
    expect(stepIndex(2, 1, 5)).toBe(3)
  })
})
