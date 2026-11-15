import type {
  Api,
  Area,
  CommonFilters,
  DetectionCollection,
  DetectionDetail,
  GridCell,
  HotspotCollection,
  Meta,
  Timeseries,
} from './types'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
  }
}

/** Serialises the shared filters exactly as the contract describes them. */
export function filtersToParams(f: CommonFilters): URLSearchParams {
  const p = new URLSearchParams()
  p.set('date_from', f.date_from)
  p.set('date_to', f.date_to)
  if (f.area_id != null) p.set('area_id', String(f.area_id))
  else if (f.bbox) p.set('bbox', f.bbox.map((n) => +n.toFixed(4)).join(','))
  for (const s of f.source ?? []) p.append('source', s)
  if (f.daynight) p.set('daynight', f.daynight)
  if (f.min_confidence) p.set('min_confidence', f.min_confidence)
  return p
}

/** Pydantic validation errors arrive as a list; show the first message, not raw JSON. */
function describeDetail(detail: unknown): string {
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail)) {
    const first = detail[0] as { msg?: unknown } | undefined
    if (typeof first?.msg === 'string') return first.msg
  }
  return JSON.stringify(detail)
}

export async function postJson<T>(path: string, body: unknown, signal?: AbortSignal): Promise<T> {
  return send<T>(path, {
    method: 'POST',
    signal,
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

export async function get<T>(path: string, params?: URLSearchParams, signal?: AbortSignal): Promise<T> {
  const qs = params?.toString()
  return send<T>(qs ? `${path}?${qs}` : path, {
    signal,
    headers: { Accept: 'application/json' },
  })
}

async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init)
  if (!res.ok) {
    let detail = res.statusText
    try {
      const body = (await res.json()) as { detail?: unknown }
      if (body.detail) detail = describeDetail(body.detail)
    } catch {
      // not JSON, keep the status text
    }
    throw new ApiError(res.status, detail)
  }
  return (await res.json()) as T
}

/** Optional endpoints: a missing route (404/405/501) means "not implemented yet". */
async function optional<T>(p: Promise<T>, fallback: T): Promise<T> {
  try {
    return await p
  } catch (e) {
    if (e instanceof ApiError && [404, 405, 501].includes(e.status)) return fallback
    throw e
  }
}

export const httpApi: Api = {
  getMeta: (signal) => get<Meta>('/api/meta', undefined, signal),

  getDetections: (q, signal) => {
    const p = filtersToParams(q)
    if (q.limit != null) p.set('limit', String(q.limit))
    return get<DetectionCollection>('/api/detections', p, signal)
  },

  getDetection: (id, signal) => get<DetectionDetail>(`/api/detections/${id}`, undefined, signal),

  getTimeseries: (q, signal) => {
    const p = filtersToParams(q)
    p.set('interval', q.interval)
    if (q.group_by) p.set('group_by', q.group_by)
    return get<Timeseries>('/api/stats/timeseries', p, signal)
  },

  getAreas: (signal) => optional(get<Area[]>('/api/areas', undefined, signal), []),

  getGrid: (q, signal) => {
    const p = filtersToParams(q)
    p.set('cell', String(q.cell))
    return optional<GridCell[] | null>(get<GridCell[]>('/api/detections/grid', p, signal), null)
  },

  getHotspots: (q, signal) => {
    const p = filtersToParams(q)
    if (q.radius_km != null) p.set('radius_km', String(q.radius_km))
    if (q.min_count != null) p.set('min_count', String(q.min_count))
    if (q.limit != null) p.set('limit', String(q.limit))
    return optional<HotspotCollection | null>(get<HotspotCollection>('/api/hotspots', p, signal), null)
  },
}
