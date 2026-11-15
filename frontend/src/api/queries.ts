import { keepPreviousData, useMutation, useQuery } from '@tanstack/react-query'
import { useContext } from 'react'
import { useStore } from '../state/store'
import { ApiContext } from './context'
import type { ApiMode } from './index'
import { ingestionApi, isFinished } from './ingestion'
import { loadCountryPolygon, pointInPolygon } from '../lib/geo'
import { DEFAULT_LIMIT, DEFAULT_MIN_COUNT, DEFAULT_RADIUS_KM, clusterDetections } from '../lib/hotspots'
import type { Api, CommonFilters, HotspotCollection, IngestionJobCreate, Interval } from './types'

function useApiContext() {
  const ctx = useContext(ApiContext)
  if (!ctx) throw new Error('ApiProvider is missing')
  return ctx
}

export function useApi(): Api {
  return useApiContext().api
}

/** 'mock' = built-in demo data (backend not ready), 'real' = live backend. */
export function useApiMode(): ApiMode {
  return useApiContext().mode
}

/**
 * Current filters from the store, in API shape. `bbox` is the selected place
 * (search) when there is one, otherwise the map viewport.
 */
export function useCommonFilters(opts: { withBbox?: boolean } = {}): CommonFilters {
  const { withBbox = true } = opts
  const dateFrom = useStore((s) => s.dateFrom)
  const dateTo = useStore((s) => s.dateTo)
  const sources = useStore((s) => s.sources)
  const daynight = useStore((s) => s.daynight)
  const minConfidence = useStore((s) => s.minConfidence)
  const viewBbox = useStore((s) => s.viewBbox)
  const regionBbox = useStore((s) => s.region?.bbox ?? null)
  const bbox = regionBbox ?? viewBbox
  return {
    date_from: dateFrom,
    date_to: dateTo,
    ...(withBbox && bbox ? { bbox } : {}),
    ...(sources.length ? { source: sources } : {}),
    ...(daynight ? { daynight } : {}),
    ...(minConfidence ? { min_confidence: minConfidence } : {}),
  }
}

export function useMeta() {
  const api = useApi()
  return useQuery({ queryKey: ['meta'], queryFn: ({ signal }) => api.getMeta(signal), staleTime: 5 * 60_000 })
}

export function useAreas() {
  const api = useApi()
  return useQuery({ queryKey: ['areas'], queryFn: ({ signal }) => api.getAreas(signal), staleTime: Infinity })
}

/** Points for the map: current filters + viewport. Waits until the map reports its viewport. */
export function useDetections(limit = 5000) {
  const api = useApi()
  const filters = useCommonFilters()
  return useQuery({
    queryKey: ['detections', filters, limit],
    queryFn: ({ signal }) => api.getDetections({ ...filters, limit }, signal),
    enabled: filters.bbox != null,
    placeholderData: keepPreviousData,
  })
}

export function useDetection(id: number | null) {
  const api = useApi()
  return useQuery({
    queryKey: ['detection', id],
    queryFn: ({ signal }) => api.getDetection(id as number, signal),
    enabled: id != null,
    staleTime: Infinity,
  })
}

export interface TimeseriesOptions {
  interval: Interval
  groupBySource?: boolean
  /** Override the period from the filters (e.g. a whole year for the calendar). */
  dateFrom?: string
  dateTo?: string
  /** Restrict to the map viewport (default true). */
  withBbox?: boolean
  enabled?: boolean
}

export function useTimeseries(opts: TimeseriesOptions) {
  const api = useApi()
  const base = useCommonFilters({ withBbox: opts.withBbox })
  const filters: CommonFilters = {
    ...base,
    date_from: opts.dateFrom ?? base.date_from,
    date_to: opts.dateTo ?? base.date_to,
  }
  return useQuery({
    queryKey: ['timeseries', filters, opts.interval, !!opts.groupBySource],
    queryFn: ({ signal }) =>
      api.getTimeseries({ ...filters, interval: opts.interval, ...(opts.groupBySource ? { group_by: 'source' as const } : {}) }, signal),
    enabled: opts.enabled ?? true,
    placeholderData: keepPreviousData,
  })
}

/** Aggregated grid for dense views. `data === null` means the backend has no grid endpoint. */
export function useGrid(cell: number, enabled: boolean) {
  const api = useApi()
  const filters = useCommonFilters()
  return useQuery({
    queryKey: ['grid', filters, cell],
    queryFn: ({ signal }) => api.getGrid({ ...filters, cell }, signal),
    enabled: enabled && filters.bbox != null,
    placeholderData: keepPreviousData,
  })
}

/** Detections fetched for client-side clustering when the backend has no /hotspots. */
const FALLBACK_SAMPLE = 20_000

/**
 * Critical hotspots for the current filters and scope, strongest first.
 * Uses GET /api/hotspots when the backend has it; otherwise clusters a sample
 * of detections in the browser and marks the result `approximate` if the
 * sample was cut short.
 */
export function useHotspots(opts: { limit?: number; enabled?: boolean } = {}) {
  const api = useApi()
  const filters = useCommonFilters()
  const limit = opts.limit ?? DEFAULT_LIMIT
  return useQuery({
    queryKey: ['hotspots', filters, limit],
    queryFn: async ({ signal }): Promise<HotspotCollection> => {
      const params = { radius_km: DEFAULT_RADIUS_KM, min_count: DEFAULT_MIN_COUNT, limit }
      const fromApi = await api.getHotspots({ ...filters, ...params }, signal)
      if (fromApi) return fromApi
      const sample = await api.getDetections({ ...filters, limit: FALLBACK_SAMPLE }, signal)
      const points = sample.features.map((f) => ({
        lat: f.geometry.coordinates[1],
        lon: f.geometry.coordinates[0],
        frp: f.properties.frp,
        t: Date.parse(f.properties.acquired_at),
        source: f.properties.source_product,
      }))
      const { total, items } = clusterDetections(points, { radiusKm: params.radius_km, minCount: params.min_count, limit })
      return { ...params, total, approximate: sample.truncated, items }
    },
    enabled: (opts.enabled ?? true) && filters.bbox != null,
    placeholderData: keepPreviousData,
  })
}

/**
 * Hotspots for the current scope, ready to show. When a country is selected,
 * its bbox also covers bits of the neighbours, so hotspots whose centre lies
 * outside the country outline are dropped. The list and the map both use this
 * hook, so they always show the same set, in the same order.
 */
export function useScopedHotspots(opts: { limit?: number } = {}) {
  const limit = opts.limit ?? DEFAULT_LIMIT
  const country = useStore((s) => (s.region?.kind === 'country' ? s.region.countryCode : null))
  // Ask for more than we show: some will fall outside the outline.
  const query = useHotspots({ limit: country ? limit * 4 : limit })
  const outline = useQuery({
    queryKey: ['country-outline', country],
    queryFn: () => loadCountryPolygon(country as string),
    enabled: country != null,
    staleTime: Infinity,
  })
  const polygon = country ? outline.data : null
  let data = query.data
  if (data && polygon) {
    const inside = data.items.filter((h) => pointInPolygon(h.lat, h.lon, polygon))
    data = { ...data, total: inside.length, items: inside.slice(0, limit) }
  } else if (data && data.items.length > limit) {
    data = { ...data, items: data.items.slice(0, limit) }
  }
  return { ...query, data, isLoading: query.isLoading || (country != null && outline.isLoading) }
}

// --- Ingestion: always the real backend, whatever `useApiMode()` says. The
// read endpoints may still be demo data while these already work.

/** Is the backend reachable? Re-checked every 30 s. */
export function useBackendHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: ({ signal }) => ingestionApi.getHealth(signal),
    refetchInterval: 30_000,
    staleTime: 0,
    retry: false,
  })
}

export function useCreateIngestionJob() {
  return useMutation({ mutationFn: (job: IngestionJobCreate) => ingestionApi.createJob(job) })
}

/** Status of one job, polled until it finishes. */
export function useIngestionJob(taskId: string, enabled = true) {
  return useQuery({
    queryKey: ['ingestion-job', taskId],
    queryFn: ({ signal }) => ingestionApi.getJob(taskId, signal),
    enabled,
    refetchInterval: (query) => (query.state.data && isFinished(query.state.data.status) ? false : 3000),
    staleTime: 0,
    retry: false,
  })
}
