import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/http'
import type { Api, DetectionDetail, Hotspot, HotspotCollection } from '../../api/types'
import { useStore } from '../../state/store'
import { DetectionDrawer } from './DetectionDrawer'

const base: DetectionDetail = {
  id: 7,
  latitude: 49.1,
  longitude: 31.2,
  acquired_at: '2026-08-15T11:20:00Z',
  source_product: 'VIIRS_SNPP_NRT',
  satellite: 'N',
  instrument: 'VIIRS',
  confidence: 'high',
  confidence_raw: 'h',
  detection_type: 0,
  frp: 12.5,
  brightness: null,
  bright_t31: null,
  bright_ti4: 340.2,
  bright_ti5: 300.1,
  scan: 0.4,
  track: 0.4,
  daynight: 'D',
  version: '2.0NRT',
}
const modis: DetectionDetail = {
  ...base,
  source_product: 'MODIS_NRT',
  instrument: 'MODIS',
  confidence_raw: '85',
  brightness: 330.5,
  bright_t31: 295.4,
  bright_ti4: null,
  bright_ti5: null,
}

let hotspots: HotspotCollection | null = null

function renderDrawer(getDetection: Api['getDetection']) {
  const api = { getDetection, getHotspots: () => Promise.resolve(hotspots) } as unknown as Api
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <ApiProvider api={api} mode="mock">
        <DetectionDrawer />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

const initial = useStore.getState()
const spot = (id: string, lat: number, lon: number, radius_km: number, severity: Hotspot['severity']): Hotspot => ({
  id,
  lat,
  lon,
  radius_km,
  bbox: [lon - 0.1, lat - 0.1, lon + 0.1, lat + 0.1],
  count: 50,
  frp_sum: 900,
  frp_max: 80,
  first_seen: '2026-08-14T00:00:00Z',
  last_seen: '2026-08-15T00:00:00Z',
  by_source: {},
  severity,
})
const collection = (items: Hotspot[]): HotspotCollection => ({ radius_km: 10, min_count: 10, total: items.length, approximate: false, items })

beforeEach(() => {
  useStore.setState({ ...initial, viewBbox: [0, 0, 60, 60] }, true)
  hotspots = null
})
afterEach(cleanup)

describe('DetectionDrawer', () => {
  it('renders nothing when nothing is selected', () => {
    const { container } = renderDrawer(() => Promise.resolve(base))
    expect(container).toBeEmptyDOMElement()
  })

  it('shows VIIRS brightness rows only', async () => {
    useStore.setState({ selectedId: 7 })
    renderDrawer(() => Promise.resolve(base))
    expect(await screen.findByText('Brightness I-4')).toBeInTheDocument()
    expect(screen.getByText('Brightness I-5')).toBeInTheDocument()
    expect(screen.queryByText('Brightness T31')).not.toBeInTheDocument()
    expect(screen.getByText(/letter/)).toBeInTheDocument()
  })

  it('shows MODIS brightness rows only', async () => {
    useStore.setState({ selectedId: 7 })
    renderDrawer(() => Promise.resolve(modis))
    expect(await screen.findByText('Brightness T31')).toBeInTheDocument()
    expect(screen.getByText('Brightness (ch. 21/22)')).toBeInTheDocument()
    expect(screen.queryByText('Brightness I-4')).not.toBeInTheDocument()
    expect(screen.getByText('85%')).toBeInTheDocument()
  })

  it('closes on Esc and on the close button', async () => {
    useStore.setState({ selectedId: 7 })
    renderDrawer(() => Promise.resolve(base))
    await screen.findByText('Brightness I-4')
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(useStore.getState().selectedId).toBeNull()

    useStore.setState({ selectedId: 7 })
    fireEvent.click(await screen.findByRole('button', { name: 'Back to map' }))
    expect(useStore.getState().selectedId).toBeNull()
  })

  it('shows a calm message on 404', async () => {
    useStore.setState({ selectedId: 99 })
    renderDrawer(() => Promise.reject(new ApiError(404, 'nope')))
    expect(await screen.findByText('Details are not available for this detection.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('offers retry on other errors', async () => {
    useStore.setState({ selectedId: 99 })
    renderDrawer(() => Promise.reject(new ApiError(500, 'boom')))
    expect(await screen.findByRole('button', { name: 'Try again' })).toBeInTheDocument()
  })

  it('omits the hotspot row when the detection is in no hotspot', async () => {
    useStore.setState({ selectedId: 7 })
    hotspots = collection([spot('far', 10, 10, 5, 'high')])
    renderDrawer(() => Promise.resolve(base))
    await screen.findByText('Brightness I-4')
    expect(screen.queryByText('Part of hotspot')).not.toBeInTheDocument()
  })

  it('shows the containing hotspot and jumps to it', async () => {
    useStore.setState({ selectedId: 7, sidebarTab: 'filters' })
    hotspots = collection([spot('far', 10, 10, 5, 'high'), spot('near', 49.12, 31.2, 5, 'critical')])
    renderDrawer(() => Promise.resolve(base))
    expect(await screen.findByText('Part of hotspot')).toBeInTheDocument()
    expect(screen.getByText('No. 2')).toBeInTheDocument()
    expect(screen.getByText('Critical')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Show hotspot' }))
    expect(useStore.getState().selectedHotspotId).toBe('near')
    expect(useStore.getState().sidebarTab).toBe('hotspots')
  })

  it('prefers the highlighted hotspot even when the point is outside it', async () => {
    useStore.setState({ selectedId: 7, selectedHotspotId: 'far' })
    hotspots = collection([spot('far', 10, 10, 5, 'high')])
    renderDrawer(() => Promise.resolve(base))
    expect(await screen.findByText('No. 1')).toBeInTheDocument()
    expect(screen.getByText('High', { selector: '.details-sev' })).toBeInTheDocument()
  })
})
