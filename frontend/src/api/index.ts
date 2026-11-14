import { httpApi } from './http'
import type { Api, Meta } from './types'

export type ApiMode = 'real' | 'mock'

export interface ResolvedApi {
  api: Api
  mode: ApiMode
}

/**
 * VITE_API_MODE:
 *   auto (default): use the real backend if GET /api/meta answers with a valid
 *                   body, otherwise fall back to built-in demo data.
 *   real:           always the backend.
 *   mock:           always demo data.
 */
const configured = (import.meta.env.VITE_API_MODE ?? 'auto') as 'auto' | 'real' | 'mock'

async function loadMock(): Promise<ResolvedApi> {
  const { mockApi } = await import('./mock')
  return { api: mockApi, mode: 'mock' }
}

async function backendIsReady(): Promise<boolean> {
  try {
    const meta = (await httpApi.getMeta(AbortSignal.timeout(4000))) as Partial<Meta>
    return Array.isArray(meta.sources)
  } catch {
    return false
  }
}

let resolved: Promise<ResolvedApi> | undefined

export function resolveApi(): Promise<ResolvedApi> {
  resolved ??= (async () => {
    if (configured === 'mock') return loadMock()
    if (configured === 'real') return { api: httpApi, mode: 'real' as const }
    return (await backendIsReady()) ? { api: httpApi, mode: 'real' as const } : loadMock()
  })()
  return resolved
}

export type * from './types'
export { ApiError } from './http'
