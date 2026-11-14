import { describe, expect, it } from 'vitest'
import { buildWeeks, cellSize, clampRange, dayStatus, daysInYear, monthLabels, normalise, percentile, queryEnd, robustMax, weekdayIndex } from './layout'

const flat = (y: number) => buildWeeks(y).flat().filter((d): d is string => d !== null)

describe('buildWeeks', () => {
  it('handles a leap year (2024 starts on Monday)', () => {
    expect(daysInYear(2024)).toBe(366)
    const w = buildWeeks(2024)
    expect(w[0][0]).toBe('2024-01-01')
    expect(flat(2024)).toHaveLength(366)
    expect(w).toHaveLength(53)
    expect(w.at(-1)?.[1]).toBe('2024-12-31')
    expect(w.at(-1)?.[2]).toBeNull()
  })
  it('year starting on Sunday pads six empty cells (2023)', () => {
    expect(weekdayIndex('2023-01-01')).toBe(6)
    const w = buildWeeks(2023)
    expect(w[0].slice(0, 6)).toEqual([null, null, null, null, null, null])
    expect(w[0][6]).toBe('2023-01-01')
    expect(flat(2023)).toHaveLength(365)
    expect(w).toHaveLength(53)
  })
  it('needs 54 columns for a leap year starting on Sunday (2012)', () => {
    expect(weekdayIndex('2012-01-01')).toBe(6)
    expect(buildWeeks(2012)).toHaveLength(54)
  })
  it('keeps days in order with Monday on row 0', () => {
    const days = flat(2025)
    expect([...days].sort()).toEqual(days)
    for (const col of buildWeeks(2025)) col.forEach((d, r) => d && expect(weekdayIndex(d)).toBe(r))
  })
})

describe('monthLabels', () => {
  it('puts months on the column of their first day', () => {
    const labels = monthLabels(2024)
    expect(labels).toHaveLength(12)
    expect(labels[0]).toMatchObject({ col: 0, from: '2024-01-01', to: '2024-01-31' })
    expect(labels[1]).toMatchObject({ from: '2024-02-01', to: '2024-02-29' })
    expect(labels[11].to).toBe('2024-12-31')
    expect(labels.map((l) => l.col)).toEqual([...labels.map((l) => l.col)].sort((a, b) => a - b))
  })
})

describe('clamping', () => {
  it('limits the query to date_max', () => {
    expect(queryEnd(2025, '2025-06-10')).toBe('2025-06-10')
    expect(queryEnd(2024, '2025-06-10')).toBe('2024-12-31')
    expect(queryEnd(2025, null)).toBe('2025-12-31')
  })
  it('marks days outside the data range', () => {
    expect(dayStatus('2025-06-11', '2025-01-05', '2025-06-10')).toBe('nodata')
    expect(dayStatus('2025-01-04', '2025-01-05', '2025-06-10')).toBe('nodata')
    expect(dayStatus('2025-03-01', '2025-01-05', '2025-06-10')).toBe('data')
    expect(dayStatus('2025-03-01', null, null)).toBe('nodata')
  })
  it('clamps ranges', () => {
    expect(clampRange('2025-06-01', '2025-06-30', '2025-01-01', '2025-06-10')).toEqual(['2025-06-01', '2025-06-10'])
    expect(clampRange('2025-07-01', '2025-07-31', '2025-01-01', '2025-06-10')).toBeNull()
  })
})

describe('normalisation', () => {
  it('percentile interpolates', () => {
    expect(percentile([1, 2, 3, 4, 5], 0.5)).toBe(3)
    expect(percentile([0, 10], 0.95)).toBeCloseTo(9.5)
    expect(percentile([], 0.5)).toBe(0)
  })
  it('robust max ignores zeros and one extreme day', () => {
    const counts = [...Array(99).fill(10), 100000, ...Array(200).fill(0)]
    expect(robustMax(counts)).toBeLessThan(1000)
    expect(robustMax([0, 0])).toBe(1)
  })
  it('sqrt scale saturates and keeps zero', () => {
    expect(normalise(0, 10)).toBe(0)
    expect(normalise(10, 10)).toBe(1)
    expect(normalise(1000, 10)).toBe(1)
    expect(normalise(2.5, 10)).toBeCloseTo(0.5)
  })
})

describe('cellSize', () => {
  it('scales and clamps', () => {
    expect(cellSize(1000, 53, 2, 9, 16)).toBe(16)
    expect(cellSize(300, 53, 2, 9, 16)).toBe(9)
    expect(cellSize(530, 53, 2, 9, 16)).toBe(9)
  })
})
