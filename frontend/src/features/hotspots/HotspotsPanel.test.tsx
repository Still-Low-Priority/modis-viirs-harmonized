import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { Api, Hotspot, HotspotCollection } from '../../api/types'
import type { Place } from '../../lib/geo/types'
import { useStore } from '../../state/store'
import { HotspotsPanel } from './HotspotsPanel'

vi.mock('../../lib/geo', () => ({
  nearestPlace: vi.fn(async (lat: number) =>
    lat > 48
      ? { city: 'Rakhiv', region: 'Zakarpattia', countryCode: 'UA', countryName: 'Ukraine', distanceKm: 3 }
      : null,
  ),
  loadCountryPolygon: vi.fn(async () => [[[[0, 0], [1, 0], [1, 1], [0, 0]]]]),
  pointInPolygon: vi.fn(() => true),
}))

function hs(over: Partial<Hotspot>): Hotspot {
  return {
    id: 'x',
    lat: 48.05,
    lon: 24.2,
    radius_km: 12,
    bbox: [24, 48, 24.4, 48.1],
    count: 132,
    frp_sum: 2400,
    frp_max: 80,
    first_seen: '2026-11-11T10:00:00Z',
    last_seen: '2026-11-13T01:00:00Z',
    by_source: { VIIRS_SNPP_NRT: 100, MODIS_NRT: 32 },
    severity: 'critical',
    ...over,
  }
}

const ITEMS = [
  hs({ id: 'h1' }),
  hs({ id: 'h2', lat: 46.5, lon: 30.7, count: 45, frp_sum: 300, severity: 'high', bbox: [30.6, 46.4, 30.8, 46.6], first_seen: '2026-11-13T02:00:00Z', last_seen: '2026-11-13T09:00:00Z' }),
]

function collection(over: Partial<HotspotCollection> = {}): HotspotCollection {
  return { radius_km: 10, min_count: 10, total: ITEMS.length, approximate: false, items: ITEMS, ...over }
}

function fakeApi(getHotspots: Api['getHotspots']): Api {
  return {
    getMeta: async () => ({ sources: [], date_min: null, date_max: null, last_ingested_at: null }),
    getDetections: async () => ({ type: 'FeatureCollection', total: 0, truncated: false, features: [] }),
    getDetection: async () => {
      throw new Error('not used')
    },
    getTimeseries: async () => ({ interval: 'day', items: [] }),
    getAreas: async () => [],
    getGrid: async () => null,
    getHotspots,
  }
}

function renderPanel(data: HotspotCollection = collection()) {
  const getHotspots = vi.fn(async () => data)
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ApiProvider api={fakeApi(getHotspots)} mode="mock">
        <HotspotsPanel />
      </ApiProvider>
    </QueryClientProvider>,
  )
  return { getHotspots }
}

const ukraine: Place = {
  id: 'country:UA',
  kind: 'country',
  name: 'Ukraine',
  countryCode: 'UA',
  countryName: 'Ukraine',
  bbox: [22, 44, 40, 52.5],
  lat: 49,
  lon: 31,
}

const initial = useStore.getState()

beforeEach(() => {
  useStore.setState(
    {
      ...initial,
      dateFrom: '2026-11-07',
      dateTo: '2026-11-13',
      viewBbox: [20, 40, 40, 55],
      region: null,
      flyTo: null,
      selectedHotspotId: null,
      showHotspots: true,
    },
    true,
  )
})
afterEach(cleanup)

describe('HotspotsPanel', () => {
  it('renders the ranked rows in order with place labels', async () => {
    renderPanel()
    const list = await screen.findByRole('list', { name: /strongest first/i })
    const rows = within(list).getAllByRole('button')
    expect(rows).toHaveLength(2)
    expect(rows[0]).toHaveTextContent('1')
    expect(rows[0]).toHaveTextContent('critical')
    await waitFor(() => expect(rows[0]).toHaveTextContent('near Rakhiv, Zakarpattia, Ukraine'))
    expect(rows[0]).toHaveTextContent('132 detections')
    expect(rows[0]).toHaveTextContent('about 24 km across')
    expect(rows[0]).toHaveTextContent('3 days, last seen 13 Nov')
    // Unresolved place: coordinates.
    expect(rows[1]).toHaveTextContent('46.5000°N, 30.7000°E')
    expect(rows[1]).toHaveTextContent('high')
    expect(screen.getByText('Hotspots in the current map view')).toBeInTheDocument()
    expect(screen.getByText('7 - 13 Nov 2026')).toBeInTheDocument()
  })

  it('selects a row and requests a fly-to on click', async () => {
    renderPanel()
    const list = await screen.findByRole('list', { name: /strongest first/i })
    const row = within(list).getAllByRole('button')[1]
    fireEvent.click(row)
    const s = useStore.getState()
    expect(s.selectedHotspotId).toBe('h2')
    expect(s.flyTo?.bbox).toEqual([30.5, 46.3, 30.9, 46.7])
    expect(row).toHaveAttribute('aria-current', 'true')
  })

  it('keeps the numbers of the default order when sorted', async () => {
    renderPanel()
    const list = await screen.findByRole('list', { name: /strongest first/i })
    fireEvent.click(screen.getByRole('button', { name: 'Most recent' }))
    const rows = within(list).getAllByRole('button')
    expect(rows[0]).toHaveTextContent(/^2/)
    expect(rows[1]).toHaveTextContent(/^1/)
  })

  it('explains an empty result', async () => {
    renderPanel(collection({ total: 0, items: [] }))
    expect(await screen.findByText('No hotspots here for this period.')).toBeInTheDocument()
    expect(screen.getByText(/at least 10 detections within 10 km/)).toBeInTheDocument()
  })

  it('warns when the ranking is approximate and when it is cut short', async () => {
    renderPanel(collection({ approximate: true, total: 57 }))
    expect(await screen.findByText(/based on a sample of detections/)).toBeInTheDocument()
    expect(screen.getByText('Showing the strongest 2 of 57')).toBeInTheDocument()
  })

  it('shows the selected place and clears it', async () => {
    useStore.setState({ region: ukraine })
    renderPanel()
    expect(await screen.findByText('Hotspots in Ukraine')).toBeInTheDocument()
    const list = await screen.findByRole('list', { name: /strongest first/i })
    await waitFor(() => expect(within(list).getAllByRole('button')[0]).toHaveTextContent('near Rakhiv, Zakarpattia'))
    expect(within(list).getAllByRole('button')[0]).not.toHaveTextContent('Ukraine')
    fireEvent.click(screen.getByRole('button', { name: /clear ukraine/i }))
    expect(useStore.getState().region).toBeNull()
    expect(await screen.findByText('Hotspots in the current map view')).toBeInTheDocument()
  })

  it('toggles the map layer', async () => {
    renderPanel()
    const sw = screen.getByRole('switch', { name: 'Show on map' })
    expect(sw).toBeChecked()
    fireEvent.click(sw)
    expect(useStore.getState().showHotspots).toBe(false)
  })

  it('offers a retry on error', async () => {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const getHotspots = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue(collection())
    render(
      <QueryClientProvider client={client}>
        <ApiProvider api={fakeApi(getHotspots)} mode="mock">
          <HotspotsPanel />
        </ApiProvider>
      </QueryClientProvider>,
    )
    fireEvent.click(await screen.findByRole('button', { name: 'Retry' }))
    expect(await screen.findByRole('list', { name: /strongest first/i })).toBeInTheDocument()
  })
})
