import type { Bbox } from '../../api/types'

// The backend has no "list my jobs" endpoint, so the browser remembers the
// task ids it was given. Other browsers (and other people) do not see them.

export const JOBS_KEY = 'mvh.ingestionJobs'
export const MAX_JOBS = 10

/** Celery keeps a task result for a day; after that an id reads as PENDING again. */
export const RESULT_TTL_MS = 24 * 60 * 60 * 1000

export interface StoredJob {
  taskId: string
  source: string
  bbox: Bbox
  startDate: string
  endDate: string
  /** Name of the searched place, or null when the job used the map view. */
  place: string | null
  /** ISO timestamp of the moment the job was accepted. */
  submittedAt: string
}

function isJob(v: unknown): v is StoredJob {
  if (typeof v !== 'object' || v === null) return false
  const j = v as Record<string, unknown>
  return (
    typeof j.taskId === 'string' &&
    typeof j.source === 'string' &&
    Array.isArray(j.bbox) &&
    j.bbox.length === 4 &&
    j.bbox.every((n) => typeof n === 'number') &&
    typeof j.startDate === 'string' &&
    typeof j.endDate === 'string' &&
    (j.place === null || typeof j.place === 'string') &&
    typeof j.submittedAt === 'string'
  )
}

export function readJobs(): StoredJob[] {
  try {
    const raw = localStorage.getItem(JOBS_KEY)
    if (!raw) return []
    const data: unknown = JSON.parse(raw)
    return Array.isArray(data) ? data.filter(isJob).slice(0, MAX_JOBS) : []
  } catch {
    return []
  }
}

function write(jobs: StoredJob[]): StoredJob[] {
  try {
    localStorage.setItem(JOBS_KEY, JSON.stringify(jobs))
  } catch {
    // Storage may be full or disabled; the list then lives until reload.
  }
  return jobs
}

/** Newest first; returns the new list. */
export function pushJob(job: StoredJob): StoredJob[] {
  return write([job, ...readJobs().filter((j) => j.taskId !== job.taskId)].slice(0, MAX_JOBS))
}

export function clearJobs(): StoredJob[] {
  return write([])
}

/** True once the backend can no longer tell this job from an unknown id. */
export function isExpired(job: StoredJob, now = Date.now()): boolean {
  const at = Date.parse(job.submittedAt)
  return Number.isNaN(at) || now - at > RESULT_TTL_MS
}
