// Pure helpers for the hotspots panel: labels, fly-to box, sorting.

import type { Bbox, Hotspot, Severity } from '../../api/types'
import type { NearestPlace } from '../../lib/geo/types'
import { fmt, plural } from '../../i18n'
import { formatDay, formatNumber } from '../../lib/format'
import { SEVERITY_ORDER } from '../../lib/hotspots'
import type { HotspotsMessages } from './messages'

/** Beyond this distance a place reads "{n} km from {city}" instead of "near {city}". */
export const NEAR_KM = 60

export type HotspotSort = 'severity' | 'count' | 'frp' | 'recent'

export const SORTS: HotspotSort[] = ['severity', 'count', 'frp', 'recent']

export interface RankedHotspot {
  /** 1-based position in the default (severity) order; the map draws the same number. */
  rank: number
  hotspot: Hotspot
}

/** Scope of the list: which parts of a place name are redundant. */
export interface LabelScope {
  /** Country code of the selected place when it is a country; otherwise null. */
  countryCode: string | null
}

/** "near Rakhiv, Zakarpattia" / "84 km from Rakhiv, Zakarpattia, Ukraine"; null when unknown. */
export function placeLabel(
  place: NearestPlace | null | undefined,
  scope: LabelScope,
  t: Pick<HotspotsMessages, 'near' | 'kmFrom'>,
): string | null {
  if (!place) return null
  const parts = [place.city]
  if (place.region && place.region !== place.city) parts.push(place.region)
  if (scope.countryCode == null || scope.countryCode !== place.countryCode) parts.push(place.countryName)
  const name = parts.join(', ')
  if (place.distanceKm > NEAR_KM) return fmt(t.kmFrom, { km: Math.round(place.distanceKm), place: name })
  return fmt(t.near, { place: name })
}

/** Key for caching nearest-place lookups: about 1 km of precision. */
export function coordKey(lat: number, lon: number): [number, number] {
  return [+lat.toFixed(2), +lon.toFixed(2)]
}

const wrapLon = (v: number) => ((((v + 180) % 360) + 360) % 360) - 180

/**
 * The hotspot's bbox grown by about 50 % (a quarter of its size on each side,
 * at least 0.1 degrees per side), so the whole cluster is visible with context.
 * Keeps the antimeridian convention: west > east means the box crosses it.
 */
export function flyToBbox(h: Pick<Hotspot, 'bbox'>, grow = 0.5, minMarginDeg = 0.1): Bbox {
  const [west, south, east, north] = h.bbox
  const width = west > east ? east + 360 - west : east - west
  const height = north - south
  const mx = Math.max((width * grow) / 2, minMarginDeg)
  const my = Math.max((height * grow) / 2, minMarginDeg)
  const s = Math.max(-90, south - my)
  const n = Math.min(90, north + my)
  if (width + 2 * mx >= 360) return [-180, s, 180, n]
  const w = +wrapLon(west - mx).toFixed(4)
  const e = +wrapLon(east + mx).toFixed(4)
  // wrapLon maps +180 to -180; an east edge exactly on the antimeridian is +180.
  return [w, +s.toFixed(4), e === -180 ? 180 : e, +n.toFixed(4)]
}

const MS_DAY = 86_400_000

/** Calendar days (UTC) between first and last detection, inclusive. */
export function activeDays(firstSeen: string, lastSeen: string): number {
  const a = Math.floor(Date.parse(firstSeen) / MS_DAY)
  const b = Math.floor(Date.parse(lastSeen) / MS_DAY)
  return Math.max(1, b - a + 1)
}

/** "3 days, last seen 13 Nov" */
export function activeDaysText(h: Pick<Hotspot, 'first_seen' | 'last_seen'>, t: Pick<HotspotsMessages, 'activeDays' | 'day'>): string {
  const n = activeDays(h.first_seen, h.last_seen)
  const day = formatDay(h.last_seen.slice(0, 10), 'en', { day: 'numeric', month: 'short' })
  return fmt(t.activeDays, { n, word: plural(n, t.day), day })
}

/** "7 - 13 Nov 2026", "28 Oct - 3 Nov 2026", "28 Dec 2025 - 3 Jan 2026", "13 Nov 2026". */
export function periodText(from: string, to: string): string {
  if (from === to) return formatDay(from, 'en')
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7)
  const start = sameMonth
    ? formatDay(from, 'en', { day: 'numeric' })
    : sameYear
      ? formatDay(from, 'en', { day: 'numeric', month: 'short' })
      : formatDay(from, 'en')
  return `${start} - ${formatDay(to, 'en')}`
}

/** Numbered in the received (severity) order, then reordered by `sort`. Stable. */
export function sortHotspots(items: Hotspot[], sort: HotspotSort): RankedHotspot[] {
  const ranked = items.map((hotspot, i) => ({ rank: i + 1, hotspot }))
  if (sort === 'severity') return ranked
  const key: Record<Exclude<HotspotSort, 'severity'>, (h: Hotspot) => number> = {
    count: (h) => h.count,
    frp: (h) => h.frp_sum,
    recent: (h) => Date.parse(h.last_seen),
  }
  const k = key[sort]
  return [...ranked].sort((a, b) => k(b.hotspot) - k(a.hotspot) || a.rank - b.rank)
}

export function severityTotals(items: Hotspot[]): Record<Severity, number> {
  const totals = Object.fromEntries(SEVERITY_ORDER.map((s) => [s, 0])) as Record<Severity, number>
  for (const h of items) totals[h.severity]++
  return totals
}

export interface SourceShare {
  source: string
  count: number
  share: number
}

/** Sensor split, largest first. */
export function sourceShares(bySource: Record<string, number>): SourceShare[] {
  const entries = Object.entries(bySource).filter(([, n]) => n > 0)
  const total = entries.reduce((s, [, n]) => s + n, 0)
  if (!total) return []
  return entries
    .map(([source, count]) => ({ source, count, share: count / total }))
    .sort((a, b) => b.count - a.count || a.source.localeCompare(b.source))
}

/** "about 24 km across"; diameter rounded to whole km (one decimal under 10 km). */
export function extentText(radiusKm: number, t: Pick<HotspotsMessages, 'across'>): string {
  const d = radiusKm * 2
  return fmt(t.across, { km: formatNumber(d, 'en', d < 10 ? 1 : 0) })
}
