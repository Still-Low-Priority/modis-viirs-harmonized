// Pure geometry helpers for the map (no Leaflet imports, easy to test).
import type { Bbox } from '../../api/types'

export const LAT_LIMIT = 85

const round = (x: number) => Math.round(x * 1e4) / 1e4

/** Wrap any longitude into [-180, 180). */
export function wrapLon(lon: number): number {
  return ((((lon + 180) % 360) + 360) % 360) - 180
}

/**
 * Leaflet bounds (longitudes may be outside [-180, 180] because of world copies)
 * -> API bbox. A view crossing the antimeridian yields west > east.
 */
export function boundsToBbox(west: number, south: number, east: number, north: number): Bbox {
  const s = round(Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, south)))
  const n = round(Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, north)))
  const span = east - west
  if (!(span < 360)) return [-180, s, 180, n]
  const w = wrapLon(west)
  let e = w + span
  if (e > 180) e -= 360
  return [round(w), s, round(e), n]
}

/** Bbox [w, s, e, n] -> Leaflet [[s, w], [n, e]], unwrapping antimeridian boxes. */
export function bboxToLatLngs([w, s, e, n]: Bbox): [[number, number], [number, number]] {
  return [
    [s, w],
    [n, e < w ? e + 360 : e],
  ]
}

/** Grid cell size (degrees) for a zoom level: coarser when zoomed out. */
export function cellForZoom(zoom: number): number {
  if (zoom <= 3) return 2
  if (zoom <= 4) return 1
  if (zoom <= 5) return 0.5
  if (zoom <= 6) return 0.25
  return 0.1
}

/** Point radius (px) for a zoom level. */
export function radiusForZoom(zoom: number): number {
  return Math.max(2, Math.min(7, 2 + 0.6 * (zoom - 2)))
}

/** Normalised intensity for grid cells (log scale), in [0, 1]. */
export function heatT(count: number, max: number): number {
  if (max <= 0 || count <= 0) return 0
  return Math.log1p(count) / Math.log1p(max)
}

/** '#rrggbb' -> darker '#rrggbb' (factor 0..1 keeps that share of brightness). */
export function darken(hex: string, factor: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const v = parseInt(m[1], 16)
  const ch = (shift: number) => Math.round(((v >> shift) & 255) * factor)
  return `#${((ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).padStart(6, '0')}`
}

/** Equatorial circumference of the Web Mercator sphere, in metres. */
const EARTH_CIRCUMFERENCE_M = 40_075_016.686

/** Ground metres covered by one screen pixel at `lat` and `zoom` (256 px tiles). */
export function metersPerPixel(lat: number, zoom: number): number {
  const clamped = Math.max(-LAT_LIMIT, Math.min(LAT_LIMIT, lat))
  return (EARTH_CIRCUMFERENCE_M * Math.cos((clamped * Math.PI) / 180)) / (256 * 2 ** zoom)
}

/**
 * Radius in metres for a hotspot ring: the real `radiusKm`, but never smaller
 * than `minPx` on screen, so the ring stays visible and clickable zoomed out.
 */
export function ringRadiusMeters(radiusKm: number, lat: number, zoom: number, minPx = 10): number {
  return Math.max(radiusKm * 1000, minPx * metersPerPixel(lat, zoom))
}

/** Radius of a ring on screen, in pixels. */
export function ringRadiusPx(radiusMeters: number, lat: number, zoom: number): number {
  return radiusMeters / metersPerPixel(lat, zoom)
}

export type LatLngTuple = [lat: number, lon: number]

/**
 * Bbox -> closed outline rings for Leaflet. A box crossing the antimeridian
 * (west > east) is unwrapped into one continuous ring east of the seam plus a
 * copy shifted by -360, so it is visible from both sides of the 180th meridian
 * without drawing a seam line.
 */
export function bboxOutlineRings([w, s, e, n]: Bbox): LatLngTuple[][] {
  const ring = (west: number, east: number): LatLngTuple[] => [
    [s, west],
    [n, west],
    [n, east],
    [s, east],
    [s, west],
  ]
  if (e >= w) return [ring(w, e)]
  return [ring(w, e + 360), ring(w - 360, e)]
}

const SEAM = 179.999

/** True when both points sit on the same side of the antimeridian seam. */
function onSeam(a: [number, number], b: [number, number]): boolean {
  return (a[0] >= SEAM && b[0] >= SEAM) || (a[0] <= -SEAM && b[0] <= -SEAM)
}

/**
 * MultiPolygon of [lon, lat] rings -> Leaflet polylines of [lat, lon]. Every
 * ring (outlines and holes) becomes one or more lines. Segments running along
 * the +-180 seam (where datasets cut countries such as Russia or Fiji) are
 * dropped, so the outline has no artificial vertical line at the antimeridian.
 */
export function multiPolygonToLines(polygon: [number, number][][][]): LatLngTuple[][] {
  const lines: LatLngTuple[][] = []
  for (const poly of polygon) {
    for (const ring of poly) {
      let line: LatLngTuple[] = []
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]
        if (i > 0 && onSeam(ring[i - 1], p)) {
          if (line.length > 1) lines.push(line)
          line = []
        }
        line.push([p[1], p[0]])
      }
      if (line.length > 1) lines.push(line)
    }
  }
  return lines
}
