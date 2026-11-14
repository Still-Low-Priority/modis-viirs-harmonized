import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { Api, Interval, Timeseries } from '../../api/types'
import type { Place } from '../../lib/geo/types'
import { useStore } from '../../state/store'
import { SummaryBar } from './SummaryBar'

const initial = useStore.getState()

const DAYS: Timeseries = {
  interval: 'day',
  items: [
    { period: '2026-11-08', count: 10, frp_sum: 100, by_source: { MODIS_NRT: 4, VIIRS_SNPP_NRT: 6 } },
    { period: '2026-11-09', count: 40, frp_sum: 250.5, by_source: { MODIS_NRT: 10, VIIRS_SNPP_NRT: 30 } },
    { period: '2026-11-10', count: 20, frp_sum: 80, by_source: { VIIRS_SNPP_NRT: 20 } },
  ],
}

const ukraine: Place = {
  id: 'country:UA',
  kind: 'country',
  name: 'Ukraine',
  countryCode: 'UA',
  countryName: 'Ukraine',
  bbox: [22, 44, 40, 52],
  lat: 49,
  lon: 31,
}

function fakeApi(ts: Timeseries | ((interval: Interval) => Timeseries)): Api {
  return {
    getMeta: vi.fn(() => Promise.reject(new Error('unused'))),
    getDetections: vi.fn(() => Promise.reject(new Error('unused'))),
    getDetection: vi.fn(() => Promise.reject(new Error('unused'))),
    getTimeseries: vi.fn((q) => Promise.resolve(typeof ts === 'function' ? ts(q.interval) : ts)),
    getAreas: vi.fn(() => Promise.resolve([])),
    getGrid: vi.fn(() => Promise.resolve(null)),
    getHotspots: vi.fn(() => Promise.resolve(null)),
  }
}

function setup(ts: Timeseries | ((interval: Interval) => Timeseries) = DAYS) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ApiProvider api={fakeApi(ts)} mode="mock">
        <SummaryBar />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

const slots = () => Array.from(document.querySelectorAll<HTMLElement>('.summary-slot'))

beforeEach(() => {
  useStore.setState(initial, true)
  useStore.setState({ viewBbox: [20, 40, 40, 55], dateFrom: '2026-11-08', dateTo: '2026-11-10' })
})
afterEach(cleanup)

describe('SummaryBar', () => {
  it('describes the map view when no place is selected', async () => {
    setup()
    await screen.findByText('Detections per day')
    expect(screen.getByText('Current map view')).toBeInTheDocument()
    expect(screen.getByText(/3 days/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Clear place' })).toBeNull()
  })

  it('shows the place and clears it', async () => {
    useStore.setState({ region: ukraine })
    setup()
    await screen.findByText('Detections per day')
    expect(screen.getByText('Ukraine')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear place' }))
    expect(useStore.getState().region).toBeNull()
    expect(screen.getByText('Current map view')).toBeInTheDocument()
  })

  it('uses singular "1 day"', async () => {
    useStore.setState({ dateFrom: '2026-11-08', dateTo: '2026-11-08' })
    setup({ interval: 'day', items: [DAYS.items[0]] })
    await screen.findByText('Detections per day')
    expect(screen.getByText(/· 1 day$/)).toBeInTheDocument()
  })

  it('captions the chart by the returned interval, not the requested one', async () => {
    setup({ interval: 'month', items: [{ period: '2026-10', count: 5, frp_sum: 9 }, { period: '2026-11', count: 7, frp_sum: 3 }] })
    expect(await screen.findByText('Detections per month')).toBeInTheDocument()
  })

  it('narrows to a clicked day and goes back', async () => {
    setup()
    await screen.findByText('Detections per day')
    fireEvent.click(slots()[1])
    expect(useStore.getState().dateFrom).toBe('2026-11-09')
    expect(useStore.getState().dateTo).toBe('2026-11-09')
    const back = await screen.findByRole('button', { name: /Back to 8 – 10 Nov 2026/ })
    fireEvent.click(back)
    expect(useStore.getState().dateFrom).toBe('2026-11-08')
    expect(useStore.getState().dateTo).toBe('2026-11-10')
    expect(screen.queryByRole('button', { name: /Back to/ })).toBeNull()
  })

  it('narrows a month period to its first and last day', async () => {
    setup({ interval: 'month', items: [{ period: '2026-02', count: 5, frp_sum: 9 }, { period: '2026-03', count: 7, frp_sum: 3 }] })
    await screen.findByText('Detections per month')
    fireEvent.click(slots()[0])
    expect(useStore.getState().dateFrom).toBe('2026-02-01')
    expect(useStore.getState().dateTo).toBe('2026-02-28')
  })

  it('highlights on hover and announces the readout', async () => {
    setup()
    await screen.findByText('Detections per day')
    fireEvent.mouseEnter(slots()[1])
    expect(document.getElementById('summary-readout')).toHaveTextContent('9 Nov 2026 · 40 detections · 250.5 MW')
  })

  it('selects with the keyboard', async () => {
    setup()
    const chart = await screen.findByRole('group', { name: /Detections per day/ })
    act(() => chart.focus())
    // focus starts on the peak (9 Nov); move to the last day and pick it
    fireEvent.keyDown(chart, { key: 'ArrowRight' })
    expect(document.getElementById('summary-readout')).toHaveTextContent('10 Nov 2026 · 20 detections')
    fireEvent.keyDown(chart, { key: 'Enter' })
    expect(useStore.getState().dateFrom).toBe('2026-11-10')
    expect(useStore.getState().dateTo).toBe('2026-11-10')
    expect(within(document.body).getByRole('button', { name: /Back to/ })).toBeInTheDocument()
  })

  it('shows an explicit zero state and keeps scope and period', async () => {
    useStore.setState({ region: ukraine })
    setup({ interval: 'day', items: [{ period: '2026-11-08', count: 0, frp_sum: 0 }] })
    expect(await screen.findByText('No detections in Ukraine for this period')).toBeInTheDocument()
    expect(screen.getByText('Ukraine')).toBeInTheDocument()
    expect(screen.getByText(/3 days/)).toBeInTheDocument()
  })

  it('zero state names the map view without a place', async () => {
    setup({ interval: 'day', items: [] })
    expect(await screen.findByText('No detections in the current map view for this period')).toBeInTheDocument()
  })
})
