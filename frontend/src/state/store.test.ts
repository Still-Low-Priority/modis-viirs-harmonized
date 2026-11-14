import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { daysBetween } from '../lib/dates'
import type { Place } from '../lib/geo/types'
import { defaultRange, useStore } from './store'

const initial = useStore.getState()
const get = () => useStore.getState()

beforeEach(() => {
  useStore.setState(initial, true)
})
afterEach(() => vi.useRealTimers())

describe('defaultRange', () => {
  it('is the 7 days ending at the given last day', () => {
    expect(defaultRange('2026-08-15')).toEqual({ dateFrom: '2026-08-09', dateTo: '2026-08-15' })
  })
  it('spans exactly 7 inclusive days', () => {
    const r = defaultRange('2026-03-02')
    expect(daysBetween(r.dateFrom, r.dateTo)).toBe(7)
  })
  it('crosses month and year boundaries', () => {
    expect(defaultRange('2026-01-03')).toEqual({ dateFrom: '2025-12-28', dateTo: '2026-01-03' })
  })
  it('crosses the leap day', () => {
    expect(defaultRange('2024-03-02')).toEqual({ dateFrom: '2024-02-25', dateTo: '2024-03-02' })
  })
  it('ends yesterday (UTC) by default', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-08-15T00:30:00Z'))
    expect(defaultRange()).toEqual({ dateFrom: '2026-08-08', dateTo: '2026-08-14' })
    vi.setSystemTime(new Date('2026-08-15T23:59:59Z'))
    expect(defaultRange().dateTo).toBe('2026-08-14')
  })
})

describe('initial state', () => {
  it('has no filters and a 7-day range', () => {
    expect(get().sources).toEqual([])
    expect(get().daynight).toBeNull()
    expect(get().minConfidence).toBeNull()
    expect(get().viewBbox).toBeNull()
    expect(daysBetween(get().dateFrom, get().dateTo)).toBe(7)
  })
})

describe('setDateRange', () => {
  it('stores an ordered range as given', () => {
    get().setDateRange('2026-01-01', '2026-01-31')
    expect(get()).toMatchObject({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
  })
  it('swaps a reversed range', () => {
    get().setDateRange('2026-01-31', '2026-01-01')
    expect(get()).toMatchObject({ dateFrom: '2026-01-01', dateTo: '2026-01-31' })
  })
  it('accepts a single-day range', () => {
    get().setDateRange('2026-01-05', '2026-01-05')
    expect(get()).toMatchObject({ dateFrom: '2026-01-05', dateTo: '2026-01-05' })
  })
})

describe('sources', () => {
  it('toggleSource adds then removes', () => {
    get().toggleSource('MODIS_NRT')
    expect(get().sources).toEqual(['MODIS_NRT'])
    get().toggleSource('VIIRS_SNPP_NRT')
    expect(get().sources).toEqual(['MODIS_NRT', 'VIIRS_SNPP_NRT'])
    get().toggleSource('MODIS_NRT')
    expect(get().sources).toEqual(['VIIRS_SNPP_NRT'])
  })
  it('toggleSource does not mutate the previous array', () => {
    get().toggleSource('A')
    const before = get().sources
    get().toggleSource('B')
    expect(before).toEqual(['A'])
    expect(get().sources).not.toBe(before)
  })
  it('setSources replaces the list', () => {
    get().toggleSource('A')
    get().setSources(['X', 'Y'])
    expect(get().sources).toEqual(['X', 'Y'])
  })
})

describe('simple setters', () => {
  it('sets daynight, minConfidence, viewBbox, select, colorBy, basemap and panels', () => {
    get().setDaynight('N')
    get().setMinConfidence('high')
    get().setViewBbox([1, 2, 3, 4])
    get().select(99)
    get().setColorBy('frp')
    get().setBasemap('satellite')
    get().setSidebarOpen(false)
    get().setBottomOpen(false)
    expect(get()).toMatchObject({
      daynight: 'N',
      minConfidence: 'high',
      viewBbox: [1, 2, 3, 4],
      selectedId: 99,
      colorBy: 'frp',
      basemap: 'satellite',
      sidebarOpen: false,
      bottomOpen: false,
    })
  })
  it('can clear daynight and minConfidence with null', () => {
    get().setDaynight('D')
    get().setDaynight(null)
    get().setMinConfidence('low')
    get().setMinConfidence(null)
    expect(get().daynight).toBeNull()
    expect(get().minConfidence).toBeNull()
  })
})

const kyiv: Place = {
  id: 'region:UA-30',
  kind: 'region',
  name: 'Kyiv',
  countryCode: 'UA',
  countryName: 'Ukraine',
  bbox: [30.2, 50.2, 30.9, 50.6],
  lat: 50.45,
  lon: 30.52,
}
const ukraine: Place = { ...kyiv, id: 'country:UA', kind: 'country', name: 'Ukraine', bbox: [22.1, 44.3, 40.3, 52.4] }

describe('setRegion / requestFlyTo', () => {
  it('starts without a region', () => {
    expect(get().region).toBeNull()
  })
  it('setRegion stores the place and asks the map to fly to its bbox', () => {
    get().setRegion(kyiv)
    expect(get().region).toBe(kyiv)
    expect(get().flyTo).toMatchObject({ bbox: kyiv.bbox })
  })
  it('emits a new nonce every time, even for the same place', () => {
    get().setRegion(kyiv)
    const a = get().flyTo!.nonce
    get().setRegion(kyiv)
    const b = get().flyTo!.nonce
    expect(b).toBe(a + 1)
  })
  it('clears the selected hotspot', () => {
    get().selectHotspot('h1')
    get().setRegion(ukraine)
    expect(get().selectedHotspotId).toBeNull()
  })
  it('setRegion(null) clears the region and the hotspot without moving the map', () => {
    get().setRegion(kyiv)
    const fly = get().flyTo
    get().selectHotspot('h2')
    get().setRegion(null)
    expect(get().region).toBeNull()
    expect(get().selectedHotspotId).toBeNull()
    expect(get().flyTo).toBe(fly)
  })
  it('increments the nonce on every request, even for an identical bbox', () => {
    const bbox: [number, number, number, number] = [1, 2, 3, 4]
    get().requestFlyTo(bbox)
    const a = get().flyTo!.nonce
    get().requestFlyTo(bbox)
    const b = get().flyTo!.nonce
    get().setRegion({ ...kyiv, bbox })
    const c = get().flyTo!.nonce
    expect(b).toBe(a + 1)
    expect(c).toBe(b + 1)
  })
  it('requestFlyTo leaves the region alone', () => {
    get().setRegion(kyiv)
    get().requestFlyTo([1, 2, 3, 4])
    expect(get().region).toBe(kyiv)
    expect(get().flyTo).toMatchObject({ bbox: [1, 2, 3, 4] })
  })
})

describe('sidebar and hotspot UI state', () => {
  it('has hotspot defaults', () => {
    expect(get()).toMatchObject({ sidebarTab: 'hotspots', showHotspots: true, selectedHotspotId: null })
  })
  it('setSidebarTab switches the tab and opens the sidebar', () => {
    get().setSidebarOpen(false)
    get().setSidebarTab('filters')
    expect(get()).toMatchObject({ sidebarTab: 'filters', sidebarOpen: true })
    get().setSidebarTab('hotspots')
    expect(get()).toMatchObject({ sidebarTab: 'hotspots', sidebarOpen: true })
  })
  it('setShowHotspots and selectHotspot', () => {
    get().setShowHotspots(false)
    get().selectHotspot('abc')
    expect(get()).toMatchObject({ showHotspots: false, selectedHotspotId: 'abc' })
    get().selectHotspot(null)
    expect(get().selectedHotspotId).toBeNull()
  })
})

describe('resetFilters', () => {
  it('restores the filters and keeps the region (the search owns it)', () => {
    get().setDateRange('2020-01-01', '2020-02-01')
    get().toggleSource('A')
    get().setDaynight('D')
    get().setMinConfidence('high')
    get().setRegion(kyiv)
    get().resetFilters()
    expect(get().sources).toEqual([])
    expect(get().daynight).toBeNull()
    expect(get().minConfidence).toBeNull()
    expect(get().region).toBe(kyiv)
    expect({ dateFrom: get().dateFrom, dateTo: get().dateTo }).toEqual(defaultRange())
  })
  it('leaves map and UI state alone', () => {
    get().setViewBbox([1, 2, 3, 4])
    get().requestFlyTo([5, 6, 7, 8])
    get().select(7)
    get().setColorBy('confidence')
    get().setBasemap('light')
    get().setSidebarOpen(false)
    get().setBottomOpen(false)
    const { viewBbox, flyTo } = get()
    get().resetFilters()
    expect(get()).toMatchObject({ selectedId: 7, colorBy: 'confidence', basemap: 'light', sidebarOpen: false, bottomOpen: false })
    expect(get().viewBbox).toBe(viewBbox)
    expect(get().flyTo).toBe(flyTo)
  })
  it('recomputes the default range from the current date, not from import time', () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2030-05-10T12:00:00Z'))
    get().resetFilters()
    expect(get()).toMatchObject({ dateFrom: '2030-05-03', dateTo: '2030-05-09' })
  })
})
