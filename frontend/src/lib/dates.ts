// Day arithmetic in UTC. A "day" is always a YYYY-MM-DD string.

const MS_DAY = 86_400_000

export function toDay(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function parseDay(day: string): Date {
  return new Date(`${day}T00:00:00Z`)
}

/** Days since 1970-01-01. */
export function dayIndex(day: string): number {
  return Math.floor(parseDay(day).getTime() / MS_DAY)
}

export function dayFromIndex(idx: number): string {
  return toDay(new Date(idx * MS_DAY))
}

export function addDays(day: string, n: number): string {
  return dayFromIndex(dayIndex(day) + n)
}

export function todayUtc(): string {
  return toDay(new Date())
}

/** Inclusive number of days in [from, to]. */
export function daysBetween(from: string, to: string): number {
  return dayIndex(to) - dayIndex(from) + 1
}

export function eachDay(from: string, to: string): string[] {
  const out: string[] = []
  for (let i = dayIndex(from), end = dayIndex(to); i <= end; i++) out.push(dayFromIndex(i))
  return out
}

export function clampDay(day: string, min: string, max: string): string {
  return day < min ? min : day > max ? max : day
}

export function isValidDay(day: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return false
  const d = parseDay(day)
  // Date rolls 2026-02-30 over to March; a real day survives the round trip.
  return !Number.isNaN(d.getTime()) && toDay(d) === day
}
