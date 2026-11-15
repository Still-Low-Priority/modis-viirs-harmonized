import { beforeEach, describe, expect, it } from 'vitest'
import { JOBS_KEY, MAX_JOBS, RESULT_TTL_MS, clearJobs, isExpired, pushJob, readJobs, type StoredJob } from './jobs'

const job = (taskId: string, submittedAt = '2026-11-15T10:00:00.000Z'): StoredJob => ({
  taskId,
  source: 'MODIS_NRT',
  bbox: [30, 48, 32, 50],
  startDate: '2026-11-10',
  endDate: '2026-11-12',
  place: null,
  submittedAt,
})

beforeEach(() => localStorage.clear())

describe('ingestion job list', () => {
  it('is empty when nothing was stored', () => {
    expect(readJobs()).toEqual([])
  })
  it('puts the newest job first and persists it', () => {
    pushJob(job('a'))
    expect(pushJob(job('b')).map((j) => j.taskId)).toEqual(['b', 'a'])
    expect(readJobs().map((j) => j.taskId)).toEqual(['b', 'a'])
  })
  it('keeps one entry per task id', () => {
    pushJob(job('a'))
    pushJob(job('b'))
    expect(pushJob(job('a')).map((j) => j.taskId)).toEqual(['a', 'b'])
  })
  it(`keeps at most ${MAX_JOBS} jobs`, () => {
    for (let i = 0; i < MAX_JOBS + 3; i++) pushJob(job(`t${i}`))
    const stored = readJobs()
    expect(stored).toHaveLength(MAX_JOBS)
    expect(stored[0].taskId).toBe(`t${MAX_JOBS + 2}`)
  })
  it('ignores damaged storage and malformed entries', () => {
    localStorage.setItem(JOBS_KEY, '{not json')
    expect(readJobs()).toEqual([])
    localStorage.setItem(JOBS_KEY, JSON.stringify([job('ok'), { taskId: 1 }, null, { ...job('x'), bbox: [1, 2, 3] }]))
    expect(readJobs().map((j) => j.taskId)).toEqual(['ok'])
  })
  it('clears the list', () => {
    pushJob(job('a'))
    expect(clearJobs()).toEqual([])
    expect(readJobs()).toEqual([])
  })
  it('expires a job once the backend has forgotten its result', () => {
    const at = Date.parse('2026-11-15T10:00:00.000Z')
    expect(isExpired(job('a'), at + RESULT_TTL_MS - 1)).toBe(false)
    expect(isExpired(job('a'), at + RESULT_TTL_MS + 1)).toBe(true)
    expect(isExpired(job('a', 'garbage'), at)).toBe(true)
  })
})
