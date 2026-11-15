import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../lib/geo/types'
import { useStore } from '../state/store'
import { ApiProvider } from './ApiProvider'
import { processingKinds, scopeMeta, useCommonFilters, useDetection, useDetections, useGrid, useApiMode, useHotspots, useScopedHotspots } from './queries'
import type { Api, DetectionFeature, Hotspot, HotspotCollection } from './types'

// The country outline is only needed by useScopedHotspots; "inside" here means west of 30 E.
vi.mock('../lib/geo', () => ({
  loadCountryPolygon: vi.fn(async () => [[[[0, 0]]]]),
  pointInPolygon: vi.fn((_lat: number, lon: number) => lon < 30),
}))

const initial = useStore.getState()

function fakeApi(): Api {
  return {
    getMeta: vi.fn(async () => ({ sources: [], date_min: null, date_max: null, last_ingested_at: null })),
    getDetections: vi.fn(async () => ({ type: 'FeatureCollection' as const, total: 0, truncated: false, features: [] })),
    getDetection: vi.fn(async () => {
      throw new Error('unused')
    }),
    getTimeseries: vi.fn(async (q) => ({ interval: q.interval, items: [] })),
    getAreas: vi.fn(async () => []),
    getGrid: vi.fn(async () => []),
    getHotspots: vi.fn(async () => null),
  }
}

const place = (over: Partial<Place> = {}): Place => ({
  id: 'region:UA-30',
  kind: 'region',
  name: 'Kyiv',
  countryCode: 'UA',
  countryName: 'Ukraine',
  bbox: [30.2, 50.2, 30.9, 50.6],
  lat: 50.45,
  lon: 30.52,
  ...over,
})

const hotspot = (id: string, lon: number, over: Partial<Hotspot> = {}): Hotspot => ({
  id,
  lat: 49,
  lon,
  radius_km: 5,
  bbox: [lon - 0.1, 48.9, lon + 0.1, 49.1],
  count: 50,
  frp_sum: 400,
  frp_max: 30,
  first_seen: '2026-08-01T12:00:00Z',
  last_seen: '2026-08-02T12:00:00Z',
  by_source: { MODIS_NRT: 50 },
  severity: 'high',
  ...over,
})

const collection = (items: Hotspot[], over: Partial<HotspotCollection> = {}): HotspotCollection => ({
  radius_km: 10,
  min_count: 10,
  total: items.length,
  approximate: false,
  items,
  ...over,
})

function feature(id: number, lat: number, lon: number): DetectionFeature {
  return {
    type: 'Feature',
    id,
    geometry: { type: 'Point', coordinates: [lon, lat] },
    properties: { acquired_at: '2026-08-02T11:20:00Z', source_product: 'VIIRS_SNPP_NRT', instrument: 'VIIRS', confidence: 'nominal', frp: 12, daynight: 'D' },
  }
}

function wrapperFor(api: Api, mode: 'real' | 'mock' = 'mock') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>
      <ApiProvider api={api} mode={mode}>
        {children}
      </ApiProvider>
    </QueryClientProvider>
  )
}

beforeEach(() => {
  useStore.setState(initial, true)
  act(() => useStore.getState().setDateRange('2026-08-01', '2026-08-07'))
})

describe('useCommonFilters', () => {
  it('returns only the dates and the product kind for an empty store', () => {
    const { result } = renderHook(() => useCommonFilters())
    expect(result.current).toEqual({ date_from: '2026-08-01', date_to: '2026-08-07', processing: 'NRT' })
  })

  it('has no keys for unset optional filters (not even undefined)', () => {
    const { result } = renderHook(() => useCommonFilters())
    expect(Object.keys(result.current).sort()).toEqual(['date_from', 'date_to', 'processing'])
  })

  it('maps a populated store to API names', () => {
    act(() => {
      const s = useStore.getState()
      s.setViewBbox([1, 2, 3, 4])
      s.setSources(['MODIS_NRT', 'VIIRS_SNPP_NRT'])
      s.setDaynight('N')
      s.setMinConfidence('nominal')
    })
    const { result } = renderHook(() => useCommonFilters())
    expect(result.current).toEqual({
      date_from: '2026-08-01',
      date_to: '2026-08-07',
      processing: 'NRT',
      bbox: [1, 2, 3, 4],
      source: ['MODIS_NRT', 'VIIRS_SNPP_NRT'],
      daynight: 'N',
      min_confidence: 'nominal',
    })
  })

  it('omits bbox with withBbox: false even when the viewport is set', () => {
    act(() => useStore.getState().setViewBbox([1, 2, 3, 4]))
    const { result } = renderHook(() => useCommonFilters({ withBbox: false }))
    expect(result.current).not.toHaveProperty('bbox')
  })

  it('omits source when the selection is empty', () => {
    act(() => useStore.getState().setSources([]))
    const { result } = renderHook(() => useCommonFilters())
    expect(result.current).not.toHaveProperty('source')
  })

  it('uses the region bbox in preference to the viewport', () => {
    act(() => {
      useStore.getState().setViewBbox([1, 2, 3, 4])
      useStore.getState().setRegion(place())
    })
    const { result } = renderHook(() => useCommonFilters())
    expect(result.current.bbox).toEqual([30.2, 50.2, 30.9, 50.6])
    expect(result.current).not.toHaveProperty('area_id')
  })

  it('uses the region bbox even before the map reports a viewport', () => {
    act(() => useStore.getState().setRegion(place()))
    const { result } = renderHook(() => useCommonFilters())
    expect(result.current.bbox).toEqual([30.2, 50.2, 30.9, 50.6])
  })

  it('goes back to the viewport when the region is cleared', () => {
    act(() => {
      useStore.getState().setViewBbox([1, 2, 3, 4])
      useStore.getState().setRegion(place())
    })
    const { result } = renderHook(() => useCommonFilters())
    act(() => useStore.getState().setRegion(null))
    expect(result.current.bbox).toEqual([1, 2, 3, 4])
  })

  it('omits the region bbox with withBbox: false', () => {
    act(() => useStore.getState().setRegion(place()))
    const { result } = renderHook(() => useCommonFilters({ withBbox: false }))
    expect(result.current).not.toHaveProperty('bbox')
  })

  it('updates when the store changes', () => {
    const { result } = renderHook(() => useCommonFilters())
    act(() => useStore.getState().setDaynight('D'))
    expect(result.current.daynight).toBe('D')
  })
})

describe('useApiMode', () => {
  it('returns the mode given to the provider', () => {
    const { result } = renderHook(() => useApiMode(), { wrapper: wrapperFor(fakeApi(), 'real') })
    expect(result.current).toBe('real')
  })
  it('throws without a provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(() => renderHook(() => useApiMode())).toThrow('ApiProvider is missing')
    spy.mockRestore()
  })
})

describe('useDetections', () => {
  it('stays disabled until viewBbox is set', async () => {
    const api = fakeApi()
    const { result } = renderHook(() => useDetections(), { wrapper: wrapperFor(api) })
    expect(result.current.fetchStatus).toBe('idle')
    expect(api.getDetections).not.toHaveBeenCalled()
    act(() => useStore.getState().setViewBbox([10, 20, 30, 40]))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(api.getDetections).toHaveBeenCalledTimes(1)
  })

  it('passes filters, bbox and the limit to the api', async () => {
    const api = fakeApi()
    act(() => {
      useStore.getState().setViewBbox([10, 20, 30, 40])
      useStore.getState().setDaynight('D')
    })
    const { result } = renderHook(() => useDetections(123), { wrapper: wrapperFor(api) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(api.getDetections).mock.calls[0][0]).toEqual({
      date_from: '2026-08-01',
      date_to: '2026-08-07',
      processing: 'NRT',
      bbox: [10, 20, 30, 40],
      daynight: 'D',
      limit: 123,
    })
    expect(vi.mocked(api.getDetections).mock.calls[0][1]).toBeInstanceOf(AbortSignal)
  })

  it('defaults the limit to 5000', async () => {
    const api = fakeApi()
    act(() => useStore.getState().setViewBbox([10, 20, 30, 40]))
    const { result } = renderHook(() => useDetections(), { wrapper: wrapperFor(api) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(api.getDetections).mock.calls[0][0].limit).toBe(5000)
  })

  it('refetches when a filter changes', async () => {
    const api = fakeApi()
    act(() => useStore.getState().setViewBbox([10, 20, 30, 40]))
    const { result } = renderHook(() => useDetections(), { wrapper: wrapperFor(api) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    act(() => useStore.getState().setMinConfidence('high'))
    await waitFor(() => expect(api.getDetections).toHaveBeenCalledTimes(2))
    expect(vi.mocked(api.getDetections).mock.calls[1][0].min_confidence).toBe('high')
  })
})

describe('useGrid / useDetection', () => {
  it('useGrid is disabled without a viewport or when enabled=false', async () => {
    const api = fakeApi()
    const { result, rerender } = renderHook(({ on }) => useGrid(1, on), { wrapper: wrapperFor(api), initialProps: { on: true } })
    expect(result.current.fetchStatus).toBe('idle')
    act(() => useStore.getState().setViewBbox([1, 2, 3, 4]))
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(api.getGrid).mock.calls[0][0]).toMatchObject({ cell: 1, bbox: [1, 2, 3, 4] })
    rerender({ on: false })
    expect(result.current.fetchStatus).toBe('idle')
  })

  it('useDetection is disabled for null and loads for an id', async () => {
    const api = fakeApi()
    vi.mocked(api.getDetection).mockResolvedValue({ id: 5 } as never)
    const { result, rerender } = renderHook(({ id }: { id: number | null }) => useDetection(id), {
      wrapper: wrapperFor(api),
      initialProps: { id: null as number | null },
    })
    expect(result.current.fetchStatus).toBe('idle')
    expect(api.getDetection).not.toHaveBeenCalled()
    rerender({ id: 5 })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(api.getDetection).mock.calls[0][0]).toBe(5)
  })

  it('useDetection treats id 0 as a valid id', async () => {
    const api = fakeApi()
    vi.mocked(api.getDetection).mockResolvedValue({ id: 0 } as never)
    const { result } = renderHook(() => useDetection(0), { wrapper: wrapperFor(api) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
  })
})

describe('useHotspots', () => {
  it('is disabled until there is a bbox', () => {
    const api = fakeApi()
    const { result } = renderHook(() => useHotspots(), { wrapper: wrapperFor(api) })
    expect(result.current.fetchStatus).toBe('idle')
    expect(api.getHotspots).not.toHaveBeenCalled()
  })

  it('uses the API result when the backend has /hotspots', async () => {
    const api = fakeApi()
    const fromApi = collection([hotspot('a', 20)], { total: 7 })
    vi.mocked(api.getHotspots).mockResolvedValue(fromApi)
    act(() => useStore.getState().setViewBbox([10, 20, 30, 40]))
    const { result } = renderHook(() => useHotspots({ limit: 7 }), { wrapper: wrapperFor(api) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(fromApi)
    expect(vi.mocked(api.getHotspots).mock.calls[0][0]).toEqual({
      date_from: '2026-08-01',
      date_to: '2026-08-07',
      processing: 'NRT',
      bbox: [10, 20, 30, 40],
      radius_km: 10,
      min_count: 10,
      limit: 7,
    })
    expect(api.getDetections).not.toHaveBeenCalled()
  })

  it.each([false, true])('falls back to clustering a detections sample (truncated=%s)', async (truncated) => {
    const api = fakeApi()
    // 12 points within 1 km near (0, 0), 3 far away: one hotspot of 12.
    const features = [
      ...Array.from({ length: 12 }, (_, i) => feature(i, 0.001 * i, 0.001 * i)),
      ...Array.from({ length: 3 }, (_, i) => feature(100 + i, 40, 40 + i)),
    ]
    vi.mocked(api.getDetections).mockResolvedValue({ type: 'FeatureCollection', total: truncated ? 99_999 : 15, truncated, features })
    act(() => useStore.getState().setViewBbox([-50, -50, 50, 50]))
    const { result } = renderHook(() => useHotspots(), { wrapper: wrapperFor(api) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(vi.mocked(api.getDetections).mock.calls[0][0]).toMatchObject({ bbox: [-50, -50, 50, 50], limit: 20_000 })
    const data = result.current.data!
    expect(data).toMatchObject({ radius_km: 10, min_count: 10, total: 1, approximate: truncated })
    expect(data.items).toHaveLength(1)
    expect(data.items[0]).toMatchObject({ count: 12, frp_sum: 144, by_source: { VIIRS_SNPP_NRT: 12 } })
  })

  it('surfaces a server error instead of falling back', async () => {
    const api = fakeApi()
    vi.mocked(api.getHotspots).mockRejectedValue(new Error('boom'))
    act(() => useStore.getState().setViewBbox([1, 2, 3, 4]))
    const { result } = renderHook(() => useHotspots(), { wrapper: wrapperFor(api) })
    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(api.getDetections).not.toHaveBeenCalled()
  })
})

describe('useScopedHotspots', () => {
  it('drops hotspots whose centre is outside the selected country', async () => {
    const api = fakeApi()
    const items = [hotspot('in1', 25), hotspot('out1', 35), hotspot('in2', 28), hotspot('out2', 31)]
    vi.mocked(api.getHotspots).mockResolvedValue(collection(items))
    act(() => useStore.getState().setRegion(place({ id: 'country:UA', kind: 'country', name: 'Ukraine', bbox: [22, 44, 40, 52] })))
    const { result } = renderHook(() => useScopedHotspots({ limit: 5 }), { wrapper: wrapperFor(api) })
    await waitFor(() => expect(result.current.isLoading).toBe(false))
    await waitFor(() => expect(result.current.data?.items.map((h) => h.id)).toEqual(['in1', 'in2']))
    expect(result.current.data!.total).toBe(2)
    // Asks for more than it shows, since some fall outside the outline.
    expect(vi.mocked(api.getHotspots).mock.calls[0][0].limit).toBe(20)
    const geo = await import('../lib/geo')
    expect(geo.loadCountryPolygon).toHaveBeenCalledWith('UA')
  })

  it('keeps everything and applies the limit when no country is selected', async () => {
    const api = fakeApi()
    vi.mocked(api.getHotspots).mockResolvedValue(collection([hotspot('a', 35), hotspot('b', 25), hotspot('c', 36)]))
    act(() => useStore.getState().setRegion(place())) // a region, not a country
    const { result } = renderHook(() => useScopedHotspots({ limit: 2 }), { wrapper: wrapperFor(api) })
    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data!.items.map((h) => h.id)).toEqual(['a', 'b'])
    expect(result.current.data!.total).toBe(3)
    expect(vi.mocked(api.getHotspots).mock.calls[0][0].limit).toBe(2)
  })
})

describe('product kinds', () => {
  const meta = {
    sources: [
      { source_product: 'MODIS_SP', processing: 'SP' as const, instrument: 'MODIS', satellites: ['Aqua'], date_min: '2026-02-01', date_max: '2026-02-02' },
      { source_product: 'VIIRS_NOAA20_NRT', processing: 'NRT' as const, instrument: 'VIIRS', satellites: ['N20'], date_min: '2026-11-12', date_max: '2026-11-13' },
      { source_product: 'MODIS_NRT', processing: 'NRT' as const, instrument: 'MODIS', satellites: ['Terra'], date_min: '2026-11-01', date_max: '2026-11-10' },
    ],
    date_min: '2026-02-01',
    date_max: '2026-11-13',
    last_ingested_at: '2026-11-15T15:47:07Z',
  }

  it('lists the kinds the backend has data for, recent first', () => {
    expect(processingKinds(meta)).toEqual(['NRT', 'SP'])
    expect(processingKinds({ ...meta, sources: meta.sources.slice(0, 1) })).toEqual(['SP'])
    expect(processingKinds(undefined)).toEqual([])
  })

  it('narrows sensors and the date range to one kind', () => {
    const nrt = scopeMeta(meta, 'NRT')
    expect(nrt.sources.map((s) => s.source_product)).toEqual(['VIIRS_NOAA20_NRT', 'MODIS_NRT'])
    expect([nrt.date_min, nrt.date_max]).toEqual(['2026-11-01', '2026-11-13'])
    const sp = scopeMeta(meta, 'SP')
    expect(sp.sources.map((s) => s.source_product)).toEqual(['MODIS_SP'])
    expect([sp.date_min, sp.date_max]).toEqual(['2026-02-01', '2026-02-02'])
    expect(sp.last_ingested_at).toBe(meta.last_ingested_at)
  })

  it('reports no dates for a kind without data', () => {
    const onlySp = { ...meta, sources: meta.sources.slice(0, 1) }
    expect(scopeMeta(onlySp, 'NRT')).toMatchObject({ sources: [], date_min: null, date_max: null })
  })

  it('leaves meta without kinds (demo data) untouched', () => {
    const demo = { ...meta, sources: meta.sources.map(({ source_product, instrument, satellites }) => ({ source_product, instrument, satellites })) }
    expect(scopeMeta(demo, 'SP')).toBe(demo)
  })

  it('sends the selected kind and clears the sensor selection on a switch', () => {
    act(() => useStore.getState().setSources(['MODIS_NRT']))
    act(() => useStore.getState().setProcessing('SP'))
    const { result } = renderHook(() => useCommonFilters())
    expect(result.current).toEqual({ date_from: '2026-08-01', date_to: '2026-08-07', processing: 'SP' })
  })
})
