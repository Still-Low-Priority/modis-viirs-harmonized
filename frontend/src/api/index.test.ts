import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const validMeta = { sources: [{ source_product: 'MODIS_NRT', instrument: 'MODIS', satellites: ['Terra'] }], date_min: null, date_max: null, last_ingested_at: null }

async function load(mode?: string) {
  vi.resetModules()
  if (mode !== undefined) vi.stubEnv('VITE_API_MODE', mode)
  return import('./index')
}

const json = (body: unknown, init: ResponseInit = {}) =>
  new Response(JSON.stringify(body), { status: 200, headers: { 'Content-Type': 'application/json' }, ...init })

describe('resolveApi', () => {
  const fetchMock = vi.fn()
  beforeEach(() => {
    fetchMock.mockReset()
    vi.stubGlobal('fetch', fetchMock)
  })
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.unstubAllEnvs()
    vi.useRealTimers()
  })

  describe('auto mode', () => {
    it('picks the real client when /api/meta returns a valid body', async () => {
      fetchMock.mockResolvedValue(json(validMeta))
      const { resolveApi } = await load('auto')
      const r = await resolveApi()
      expect(r.mode).toBe('real')
      expect(fetchMock).toHaveBeenCalledWith('/api/meta', expect.anything())
    })
    it('is the default when VITE_API_MODE is unset', async () => {
      fetchMock.mockResolvedValue(json(validMeta))
      vi.stubEnv('VITE_API_MODE', undefined as unknown as string)
      vi.resetModules()
      const { resolveApi } = await import('./index')
      expect((await resolveApi()).mode).toBe('real')
    })
    it('accepts an empty sources array as a valid backend', async () => {
      fetchMock.mockResolvedValue(json({ ...validMeta, sources: [] }))
      expect((await (await load('auto')).resolveApi()).mode).toBe('real')
    })
    it('falls back to mock when /api/meta is 404', async () => {
      fetchMock.mockResolvedValue(json({ detail: 'Not Found' }, { status: 404 }))
      expect((await (await load('auto')).resolveApi()).mode).toBe('mock')
    })
    it('falls back to mock on a 500', async () => {
      fetchMock.mockResolvedValue(json({ detail: 'x' }, { status: 500 }))
      expect((await (await load('auto')).resolveApi()).mode).toBe('mock')
    })
    it('does not mistake the SPA fallback (index.html with 200) for a backend', async () => {
      fetchMock.mockResolvedValue(new Response('<!doctype html><html><body>app</body></html>', { status: 200, headers: { 'Content-Type': 'text/html' } }))
      expect((await (await load('auto')).resolveApi()).mode).toBe('mock')
    })
    it('falls back to mock when the JSON body has no sources array', async () => {
      fetchMock.mockResolvedValue(json({ hello: 'world' }))
      expect((await (await load('auto')).resolveApi()).mode).toBe('mock')
    })
    it('falls back to mock when sources is not an array', async () => {
      fetchMock.mockResolvedValue(json({ sources: 'MODIS' }))
      expect((await (await load('auto')).resolveApi()).mode).toBe('mock')
    })
    it('falls back to mock when the body is JSON null', async () => {
      fetchMock.mockResolvedValue(json(null))
      expect((await (await load('auto')).resolveApi()).mode).toBe('mock')
    })
    it('falls back to mock when the network fails', async () => {
      fetchMock.mockRejectedValue(new TypeError('Failed to fetch'))
      expect((await (await load('auto')).resolveApi()).mode).toBe('mock')
    })
    it('falls back to mock when the probe times out', async () => {
      vi.useFakeTimers()
      // fetch that never resolves but honours the abort signal, like the real one.
      fetchMock.mockImplementation(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener('abort', () => reject(init.signal!.reason))
          }),
      )
      const { resolveApi } = await load('auto')
      const p = resolveApi()
      await vi.advanceTimersByTimeAsync(4001)
      expect((await p).mode).toBe('mock')
    })
    it('gives the probe an AbortSignal', async () => {
      fetchMock.mockResolvedValue(json(validMeta))
      await (await load('auto')).resolveApi()
      expect((fetchMock.mock.calls[0][1] as RequestInit).signal).toBeInstanceOf(AbortSignal)
    })
    it('caches the result and probes only once', async () => {
      fetchMock.mockResolvedValue(json(validMeta))
      const { resolveApi } = await load('auto')
      const a = resolveApi()
      const b = resolveApi()
      expect(a).toBe(b)
      await a
      await resolveApi()
      expect(fetchMock).toHaveBeenCalledTimes(1)
    })
    it('keeps the cached mock even if the backend appears later', async () => {
      fetchMock.mockResolvedValueOnce(json({}, { status: 404 }))
      const { resolveApi } = await load('auto')
      expect((await resolveApi()).mode).toBe('mock')
      fetchMock.mockResolvedValue(json(validMeta))
      expect((await resolveApi()).mode).toBe('mock')
    })
  })

  describe('forced modes', () => {
    it('mock mode never calls fetch and returns the demo api', async () => {
      const { resolveApi } = await load('mock')
      const r = await resolveApi()
      expect(r.mode).toBe('mock')
      expect(typeof r.api.getDetections).toBe('function')
      expect(fetchMock).not.toHaveBeenCalled()
    })
    it('real mode never probes and returns the http client', async () => {
      const { resolveApi } = await load('real')
      const r = await resolveApi()
      expect(r.mode).toBe('real')
      expect(fetchMock).not.toHaveBeenCalled()
      const { httpApi } = await import('./http')
      expect(r.api).toBe(httpApi)
    })
    it('real mode stays real even though the backend is down', async () => {
      fetchMock.mockRejectedValue(new TypeError('down'))
      expect((await (await load('real')).resolveApi()).mode).toBe('real')
    })
  })
})
