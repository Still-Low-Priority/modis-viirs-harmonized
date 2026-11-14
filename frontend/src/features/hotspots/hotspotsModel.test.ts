import { describe, expect, it } from 'vitest'
import type { Hotspot } from '../../api/types'
import {
  activeDays,
  activeDaysText,
  extentText,
  flyToBbox,
  periodText,
  placeLabel,
  severityTotals,
  sortHotspots,
  sourceShares,
} from './hotspotsModel'
import { messages } from './messages'

const t = messages.en

function hs(over: Partial<Hotspot>): Hotspot {
  return {
    id: 'x',
    lat: 48,
    lon: 24,
    radius_km: 12,
    bbox: [23.9, 47.9, 24.1, 48.1],
    count: 50,
    frp_sum: 600,
    frp_max: 40,
    first_seen: '2026-11-11T10:00:00Z',
    last_seen: '2026-11-13T01:00:00Z',
    by_source: { VIIRS_SNPP_NRT: 30, MODIS_NRT: 20 },
    severity: 'high',
    ...over,
  }
}

const rakhiv = { city: 'Rakhiv', region: 'Zakarpattia', countryCode: 'UA', countryName: 'Ukraine', distanceKm: 4 }

describe('placeLabel', () => {
  it('returns null when the place is unknown', () => {
    expect(placeLabel(null, { countryCode: null }, t)).toBeNull()
    expect(placeLabel(undefined, { countryCode: 'UA' }, t)).toBeNull()
  })
  it('omits the country when the selected place is that country', () => {
    expect(placeLabel(rakhiv, { countryCode: 'UA' }, t)).toBe('near Rakhiv, Zakarpattia')
  })
  it('adds the country otherwise', () => {
    expect(placeLabel(rakhiv, { countryCode: null }, t)).toBe('near Rakhiv, Zakarpattia, Ukraine')
    expect(placeLabel(rakhiv, { countryCode: 'PL' }, t)).toBe('near Rakhiv, Zakarpattia, Ukraine')
  })
  it('gives the distance beyond 60 km', () => {
    expect(placeLabel({ ...rakhiv, region: undefined, distanceKm: 84.4 }, { countryCode: 'UA' }, t)).toBe('84 km from Rakhiv')
  })
})

describe('flyToBbox', () => {
  it('grows the box by half its size', () => {
    const b = flyToBbox({ bbox: [20, 40, 22, 44] })
    expect(b).toEqual([19.5, 39, 22.5, 45])
  })
  it('keeps a minimum margin for tiny boxes', () => {
    expect(flyToBbox({ bbox: [10, 10, 10, 10] })).toEqual([9.9, 9.9, 10.1, 10.1])
  })
  it('keeps the antimeridian convention', () => {
    const [w, s, e, n] = flyToBbox({ bbox: [179.5, -17, -179.5, -16] })
    expect(w).toBeCloseTo(179.25)
    expect(e).toBeCloseTo(-179.25)
    expect(w > e).toBe(true)
    expect([s, n]).toEqual([-17.25, -15.75])
  })
  it('wraps a box that grows across the antimeridian', () => {
    const [w, , e] = flyToBbox({ bbox: [179.95, 0, 179.98, 0.1] })
    expect(w).toBeCloseTo(179.85)
    expect(e).toBeCloseTo(-179.92)
  })
  it('clamps latitudes', () => {
    const [, s, , n] = flyToBbox({ bbox: [0, -89.95, 1, 89.95] })
    expect(s).toBe(-90)
    expect(n).toBe(90)
  })
})

describe('active days and period', () => {
  it('counts UTC calendar days inclusively', () => {
    expect(activeDays('2026-11-11T23:00:00Z', '2026-11-13T00:30:00Z')).toBe(3)
    expect(activeDays('2026-11-13T01:00:00Z', '2026-11-13T05:00:00Z')).toBe(1)
  })
  it('formats the text', () => {
    expect(activeDaysText(hs({}), t)).toBe('3 days, last seen 13 Nov')
    expect(activeDaysText(hs({ first_seen: '2026-11-13T00:00:00Z' }), t)).toBe('1 day, last seen 13 Nov')
  })
  it('formats periods', () => {
    expect(periodText('2026-11-07', '2026-11-13')).toBe('7 - 13 Nov 2026')
    expect(periodText('2026-10-28', '2026-11-03')).toBe('28 Oct - 3 Nov 2026')
    expect(periodText('2025-12-28', '2026-01-03')).toBe('28 Dec 2025 - 3 Jan 2026')
    expect(periodText('2026-11-13', '2026-11-13')).toBe('13 Nov 2026')
  })
  it('formats the extent', () => {
    expect(extentText(12, t)).toBe('about 24 km across')
    expect(extentText(1.2, t)).toBe('about 2.4 km across')
  })
})

describe('sortHotspots', () => {
  const a = hs({ id: 'a', count: 200, frp_sum: 100, severity: 'critical', last_seen: '2026-11-10T00:00:00Z' })
  const b = hs({ id: 'b', count: 40, frp_sum: 900, severity: 'high', last_seen: '2026-11-13T00:00:00Z' })
  const c = hs({ id: 'c', count: 40, frp_sum: 50, severity: 'elevated', last_seen: '2026-11-12T00:00:00Z' })
  const items = [a, b, c]
  const ids = (r: ReturnType<typeof sortHotspots>) => r.map((x) => `${x.rank}${x.hotspot.id}`)

  it('keeps the received order by default', () => {
    expect(ids(sortHotspots(items, 'severity'))).toEqual(['1a', '2b', '3c'])
  })
  it('keeps ranks from the default order whatever the sort', () => {
    expect(ids(sortHotspots(items, 'count'))).toEqual(['1a', '2b', '3c'])
    expect(ids(sortHotspots(items, 'frp'))).toEqual(['2b', '1a', '3c'])
    expect(ids(sortHotspots(items, 'recent'))).toEqual(['2b', '3c', '1a'])
  })
  it('does not mutate the input', () => {
    sortHotspots(items, 'frp')
    expect(items.map((h) => h.id)).toEqual(['a', 'b', 'c'])
  })
  it('counts severities', () => {
    expect(severityTotals(items)).toEqual({ critical: 1, high: 1, elevated: 1 })
  })
})

describe('sourceShares', () => {
  it('orders sensors by count and computes shares', () => {
    expect(sourceShares({ MODIS_NRT: 1, VIIRS_SNPP_NRT: 3, X: 0 })).toEqual([
      { source: 'VIIRS_SNPP_NRT', count: 3, share: 0.75 },
      { source: 'MODIS_NRT', count: 1, share: 0.25 },
    ])
    expect(sourceShares({})).toEqual([])
  })
})
