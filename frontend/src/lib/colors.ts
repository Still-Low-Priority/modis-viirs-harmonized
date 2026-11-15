import type { Confidence, Severity } from '../api/types'

// One colour per sensor family, used on the map, in the legend and in charts.
const KNOWN_SOURCES: Record<string, { color: string; label: string }> = {
  MODIS_NRT: { color: '#ff5d3a', label: 'MODIS (Terra / Aqua)' },
  MODIS_SP: { color: '#ff5d3a', label: 'MODIS (Terra / Aqua)' },
  VIIRS_SNPP_NRT: { color: '#ffc531', label: 'VIIRS S-NPP' },
  VIIRS_SNPP_SP: { color: '#ffc531', label: 'VIIRS S-NPP' },
  VIIRS_NOAA20_NRT: { color: '#3fc1ff', label: 'VIIRS NOAA-20' },
  VIIRS_NOAA20_SP: { color: '#3fc1ff', label: 'VIIRS NOAA-20' },
  VIIRS_NOAA21_NRT: { color: '#b98bff', label: 'VIIRS NOAA-21' },
  VIIRS_NOAA21_SP: { color: '#b98bff', label: 'VIIRS NOAA-21' },
}

const FALLBACK = ['#5eead4', '#f472b6', '#a3e635', '#fb923c']

function hash(s: string): number {
  let h = 0
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h)
}

export function sourceColor(sourceProduct: string): string {
  return KNOWN_SOURCES[sourceProduct]?.color ?? FALLBACK[hash(sourceProduct) % FALLBACK.length]
}

export function sourceLabel(sourceProduct: string): string {
  return KNOWN_SOURCES[sourceProduct]?.label ?? sourceProduct.replaceAll('_', ' ')
}

export const CONFIDENCE_COLORS: Record<Confidence, string> = {
  low: '#7c8aa5',
  nominal: '#ffb020',
  high: '#ff3b30',
}

/** Hotspot severity, used for map rings and list badges. */
export const SEVERITY_COLORS: Record<Severity, string> = {
  critical: '#ff3b30',
  high: '#ff8a1f',
  elevated: '#ffd23f',
}

export const CONFIDENCE_ORDER: Confidence[] = ['low', 'nominal', 'high']

/** FRP ramp, low to high (MW). */
export const FRP_STOPS: { from: number; color: string }[] = [
  { from: 0, color: '#ffe08a' },
  { from: 5, color: '#ffb020' },
  { from: 20, color: '#ff7a1a' },
  { from: 50, color: '#ff3b30' },
  { from: 150, color: '#d0146b' },
]

export function frpColor(frp: number): string {
  let color = FRP_STOPS[0].color
  for (const stop of FRP_STOPS) if (frp >= stop.from) color = stop.color
  return color
}

/** Sequential ramp for heatmaps (calendar, grid): t in [0, 1]. */
export const HEAT_RAMP = ['#1b2433', '#4a2a2a', '#8a3324', '#c8501e', '#f28a1c', '#ffd23f']

export function heatColor(t: number): string {
  if (!(t > 0)) return HEAT_RAMP[0]
  const i = Math.min(HEAT_RAMP.length - 1, 1 + Math.floor(Math.min(t, 0.9999) * (HEAT_RAMP.length - 1)))
  return HEAT_RAMP[i]
}
