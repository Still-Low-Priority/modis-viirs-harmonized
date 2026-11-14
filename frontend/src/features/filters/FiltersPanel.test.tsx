import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { mockApi } from '../../api/mock'
import { addDays } from '../../lib/dates'
import type { Place } from '../../lib/geo/types'
import { useStore } from '../../state/store'
import { FiltersPanel } from './FiltersPanel'

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

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ApiProvider api={mockApi} mode="mock">
        <FiltersPanel />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useStore.setState(initial, true)
})
afterEach(cleanup)

describe('FiltersPanel', () => {
  it('sensors: empty store = all checked, unchecking stores the rest, re-checking all stores []', async () => {
    setup()
    const boxes = await screen.findAllByRole('checkbox')
    expect(boxes.length).toBeGreaterThan(1)
    boxes.forEach((b) => expect(b).toBeChecked())

    fireEvent.click(boxes[0])
    expect(useStore.getState().sources).toHaveLength(boxes.length - 1)
    expect(boxes[0]).not.toBeChecked()

    fireEvent.click(boxes[0])
    expect(useStore.getState().sources).toEqual([])
  })

  it('sensors: the last remaining sensor cannot be unchecked', async () => {
    setup()
    const boxes = await screen.findAllByRole('checkbox')
    for (const b of boxes.slice(1)) fireEvent.click(b)
    expect(useStore.getState().sources).toHaveLength(1)
    expect(boxes[0]).toBeChecked()
    expect(boxes[0]).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: 'Select all' }))
    expect(useStore.getState().sources).toEqual([])
  })

  it('preset sets a range relative to meta.date_max', async () => {
    setup()
    const btn = await screen.findByRole('button', { name: '30 days' })
    await screen.findAllByRole('checkbox')
    fireEvent.click(btn)
    const { dateFrom, dateTo } = useStore.getState()
    expect(dateFrom).toBe(addDays(dateTo, -29))
    expect(btn).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('30 days', { selector: 'p' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Last day' }))
    expect(screen.getByText('1 day', { selector: 'p' })).toBeInTheDocument()
  })

  it('day/night segmented control writes to the store', async () => {
    setup()
    await screen.findAllByRole('checkbox')
    const night = screen.getByRole('button', { name: 'Night' })
    fireEvent.click(night)
    expect(useStore.getState().daynight).toBe('N')
    expect(night).toHaveAttribute('aria-pressed', 'true')
    fireEvent.click(screen.getByRole('button', { name: 'Day' }))
    expect(useStore.getState().daynight).toBe('D')
    fireEvent.click(screen.getByRole('button', { name: 'All' }))
    expect(useStore.getState().daynight).toBeNull()
  })

  it('reset is disabled by default and restores defaults', async () => {
    setup()
    await screen.findAllByRole('checkbox')
    const reset = screen.getByRole('button', { name: 'Reset filters' })
    fireEvent.click(await screen.findByRole('button', { name: '90 days' }))
    expect(reset).toBeEnabled()
    fireEvent.click(reset)
    expect(useStore.getState().dateFrom).toBe(addDays(useStore.getState().dateTo, -6))
    expect(reset).toBeDisabled()
  })

  it('has no own heading or close button', async () => {
    setup()
    await screen.findAllByRole('checkbox')
    expect(screen.queryByRole('heading')).toBeNull()
    expect(screen.queryByRole('button', { name: /close/i })).toBeNull()
  })

  it('shows the selected place and clears it', async () => {
    setup()
    await screen.findAllByRole('checkbox')
    expect(screen.queryByText(/Showing data for/)).toBeNull()
    act(() => useStore.getState().setRegion(place))
    expect(screen.getByText('Showing data for Rivne')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(useStore.getState().region).toBeNull()
    expect(screen.queryByText(/Showing data for/)).toBeNull()
  })
})
