// API contract between frontend and backend. Mirrors docs/api-requirements.md.
// All dates are UTC: ISO 8601 for timestamps, YYYY-MM-DD for days.

export type Confidence = 'low' | 'nominal' | 'high'
export type DayNight = 'D' | 'N'
export type Interval = 'day' | 'month' | 'year'

/** [west, south, east, north]. west > east means the box crosses the antimeridian. */
export type Bbox = [west: number, south: number, east: number, north: number]

export interface SourceInfo {
  source_product: string
  instrument: string
  satellites: string[]
}

export interface Meta {
  sources: SourceInfo[]
  date_min: string | null
  date_max: string | null
  last_ingested_at: string | null
}

/** Filters shared by /detections, /stats/timeseries and /detections/grid. */
export interface CommonFilters {
  date_from: string
  date_to: string
  bbox?: Bbox
  area_id?: number
  /** Empty or undefined = all sources. */
  source?: string[]
  daynight?: DayNight
  min_confidence?: Confidence
}

export interface DetectionsQuery extends CommonFilters {
  limit?: number
}

export interface DetectionProperties {
  acquired_at: string
  source_product: string
  instrument: string
  confidence: Confidence
  frp: number
  daynight: DayNight
}

export interface DetectionFeature {
  type: 'Feature'
  id: number
  /** GeoJSON order: [longitude, latitude]. */
  geometry: { type: 'Point'; coordinates: [lon: number, lat: number] }
  properties: DetectionProperties
}

export interface DetectionCollection {
  type: 'FeatureCollection'
  total: number
  truncated: boolean
  features: DetectionFeature[]
}

export interface DetectionDetail {
  id: number
  latitude: number
  longitude: number
  acquired_at: string
  source_product: string
  satellite: string
  instrument: string
  confidence: Confidence
  confidence_raw: string
  detection_type: number
  frp: number
  brightness: number | null
  bright_t31: number | null
  bright_ti4: number | null
  bright_ti5: number | null
  scan: number
  track: number
  daynight: DayNight
  version: string
}

export interface TimeseriesQuery extends CommonFilters {
  interval: Interval
  group_by?: 'source'
}

export interface TimeseriesItem {
  /** day: YYYY-MM-DD, month: YYYY-MM, year: YYYY */
  period: string
  count: number
  frp_sum: number
  /** Present only when group_by=source. */
  by_source?: Record<string, number>
}

export interface Timeseries {
  interval: Interval
  items: TimeseriesItem[]
}

export interface Area {
  id: number
  name: string
  country_code: string | null
  bbox: Bbox
}

export interface GridQuery extends CommonFilters {
  /** Cell size in degrees. */
  cell: number
}

export interface GridCell {
  /** Cell centre. */
  lat: number
  lon: number
  count: number
  frp_sum: number
}

export type Severity = 'elevated' | 'high' | 'critical'

export interface HotspotsQuery extends CommonFilters {
  /** Two detections closer than this belong to the same hotspot. Default 10. */
  radius_km?: number
  /** Smallest cluster that counts as a hotspot. Default 10. */
  min_count?: number
  /** Return at most this many, strongest first. Default 50. */
  limit?: number
}

/** A dense cluster of detections: one fire complex or a group of neighbouring fires. */
export interface Hotspot {
  /** Stable for the same query: derived from the centre and the period. */
  id: string
  /** Centre of mass of the detections. */
  lat: number
  lon: number
  /** Distance from the centre to the farthest detection, at least 1 km. */
  radius_km: number
  bbox: Bbox
  count: number
  frp_sum: number
  frp_max: number
  /** ISO timestamps of the first and last detection in the cluster. */
  first_seen: string
  last_seen: string
  by_source: Record<string, number>
  severity: Severity
}

export interface HotspotCollection {
  radius_km: number
  min_count: number
  /** Hotspots found before `limit` was applied. */
  total: number
  /** True when computed from a sample of detections, so counts are lower bounds. */
  approximate: boolean
  items: Hotspot[]
}

export interface Api {
  getMeta(signal?: AbortSignal): Promise<Meta>
  getDetections(q: DetectionsQuery, signal?: AbortSignal): Promise<DetectionCollection>
  getDetection(id: number, signal?: AbortSignal): Promise<DetectionDetail>
  getTimeseries(q: TimeseriesQuery, signal?: AbortSignal): Promise<Timeseries>
  /** Optional endpoint (P1): resolves to [] when the backend has no /areas yet. */
  getAreas(signal?: AbortSignal): Promise<Area[]>
  /** Optional endpoint (P2): resolves to null when the backend has no /detections/grid yet. */
  getGrid(q: GridQuery, signal?: AbortSignal): Promise<GridCell[] | null>
  /** Optional endpoint (P1): resolves to null when the backend has no /hotspots yet. */
  getHotspots(q: HotspotsQuery, signal?: AbortSignal): Promise<HotspotCollection | null>
}
