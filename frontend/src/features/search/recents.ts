import type { Place } from '../../lib/geo'

export const RECENTS_KEY = 'mvh.recentPlaces'
export const MAX_RECENTS = 5

function isPlace(v: unknown): v is Place {
  if (typeof v !== 'object' || v === null) return false
  const p = v as Record<string, unknown>
  return (
    typeof p.id === 'string' &&
    typeof p.name === 'string' &&
    (p.kind === 'country' || p.kind === 'region' || p.kind === 'city') &&
    typeof p.countryName === 'string' &&
    typeof p.bbox === 'object' &&
    p.bbox !== null
  )
}

export function readRecents(): Place[] {
  try {
    const raw = localStorage.getItem(RECENTS_KEY)
    if (!raw) return []
    const data: unknown = JSON.parse(raw)
    return Array.isArray(data) ? data.filter(isPlace).slice(0, MAX_RECENTS) : []
  } catch {
    return []
  }
}

/** Puts the place first, drops duplicates, persists, and returns the new list. */
export function pushRecent(place: Place): Place[] {
  const next = [place, ...readRecents().filter((p) => p.id !== place.id)].slice(0, MAX_RECENTS)
  try {
    localStorage.setItem(RECENTS_KEY, JSON.stringify(next))
  } catch {
    // Storage may be full or disabled; recents are a convenience only.
  }
  return next
}
