import type { Lang } from '../i18n'
import { parseDay } from './dates'

// One locale today; the parameter keeps call sites ready for more.
const locale = (_lang: Lang) => 'en-GB'

export function formatNumber(n: number, lang: Lang, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(locale(lang), { maximumFractionDigits }).format(n)
}

/** 12 400 -> "12.4k" */
export function formatCompact(n: number, lang: Lang): string {
  return new Intl.NumberFormat(locale(lang), { notation: 'compact', maximumFractionDigits: 1 }).format(n)
}

/** "2026-08-15" -> "15 Aug 2026" */
export function formatDay(day: string, lang: Lang, opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' }): string {
  return new Intl.DateTimeFormat(locale(lang), { ...opts, timeZone: 'UTC' }).format(parseDay(day))
}

/** ISO timestamp -> "15 Aug 2026, 11:20 UTC" */
export function formatDateTimeUtc(iso: string, lang: Lang): string {
  const s = new Intl.DateTimeFormat(locale(lang), {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
    timeZone: 'UTC',
  }).format(new Date(iso))
  return `${s} UTC`
}

export function formatCoord(lat: number, lon: number): string {
  // Round first so -0.00001 prints as 0.0000°N, not 0.0000°S.
  const la = +lat.toFixed(4) || 0
  const lo = +lon.toFixed(4) || 0
  return `${Math.abs(la).toFixed(4)}°${la >= 0 ? 'N' : 'S'}, ${Math.abs(lo).toFixed(4)}°${lo >= 0 ? 'E' : 'W'}`
}

/** FRP is fire radiative power in megawatts. */
export function formatFrp(frp: number, lang: Lang): string {
  return `${formatNumber(frp, lang, 1)} MW`
}
