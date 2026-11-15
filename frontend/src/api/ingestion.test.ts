import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError } from './http'
import { FIRMS_PRODUCTS, firmsRequestCount, ingestionApi, isFinished, isNearRealTime, toIngestionBbox } from './ingestion'

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })
}

describe('toIngestionBbox', () => {
  it('keeps an ordinary box and rounds it to 0.01°', () => {
    expect(toIngestionBbox([22.123456, 44.1, 40.999, 52.004])).toEqual([22.12, 44.1, 41, 52])
  })
  it('clamps latitudes that run past the poles', () => {
    expect(toIngestionBbox([10, -95, 20, 97])).toEqual([10, -90, 20, 90])
  })
  it('turns a viewport at least one world wide into every longitude', () => {
    expect(toIngestionBbox([-250, -60, 250, 70])).toEqual([-180, -60, 180, 70])
    expect(toIngestionBbox([-180, -60, 180, 70])).toEqual([-180, -60, 180, 70])
  })
  it('wraps a view panned past the antimeridian into a crossing box (west > east)', () => {
    expect(toIngestionBbox([170, -10, 190, 10])).toEqual([170, -10, -170, 10])
    expect(toIngestionBbox([-190, -10, -170, 10])).toEqual([170, -10, -170, 10])
  })
  it('wraps a view that lies entirely in another copy of the world', () => {
    expect(toIngestionBbox([380, 0, 400, 10])).toEqual([20, 0, 40, 10])
  })
  it('lets a box end exactly on the antimeridian', () => {
    expect(toIngestionBbox([170, 0, 180, 10])).toEqual([170, 0, 180, 10])
  })
  it('rejects boxes the backend would refuse', () => {
    expect(toIngestionBbox([10, 5, 20, 5])).toBeNull()
    expect(toIngestionBbox([10, 95, 20, 99])).toBeNull()
    expect(toIngestionBbox([10, 0, 10.001, 5])).toBeNull()
    expect(toIngestionBbox([Number.NaN, 0, 10, 5])).toBeNull()
  })
})

describe('firmsRequestCount', () => {
  it('counts one request per started 5 days', () => {
    expect(firmsRequestCount([0, 0, 10, 10], 1)).toBe(1)
    expect(firmsRequestCount([0, 0, 10, 10], 5)).toBe(1)
    expect(firmsRequestCount([0, 0, 10, 10], 6)).toBe(2)
    expect(firmsRequestCount([0, 0, 10, 10], 31)).toBe(7)
  })
  it('doubles for a box that crosses the antimeridian', () => {
    expect(firmsRequestCount([170, 0, -170, 10], 6)).toBe(4)
  })
})

describe('product helpers', () => {
  it('lists the eight products the backend accepts', () => {
    expect(FIRMS_PRODUCTS).toHaveLength(8)
    expect(FIRMS_PRODUCTS.filter(isNearRealTime)).toHaveLength(4)
  })
  it('treats only SUCCESS, FAILURE and REVOKED as finished', () => {
    expect(['SUCCESS', 'FAILURE', 'REVOKED'].every(isFinished)).toBe(true)
    expect(['PENDING', 'STARTED', 'RETRY', ''].some(isFinished)).toBe(false)
  })
})

describe('ingestionApi', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const job = { source: 'MODIS_NRT', west: 30, south: 48, east: 32, north: 50, start_date: '2026-11-10', end_date: '2026-11-12' }

  it('posts the job as JSON to /api/ingestion/jobs', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ task_id: 'abc', status: 'PENDING' }, { status: 202 }))
    await expect(ingestionApi.createJob(job)).resolves.toEqual({ task_id: 'abc', status: 'PENDING' })
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toBe('/api/ingestion/jobs')
    expect(init.method).toBe('POST')
    expect(init.headers).toMatchObject({ 'Content-Type': 'application/json' })
    expect(JSON.parse(init.body as string)).toEqual(job)
  })

  it('reports the first validation message of a 422', async () => {
    fetchMock.mockResolvedValue(
      jsonResponse({ detail: [{ loc: ['body'], msg: 'Value error, South must be less than north.', type: 'value_error' }] }, { status: 422 }),
    )
    const error = await ingestionApi.createJob(job).catch((e: unknown) => e)
    expect(error).toBeInstanceOf(ApiError)
    expect((error as ApiError).status).toBe(422)
    expect((error as ApiError).message).toBe('Value error, South must be less than north.')
  })

  it('reports a 503 with the backend text', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ detail: 'Task queue is currently unavailable.' }, { status: 503 }))
    await expect(ingestionApi.createJob(job)).rejects.toMatchObject({ status: 503, message: 'Task queue is currently unavailable.' })
  })

  it('reads a job by id and the health endpoint with GET', async () => {
    fetchMock.mockResolvedValue(jsonResponse({ task_id: 'a/b', status: 'STARTED', result: null, error: null }))
    await ingestionApi.getJob('a/b')
    expect(fetchMock.mock.calls[0][0]).toBe('/api/ingestion/jobs/a%2Fb')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBeUndefined()

    fetchMock.mockResolvedValue(jsonResponse({ status: 'ok' }))
    await expect(ingestionApi.getHealth()).resolves.toEqual({ status: 'ok' })
    expect(fetchMock.mock.calls[1][0]).toBe('/api/health')
  })
})
