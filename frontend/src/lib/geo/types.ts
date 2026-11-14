import type { Bbox } from '../../api/types'

export type PlaceKind = 'country' | 'region' | 'city'

/** One searchable place: a country, a first-level region (state, oblast, province) or a city. */
export interface Place {
  /** Unique across kinds, e.g. "country:UA", "region:UA-56", "city:703448". */
  id: string
  kind: PlaceKind
  /** English name, e.g. "Rivne", "Texas", "Beijing". */
  name: string
  /** ISO 3166-1 alpha-2 of the country the place belongs to (its own code for a country). */
  countryCode: string
  /** English country name; equal to `name` for a country. */
  countryName: string
  /** Region the city is in, when known. */
  regionName?: string
  /** Area to show on the map. For a city: a box of roughly 50 km around it. */
  bbox: Bbox
  /** Representative point (capital, centroid or the city itself). */
  lat: number
  lon: number
}

/** [lon, lat] rings; first ring of each polygon is the outline, the rest are holes. */
export type MultiPolygon = [lon: number, lat: number][][][]

export interface NearestPlace {
  /** Nearest city. */
  city: string
  /** Region the city is in, when known. */
  region?: string
  countryCode: string
  countryName: string
  distanceKm: number
}
