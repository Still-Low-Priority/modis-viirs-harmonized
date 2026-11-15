import { get, postJson } from './http'
import type { Bbox, Health, IngestionJobAccepted, IngestionJobCreate, IngestionJobStatus } from './types'

/** FIRMS products the backend accepts as `source` (backend: FIRMSProduct). */
export const FIRMS_PRODUCTS = [
  'VIIRS_SNPP_NRT',
  'VIIRS_NOAA20_NRT',
  'VIIRS_NOAA21_NRT',
  'MODIS_NRT',
  'VIIRS_SNPP_SP',
  'VIIRS_NOAA20_SP',
  'VIIRS_NOAA21_SP',
  'MODIS_SP',
] as const

export type FirmsProduct = (typeof FIRMS_PRODUCTS)[number]

/** NRT = near real-time (the last weeks), SP = standard processing (archive). */
export function isNearRealTime(source: string): boolean {
  return source.endsWith('_NRT')
}

/** The backend asks FIRMS for at most this many days per request. */
export const FIRMS_DAYS_PER_REQUEST = 5

/**
 * The backend puts no limit on the period, and every 5 days is one more call
 * against the shared FIRMS key, so the UI does not offer longer jobs.
 */
export const MAX_INGESTION_DAYS = 31

const TERMINAL = new Set(['SUCCESS', 'FAILURE', 'REVOKED'])

export function isFinished(status: string): boolean {
  return TERMINAL.has(status)
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** Longitude into [-180, 180]; 180 stays 180 so a box can end on the antimeridian. */
function wrapLon(lon: number): number {
  if (lon >= -180 && lon <= 180) return lon
  const w = ((((lon + 180) % 360) + 360) % 360) - 180
  return w === -180 && lon > 0 ? 180 : w
}

/**
 * A map viewport in the shape the ingestion endpoint accepts: latitudes inside
 * [-90, 90], longitudes inside [-180, 180] (west > east = crosses the
 * antimeridian, which the backend splits itself), rounded to 0.01°. Rounding
 * matters: the backend recognises an already-loaded area only by exact
 * coordinates. Returns null when nothing sensible is left.
 */
export function toIngestionBbox(bbox: Bbox): Bbox | null {
  const [w, s, e, n] = bbox
  if (![w, s, e, n].every(Number.isFinite)) return null
  const south = round2(Math.max(-90, Math.min(90, s)))
  const north = round2(Math.max(-90, Math.min(90, n)))
  if (south >= north) return null
  // A viewport at least one world wide covers every longitude.
  if (e - w >= 360) return [-180, south, 180, north]
  const west = round2(wrapLon(w))
  const east = round2(wrapLon(e))
  if (west === east) return null
  return [west, south, east, north]
}

/** How many FIRMS requests a job costs at most (nothing loaded before). */
export function firmsRequestCount(bbox: Bbox, days: number): number {
  const parts = bbox[0] > bbox[2] ? 2 : 1
  return Math.ceil(days / FIRMS_DAYS_PER_REQUEST) * parts
}

export const ingestionApi = {
  getHealth: (signal?: AbortSignal) => get<Health>('/api/health', undefined, signal),
  createJob: (job: IngestionJobCreate, signal?: AbortSignal) => postJson<IngestionJobAccepted>('/api/ingestion/jobs', job, signal),
  getJob: (taskId: string, signal?: AbortSignal) =>
    get<IngestionJobStatus>(`/api/ingestion/jobs/${encodeURIComponent(taskId)}`, undefined, signal),
}
