import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiError, filtersToParams, httpApi } from './http'

const base = { date_from: '2026-08-01', date_to: '2026-08-07' }

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })
}

describe('filtersToParams', () => {
  it('serialises only the required dates when nothing else is set', () => {
    expect(filtersToParams(base).toString()).toBe('date_from=2026-08-01&date_to=2026-08-07')
  })
  it('writes bbox as west,south,east,north', () => {
    expect(filtersToParams({ ...base, bbox: [22, 44, 40, 52] }).get('bbox')).toBe('22,44,40,52')
  })
  it('rounds bbox to 4 decimals and drops trailing zeros', () => {
    expect(filtersToParams({ ...base, bbox: [22.123456, 44.1, 40.99999, -52.00004] }).get('bbox')).toBe('22.1235,44.1,41,-52')
  })
  it('passes an antimeridian bbox (west > east) through untouched', () => {
    expect(filtersToParams({ ...base, bbox: [170, -10, -170, 10] }).get('bbox')).toBe('170,-10,-170,10')
  })
  it('repeats the source parameter', () => {
    const p = filtersToParams({ ...base, source: ['MODIS_NRT', 'VIIRS_SNPP_NRT'] })
    expect(p.getAll('source')).toEqual(['MODIS_NRT', 'VIIRS_SNPP_NRT'])
    expect(p.toString()).toContain('source=MODIS_NRT&source=VIIRS_SNPP_NRT')
  })
  it('omits source when the list is empty', () => {
    expect(filtersToParams({ ...base, source: [] }).has('source')).toBe(false)
  })
  it('lets area_id take precedence over bbox', () => {
    const p = filtersToParams({ ...base, area_id: 3, bbox: [1, 2, 3, 4] })
    expect(p.get('area_id')).toBe('3')
    expect(p.has('bbox')).toBe(false)
  })
  it('keeps area_id 0 (not treated as missing)', () => {
    expect(filtersToParams({ ...base, area_id: 0 }).get('area_id')).toBe('0')
  })
  it('sets daynight and min_confidence when present', () => {
    const p = filtersToParams({ ...base, daynight: 'N', min_confidence: 'high' })
    expect(p.get('daynight')).toBe('N')
    expect(p.get('min_confidence')).toBe('high')
  })
  it('omits optional fields that are undefined', () => {
    const p = filtersToParams({ ...base, daynight: undefined, min_confidence: undefined, bbox: undefined })
    expect([...p.keys()]).toEqual(['date_from', 'date_to'])
  })
})

describe('httpApi', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => vi.unstubAllGlobals())

  const lastUrl = () => fetchMock.mock.calls.at(-1)![0] as string
  const lastInit = () => fetchMock.mock.calls.at(-1)![1] as RequestInit

  describe('URLs', () => {
    it('getMeta calls /api/meta without a query string', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ sources: [] }))
      await httpApi.getMeta()
      expect(lastUrl()).toBe('/api/meta')
    })
    it('sends an Accept: application/json header', async () => {
      fetchMock.mockResolvedValue(jsonResponse({}))
      await httpApi.getMeta()
      expect(lastInit().headers).toEqual({ Accept: 'application/json' })
    })
    it('getDetections serialises filters and limit', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ features: [] }))
      await httpApi.getDetections({ ...base, bbox: [1, 2, 3, 4], source: ['A', 'B'], daynight: 'D', min_confidence: 'nominal', limit: 500 })
      expect(lastUrl()).toBe(
        '/api/detections?date_from=2026-08-01&date_to=2026-08-07&bbox=1%2C2%2C3%2C4&source=A&source=B&daynight=D&min_confidence=nominal&limit=500',
      )
    })
    it('getDetections omits limit when not given', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ features: [] }))
      await httpApi.getDetections(base)
      expect(lastUrl()).not.toContain('limit')
    })
    it('getDetections keeps limit=0', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ features: [] }))
      await httpApi.getDetections({ ...base, limit: 0 })
      expect(lastUrl()).toContain('limit=0')
    })
    it('getDetection calls /api/detections/{id}', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 42 }))
      await httpApi.getDetection(42)
      expect(lastUrl()).toBe('/api/detections/42')
    })
    it('getTimeseries adds interval and optional group_by', async () => {
      fetchMock.mockImplementation(async () => jsonResponse({ interval: 'day', items: [] }))
      await httpApi.getTimeseries({ ...base, interval: 'month', group_by: 'source' })
      expect(lastUrl()).toBe('/api/stats/timeseries?date_from=2026-08-01&date_to=2026-08-07&interval=month&group_by=source')
      await httpApi.getTimeseries({ ...base, interval: 'year' })
      expect(lastUrl()).toBe('/api/stats/timeseries?date_from=2026-08-01&date_to=2026-08-07&interval=year')
    })
    it('getAreas calls /api/areas', async () => {
      fetchMock.mockResolvedValue(jsonResponse([]))
      await httpApi.getAreas()
      expect(lastUrl()).toBe('/api/areas')
    })
    it('getGrid adds the cell size and area_id instead of bbox', async () => {
      fetchMock.mockResolvedValue(jsonResponse([]))
      await httpApi.getGrid({ ...base, area_id: 2, bbox: [1, 2, 3, 4], cell: 0.25 })
      expect(lastUrl()).toBe('/api/detections/grid?date_from=2026-08-01&date_to=2026-08-07&area_id=2&cell=0.25')
    })
    it('getHotspots calls /api/hotspots with filters, radius_km, min_count and limit', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ items: [] }))
      await httpApi.getHotspots({ ...base, bbox: [170, -10, -170, 10], source: ['MODIS_NRT'], daynight: 'N', radius_km: 10, min_count: 5, limit: 50 })
      expect(lastUrl()).toBe(
        '/api/hotspots?date_from=2026-08-01&date_to=2026-08-07&bbox=170%2C-10%2C-170%2C10&source=MODIS_NRT&daynight=N&radius_km=10&min_count=5&limit=50',
      )
    })
    it('getHotspots omits unset tuning parameters and keeps limit=0', async () => {
      fetchMock.mockImplementation(async () => jsonResponse({ items: [] }))
      await httpApi.getHotspots(base)
      expect(lastUrl()).toBe('/api/hotspots?date_from=2026-08-01&date_to=2026-08-07')
      await httpApi.getHotspots({ ...base, limit: 0 })
      expect(lastUrl()).toBe('/api/hotspots?date_from=2026-08-01&date_to=2026-08-07&limit=0')
    })
    it('getHotspots passes the AbortSignal', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ items: [] }))
      const ctrl = new AbortController()
      await httpApi.getHotspots(base, ctrl.signal)
      expect(lastInit().signal).toBe(ctrl.signal)
    })
  })

  describe('responses and signals', () => {
    it('returns the parsed JSON body', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ id: 7, frp: 1.5 }))
      await expect(httpApi.getDetection(7)).resolves.toEqual({ id: 7, frp: 1.5 })
    })
    it('passes the AbortSignal to fetch', async () => {
      fetchMock.mockImplementation(async () => jsonResponse({}))
      const ctrl = new AbortController()
      await httpApi.getMeta(ctrl.signal)
      await httpApi.getDetections(base, ctrl.signal)
      await httpApi.getDetection(1, ctrl.signal)
      await httpApi.getTimeseries({ ...base, interval: 'day' }, ctrl.signal)
      await httpApi.getAreas(ctrl.signal)
      await httpApi.getGrid({ ...base, cell: 1 }, ctrl.signal)
      for (const call of fetchMock.mock.calls) expect((call[1] as RequestInit).signal).toBe(ctrl.signal)
      expect(fetchMock).toHaveBeenCalledTimes(6)
    })
    it('propagates an abort rejection from fetch', async () => {
      fetchMock.mockRejectedValue(new DOMException('Aborted', 'AbortError'))
      await expect(httpApi.getMeta()).rejects.toMatchObject({ name: 'AbortError' })
    })
    it('propagates a network failure (not wrapped in ApiError)', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
      const err = await httpApi.getMeta().catch((e: unknown) => e)
      expect(err).toBeInstanceOf(TypeError)
      expect(err).not.toBeInstanceOf(ApiError)
    })
  })

  describe('errors', () => {
    it('ApiError carries name, status and message', () => {
      const e = new ApiError(418, 'teapot')
      expect(e).toBeInstanceOf(Error)
      expect(e.name).toBe('ApiError')
      expect(e.status).toBe(418)
      expect(e.message).toBe('teapot')
    })
    it('uses a string FastAPI detail as the message', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'Detection not found' }, { status: 404 }))
      await expect(httpApi.getDetection(1)).rejects.toMatchObject({ status: 404, message: 'Detection not found', name: 'ApiError' })
    })
    it('JSON-stringifies an array detail (422 validation errors)', async () => {
      const detail = [{ loc: ['query', 'date_from'], msg: 'field required', type: 'value_error.missing' }]
      fetchMock.mockResolvedValue(jsonResponse({ detail }, { status: 422 }))
      const err = (await httpApi.getMeta().catch((e: unknown) => e)) as ApiError
      expect(err).toBeInstanceOf(ApiError)
      expect(err.status).toBe(422)
      expect(JSON.parse(err.message)).toEqual(detail)
    })
    it('falls back to statusText when the body is not JSON', async () => {
      fetchMock.mockResolvedValue(new Response('<html>Bad gateway</html>', { status: 502, statusText: 'Bad Gateway' }))
      await expect(httpApi.getMeta()).rejects.toMatchObject({ status: 502, message: 'Bad Gateway' })
    })
    it('falls back to statusText when JSON has no detail', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ error: 'x' }, { status: 500, statusText: 'Internal Server Error' }))
      await expect(httpApi.getMeta()).rejects.toMatchObject({ status: 500, message: 'Internal Server Error' })
    })
    it('falls back to statusText for an empty error body', async () => {
      fetchMock.mockResolvedValue(new Response('', { status: 503, statusText: 'Service Unavailable' }))
      await expect(httpApi.getMeta()).rejects.toMatchObject({ status: 503, message: 'Service Unavailable' })
    })
    it('does not crash on a JSON null error body', async () => {
      fetchMock.mockResolvedValue(new Response('null', { status: 500, statusText: 'Boom' }))
      await expect(httpApi.getMeta()).rejects.toMatchObject({ status: 500, message: 'Boom' })
    })
    it('rejects with a non-ApiError when a 200 body is not JSON', async () => {
      fetchMock.mockResolvedValue(new Response('<!doctype html>', { status: 200 }))
      await expect(httpApi.getMeta()).rejects.toBeInstanceOf(SyntaxError)
    })
  })

  describe('optional endpoints', () => {
    it.each([404, 405, 501])('getAreas resolves to [] on %d', async (status) => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'nope' }, { status }))
      await expect(httpApi.getAreas()).resolves.toEqual([])
    })
    it.each([404, 405, 501])('getGrid resolves to null on %d', async (status) => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'nope' }, { status }))
      await expect(httpApi.getGrid({ ...base, cell: 1 })).resolves.toBeNull()
    })
    it.each([404, 405, 501])('getHotspots resolves to null on %d', async (status) => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'nope' }, { status }))
      await expect(httpApi.getHotspots(base)).resolves.toBeNull()
    })
    it('getHotspots rethrows a 500', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'boom' }, { status: 500 }))
      await expect(httpApi.getHotspots(base)).rejects.toMatchObject({ name: 'ApiError', status: 500, message: 'boom' })
    })
    it('getHotspots rethrows a 422', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'bad radius' }, { status: 422 }))
      await expect(httpApi.getHotspots({ ...base, radius_km: -1 })).rejects.toMatchObject({ status: 422 })
    })
    it('getHotspots returns the collection on 200', async () => {
      const body = { radius_km: 10, min_count: 10, total: 0, approximate: false, items: [] }
      fetchMock.mockResolvedValue(jsonResponse(body))
      await expect(httpApi.getHotspots(base)).resolves.toEqual(body)
    })
    it('getAreas rethrows a 500', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'boom' }, { status: 500 }))
      await expect(httpApi.getAreas()).rejects.toMatchObject({ status: 500, message: 'boom' })
    })
    it('getGrid rethrows a 500', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'boom' }, { status: 500 }))
      await expect(httpApi.getGrid({ ...base, cell: 1 })).rejects.toMatchObject({ status: 500 })
    })
    it('getGrid rethrows a 422', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'bad cell' }, { status: 422 }))
      await expect(httpApi.getGrid({ ...base, cell: -1 })).rejects.toMatchObject({ status: 422 })
    })
    it('getAreas rethrows network errors', async () => {
      fetchMock.mockRejectedValue(new TypeError('offline'))
      await expect(httpApi.getAreas()).rejects.toBeInstanceOf(TypeError)
    })
    it('required endpoints do not swallow a 404', async () => {
      fetchMock.mockResolvedValue(jsonResponse({ detail: 'Not found' }, { status: 404 }))
      await expect(httpApi.getMeta()).rejects.toMatchObject({ status: 404 })
      await expect(httpApi.getTimeseries({ ...base, interval: 'day' })).rejects.toMatchObject({ status: 404 })
    })
    it('returns real data for the optional endpoints on 200', async () => {
      fetchMock.mockResolvedValueOnce(jsonResponse([{ id: 1, name: 'X', country_code: null, bbox: [0, 0, 1, 1] }]))
      await expect(httpApi.getAreas()).resolves.toHaveLength(1)
      fetchMock.mockResolvedValueOnce(jsonResponse([{ lat: 0.5, lon: 0.5, count: 1, frp_sum: 2 }]))
      await expect(httpApi.getGrid({ ...base, cell: 1 })).resolves.toHaveLength(1)
    })
  })
})
