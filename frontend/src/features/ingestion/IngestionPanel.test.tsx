import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { mockApi } from '../../api/mock'
import { addDays, todayUtc } from '../../lib/dates'
import type { Place } from '../../lib/geo/types'
import { useStore } from '../../state/store'
import { IngestionPanel } from './IngestionPanel'
import { pushJob, readJobs } from './jobs'

const place: Place = {
  id: 'region:UA-56',
  kind: 'region',
  name: 'Rivne',
  countryCode: 'UA',
  countryName: 'Ukraine',
  bbox: [25, 50, 28, 52],
  lat: 51,
  lon: 26,
}

const initial = useStore.getState()
const fetchMock = vi.fn()

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}

/** Routes by URL so the health check, the POST and the polling can interleave. */
function backend(routes: { health?: () => Response; create?: () => Response; job?: (id: string) => Response }) {
  fetchMock.mockImplementation(async (url: string, init?: RequestInit) => {
    if (url === '/api/health') return (routes.health ?? (() => json({ status: 'ok' })))()
    if (url === '/api/ingestion/jobs' && init?.method === 'POST') return (routes.create ?? (() => json({ task_id: 'task-1', status: 'PENDING' }, 202)))()
    if (url.startsWith('/api/ingestion/jobs/')) {
      const id = decodeURIComponent(url.slice('/api/ingestion/jobs/'.length))
      return (routes.job ?? (() => json({ task_id: id, status: 'STARTED', result: null, error: null })))(id)
    }
    return json({ detail: 'Not Found' }, 404)
  })
}

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ApiProvider api={mockApi} mode="mock">
        <IngestionPanel />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

const posted = () => fetchMock.mock.calls.filter(([url, init]) => url === '/api/ingestion/jobs' && (init as RequestInit)?.method === 'POST')

beforeEach(() => {
  localStorage.clear()
  fetchMock.mockReset()
  vi.stubGlobal('fetch', fetchMock)
  useStore.setState(initial, true)
  useStore.setState({ dateFrom: addDays(todayUtc(), -3), dateTo: addDays(todayUtc(), -1), viewBbox: [30.004, 48, 32, 50] })
})
afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('IngestionPanel', () => {
  it('shows the backend as online and offers the eight FIRMS products', async () => {
    backend({})
    setup()
    expect(await screen.findByText('Online')).toBeInTheDocument()
    expect(screen.getAllByRole('option')).toHaveLength(8)
    expect(screen.getByText(/still shows demo data/)).toBeInTheDocument()
  })

  it('starts a job for the map view with the chosen product and period, then lists it with its status', async () => {
    backend({})
    setup()
    await screen.findByText('Online')
    fireEvent.change(screen.getByLabelText('FIRMS product'), { target: { value: 'MODIS_NRT' } })
    fireEvent.click(screen.getByRole('button', { name: 'Start loading' }))

    expect(await screen.findByText('Running')).toBeInTheDocument()
    expect(posted()).toHaveLength(1)
    expect(JSON.parse((posted()[0][1] as RequestInit).body as string)).toEqual({
      source: 'MODIS_NRT',
      west: 30,
      south: 48,
      east: 32,
      north: 50,
      start_date: addDays(todayUtc(), -3),
      end_date: addDays(todayUtc(), -1),
    })
    expect(readJobs().map((j) => j.taskId)).toEqual(['task-1'])
  })

  it('uses the searched place instead of the map view', async () => {
    useStore.setState({ region: place })
    backend({})
    setup()
    await screen.findByText('Online')
    expect(screen.getByText('Rivne')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Start loading' }))
    await screen.findByText('Running')
    expect(JSON.parse((posted()[0][1] as RequestInit).body as string)).toMatchObject({ west: 25, south: 50, east: 28, north: 52 })
    expect(readJobs()[0].place).toBe('Rivne')
  })

  it('does not offer periods longer than the limit', async () => {
    backend({})
    setup()
    await screen.findByText('Online')
    fireEvent.change(screen.getByLabelText('From'), { target: { value: addDays(todayUtc(), -60) } })
    expect(screen.getByText(/Choose 31 days or fewer/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start loading' })).toBeDisabled()
  })

  it('does not accept a period that ends in the future', async () => {
    backend({})
    setup()
    await screen.findByText('Online')
    fireEvent.change(screen.getByLabelText('To'), { target: { value: addDays(todayUtc(), 2) } })
    expect(screen.getByText('The period cannot end after today (UTC).')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start loading' })).toBeDisabled()
  })

  it('waits for the map before an area exists', async () => {
    useStore.setState({ viewBbox: null })
    backend({})
    setup()
    await screen.findByText('Online')
    expect(screen.getByText('Waiting for the map')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start loading' })).toBeDisabled()
  })

  it('blocks starting while the backend is unreachable', async () => {
    backend({ health: () => json({ detail: 'Bad Gateway' }, 502) })
    setup()
    expect(await screen.findByText('Unreachable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Start loading' })).toBeDisabled()
    expect(posted()).toHaveLength(0)
  })

  it('explains a queue outage and keeps the list unchanged', async () => {
    backend({ create: () => json({ detail: 'Task queue is currently unavailable.' }, 503) })
    setup()
    await screen.findByText('Online')
    fireEvent.click(screen.getByRole('button', { name: 'Start loading' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('The task queue is unavailable')
    expect(readJobs()).toEqual([])
  })

  it('shows what the backend rejected', async () => {
    backend({ create: () => json({ detail: [{ msg: 'Value error, West and east must be different.' }] }, 422) })
    setup()
    await screen.findByText('Online')
    fireEvent.click(screen.getByRole('button', { name: 'Start loading' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('West and east must be different.')
  })

  it('restores earlier jobs and shows finished, failed and forgotten ones', async () => {
    const base = { source: 'VIIRS_SNPP_NRT', bbox: [30, 48, 32, 50] as [number, number, number, number], startDate: '2026-11-10', endDate: '2026-11-12', place: null }
    pushJob({ ...base, taskId: 'old', submittedAt: new Date(Date.now() - 3 * 86_400_000).toISOString() })
    pushJob({ ...base, taskId: 'bad', submittedAt: new Date().toISOString() })
    pushJob({ ...base, taskId: 'good', submittedAt: new Date().toISOString() })
    backend({ job: (id) => json({ task_id: id, status: id === 'good' ? 'SUCCESS' : 'FAILURE', result: null, error: id === 'bad' ? 'x' : null }) })
    setup()
    expect(await screen.findByText('Finished')).toBeInTheDocument()
    expect(await screen.findByText('Failed')).toBeInTheDocument()
    expect(screen.getByText('No longer tracked')).toBeInTheDocument()
    // The forgotten job is not polled: the backend would only answer PENDING.
    expect(fetchMock.mock.calls.some(([url]) => url === '/api/ingestion/jobs/old')).toBe(false)

    fireEvent.click(screen.getByRole('button', { name: 'Clear list' }))
    await waitFor(() => expect(screen.getByText('No jobs started from this browser yet.')).toBeInTheDocument())
    expect(readJobs()).toEqual([])
  })
})
