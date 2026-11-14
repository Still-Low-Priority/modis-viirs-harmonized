import { describe, expect, it } from 'vitest'
import type { TimeseriesItem } from '../../api/types'
import { monthRange, seasonality, sourceKeys, stackedData, yearlyRows, yearOverlaps } from './transform'

const it_ = (period: string, count: number, by?: Record<string, number>): TimeseriesItem => ({
  period,
  count,
  frp_sum: count * 2,
  ...(by ? { by_source: by } : {}),
})

describe('yearlyRows', () => {
  const items = [it_('2020', 10, { A: 10 }), it_('2022', 30, { A: 10, B: 20 })]
  const rows = yearlyRows(items, '2020-03-01', '2022-06-30')

  it('zero-fills gaps and flags partial first/last year', () => {
    expect(rows.map((r) => r.year)).toEqual(['2020', '2021', '2022'])
    expect(rows.map((r) => r.partial)).toEqual([true, false, true])
    expect(rows[1].count).toBe(0)
    expect(rows[2].frp).toBe(60)
  })

  it('does not flag complete boundary years', () => {
    expect(yearlyRows([], '2020-01-01', '2020-12-31')[0].partial).toBe(false)
  })

  it('handles missing sources', () => {
    const keys = sourceKeys(rows)
    expect(keys).toEqual(['A', 'B'])
    const data = stackedData(rows, keys)
    expect(data[0]).toMatchObject({ A: 10, B: 0 })
    expect(data[1]).toMatchObject({ A: 0, B: 0 })
  })

  it('handles items without by_source', () => {
    expect(sourceKeys(yearlyRows([it_('2020', 5)], '2020-01-01', '2020-12-31'))).toEqual([])
  })
})

describe('seasonality', () => {
  const items = [it_('2020-06', 10), it_('2021-06', 30), it_('2021-07', 4), it_('2022-01', 7)]

  it('averages fully covered months and zero-fills missing', () => {
    const rows = seasonality(items, '2020-01-01', '2021-12-31', 2021)
    expect(rows).toHaveLength(12)
    expect(rows[5]).toMatchObject({ avg: 20, min: 10, max: 30, current: 30, years: 2 })
    expect(rows[6]).toMatchObject({ avg: 2, min: 0, max: 4, current: 4 })
    expect(rows[0]).toMatchObject({ avg: 0, current: 0 })
  })

  it('excludes partial boundary months from stats but shows them for the current year', () => {
    const rows = seasonality(items, '2020-03-01', '2022-01-10', 2022)
    expect(rows[0].years).toBe(1) // Jan 2021 only; Jan 2022 is partial
    expect(rows[0].current).toBe(7)
    expect(rows[1].current).toBeNull() // Feb 2022 not covered
  })

  it('returns nulls when nothing is covered', () => {
    const rows = seasonality([], '2020-05-10', '2020-05-20', 2020)
    expect(rows[4].avg).toBeNull()
    expect(rows[4].years).toBe(0)
  })
})

describe('helpers', () => {
  it('monthRange handles leap years', () => {
    expect(monthRange(2024, 2)).toEqual(['2024-02-01', '2024-02-29'])
    expect(monthRange(2023, 12)).toEqual(['2023-12-01', '2023-12-31'])
  })
  it('yearOverlaps', () => {
    expect(yearOverlaps('2021', '2020-12-30', '2021-01-02')).toBe(true)
    expect(yearOverlaps('2022', '2020-12-30', '2021-01-02')).toBe(false)
  })
})
