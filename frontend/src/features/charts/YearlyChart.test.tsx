import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { mockApi } from '../../api/mock'
import type { Place } from '../../lib/geo/types'
import { useStore } from '../../state/store'
import { YearlyChart } from './YearlyChart'

const initial = useStore.getState()

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

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ApiProvider api={mockApi} mode="mock">
        <YearlyChart />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useStore.setState(initial, true)
  window.matchMedia ??= ((q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} })) as unknown as typeof window.matchMedia
})
afterEach(cleanup)

describe('YearlyChart', () => {
  it('subtitle follows the selected place', () => {
    setup()
    expect(screen.getByText('current map view')).toBeInTheDocument()
    act(() => useStore.getState().setRegion(place))
    expect(screen.getByText('Rivne')).toBeInTheDocument()
    expect(screen.queryByText('current map view')).toBeNull()
  })

  it('shows a sensor legend for the detections metric only', async () => {
    setup()
    const legend = await screen.findByRole('list', { name: 'Sensors' })
    expect(legend.querySelectorAll('li').length).toBeGreaterThan(1)
    act(() => screen.getByRole('button', { name: 'FRP' }).click())
    expect(screen.queryByRole('list', { name: 'Sensors' })).toBeNull()
  })
})
