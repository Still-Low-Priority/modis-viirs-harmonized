import { describe, expect, it } from 'vitest'
import { CONFIDENCE_COLORS, CONFIDENCE_ORDER, FRP_STOPS, HEAT_RAMP, frpColor, heatColor, sourceColor, sourceLabel } from './colors'

describe('sourceColor / sourceLabel', () => {
  it('gives NRT and SP of the same sensor the same colour and label', () => {
    expect(sourceColor('MODIS_NRT')).toBe(sourceColor('MODIS_SP'))
    expect(sourceColor('VIIRS_SNPP_NRT')).toBe(sourceColor('VIIRS_SNPP_SP'))
    expect(sourceLabel('VIIRS_NOAA20_NRT')).toBe(sourceLabel('VIIRS_NOAA20_SP'))
  })
  it('gives each sensor family a distinct colour', () => {
    const colors = new Set(['MODIS_NRT', 'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'].map(sourceColor))
    expect(colors.size).toBe(4)
  })
  it('has readable labels for known sources', () => {
    expect(sourceLabel('MODIS_NRT')).toBe('MODIS (Terra / Aqua)')
    expect(sourceLabel('VIIRS_NOAA21_NRT')).toBe('VIIRS NOAA-21')
  })
  it('falls back to a stable hex colour for unknown sources', () => {
    const c = sourceColor('SOMETHING_NEW')
    expect(c).toMatch(/^#[0-9a-f]{6}$/i)
    expect(sourceColor('SOMETHING_NEW')).toBe(c)
  })
  it('does not reuse a known colour for the fallback', () => {
    const known = new Set(['MODIS_NRT', 'VIIRS_SNPP_NRT', 'VIIRS_NOAA20_NRT', 'VIIRS_NOAA21_NRT'].map(sourceColor))
    for (const s of ['A', 'B', 'LANDSAT_X', 'VIIRS_NOAA22_NRT', '', 'ÿ'.repeat(50)]) expect(known.has(sourceColor(s))).toBe(false)
  })
  it('does not throw for the empty string', () => {
    expect(sourceColor('')).toMatch(/^#/)
    expect(sourceLabel('')).toBe('')
  })
  it('turns underscores into spaces for unknown labels', () => {
    expect(sourceLabel('LANDSAT_9_NRT')).toBe('LANDSAT 9 NRT')
  })
  it('does not treat Object.prototype keys as known sources', () => {
    expect(sourceLabel('constructor')).toBe('constructor')
    expect(sourceColor('toString')).toMatch(/^#[0-9a-f]{6}$/i)
  })
})

describe('confidence constants', () => {
  it('has a colour for every level in order', () => {
    expect(CONFIDENCE_ORDER).toEqual(['low', 'nominal', 'high'])
    for (const k of CONFIDENCE_ORDER) expect(CONFIDENCE_COLORS[k]).toMatch(/^#/)
  })
})

describe('frpColor', () => {
  it('returns the first colour for zero and small values', () => {
    expect(frpColor(0)).toBe(FRP_STOPS[0].color)
    expect(frpColor(4.999)).toBe(FRP_STOPS[0].color)
  })
  it.each(FRP_STOPS.map((s) => [s.from, s.color] as const))('switches exactly at stop %d', (from, color) => {
    expect(frpColor(from)).toBe(color)
    expect(frpColor(from + 0.001)).toBe(color)
  })
  it('stays on the previous colour just below each stop', () => {
    for (let i = 1; i < FRP_STOPS.length; i++) {
      expect(frpColor(FRP_STOPS[i].from - 0.001)).toBe(FRP_STOPS[i - 1].color)
    }
  })
  it('uses the last colour for very large values', () => {
    expect(frpColor(100_000)).toBe(FRP_STOPS.at(-1)!.color)
    expect(frpColor(Infinity)).toBe(FRP_STOPS.at(-1)!.color)
  })
  it('uses the first colour for negatives and NaN', () => {
    expect(frpColor(-5)).toBe(FRP_STOPS[0].color)
    expect(frpColor(NaN)).toBe(FRP_STOPS[0].color)
  })
  it('has strictly increasing stops', () => {
    for (let i = 1; i < FRP_STOPS.length; i++) expect(FRP_STOPS[i].from).toBeGreaterThan(FRP_STOPS[i - 1].from)
  })
})

describe('heatColor', () => {
  const last = HEAT_RAMP.length - 1
  it('is the base colour for 0, negatives, NaN and -Infinity', () => {
    for (const t of [0, -0, -0.5, -1e-12, NaN, -Infinity]) expect(heatColor(t)).toBe(HEAT_RAMP[0])
  })
  it('is the first non-base colour for tiny positive values', () => {
    expect(heatColor(1e-9)).toBe(HEAT_RAMP[1])
    expect(heatColor(Number.MIN_VALUE)).toBe(HEAT_RAMP[1])
  })
  it('is the top colour at 1, above 1 and at Infinity', () => {
    expect(heatColor(1)).toBe(HEAT_RAMP[last])
    expect(heatColor(7)).toBe(HEAT_RAMP[last])
    expect(heatColor(Infinity)).toBe(HEAT_RAMP[last])
  })
  it('is monotonic non-decreasing over [0, 1]', () => {
    let prev = 0
    for (let k = 0; k <= 100; k++) {
      const i = HEAT_RAMP.indexOf(heatColor(k / 100))
      expect(i).toBeGreaterThanOrEqual(prev)
      prev = i
    }
  })
  it('uses every ramp colour', () => {
    const seen = new Set<string>()
    for (let k = 0; k <= 1000; k++) seen.add(heatColor(k / 1000))
    expect(seen.size).toBe(HEAT_RAMP.length)
  })
})
