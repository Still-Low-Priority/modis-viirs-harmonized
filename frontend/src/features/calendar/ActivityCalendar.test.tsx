import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { mockApi } from '../../api/mock'
import type { Api } from '../../api/types'
import type { Place } from '../../lib/geo/types'
import { useStore } from '../../state/store'
import { ActivityCalendar } from './ActivityCalendar'

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

function setup(api: Api = mockApi) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ApiProvider api={api} mode="mock">
        <ActivityCalendar />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

beforeEach(() => {
  useStore.setState(initial, true)
})
afterEach(() => {
  cleanup()
  vi.useRealTimers()
})

describe('ActivityCalendar', () => {
  it('scope note follows the selected place', async () => {
    setup()
    expect(screen.getByText('in the current map view')).toBeInTheDocument()
    act(() => useStore.getState().setRegion(place))
    expect(screen.getByText('in Rivne')).toBeInTheDocument()
    await screen.findAllByRole('gridcell')
  })

  it('uses singular and plural in cell labels', async () => {
    setup()
    const cells = await screen.findAllByRole('gridcell')
    const labels = cells.map((c) => c.getAttribute('aria-label') ?? '')
    expect(labels.some((l) => /: \d+ detections$/.test(l) && !/: 1 detections$/.test(l))).toBe(true)
    expect(labels.some((l) => /: 1 detections$/.test(l))).toBe(false)
  })

  it('keeps the previous total visible and dimmed while refetching', async () => {
    let release: () => void = () => {}
    let slow = false
    const api: Api = {
      ...mockApi,
      getTimeseries: async (q, s) => {
        if (slow) await new Promise<void>((r) => (release = r))
        return mockApi.getTimeseries(q, s)
      },
    }
    setup(api)
    await screen.findAllByRole('gridcell')
    const total = document.querySelector('.cal-total') as HTMLElement
    const before = total.textContent
    expect(before).toMatch(/detections?$/)
    slow = true
    act(() => useStore.getState().setRegion(place))
    expect(total.textContent).toBe(before)
    expect(total.dataset.stale).toBe('true')
    await act(async () => release())
  })

  it('touch: a tap selects a day, a long press selects a range', async () => {
    setup()
    const cells = await screen.findAllByRole('gridcell')
    const enabled = cells.filter((c) => c.getAttribute('aria-disabled') !== 'true')
    const a = enabled[10] as HTMLElement
    const b = enabled[14] as HTMLElement
    let at: HTMLElement = a
    document.elementFromPoint = () => at
    const grid = screen.getByRole('grid')
    const touch = { pointerType: 'touch', button: 0, clientX: 5, clientY: 5 }

    fireEvent.pointerDown(a, touch)
    fireEvent.pointerUp(a, touch)
    expect(useStore.getState().dateFrom).toBe(a.dataset.day)
    expect(useStore.getState().dateTo).toBe(a.dataset.day)

    vi.useFakeTimers()
    fireEvent.pointerDown(a, touch)
    act(() => {
      vi.advanceTimersByTime(400)
    })
    at = b
    fireEvent.pointerMove(grid, { ...touch, clientX: 6 })
    fireEvent.pointerUp(window, touch)
    expect(useStore.getState().dateFrom).toBe(a.dataset.day)
    expect(useStore.getState().dateTo).toBe(b.dataset.day)
  })

  it('touch: moving before the delay cancels the press (scroll)', async () => {
    setup()
    const cells = await screen.findAllByRole('gridcell')
    const a = cells.find((c) => c.getAttribute('aria-disabled') !== 'true') as HTMLElement
    document.elementFromPoint = () => a
    const before = { ...useStore.getState() }
    vi.useFakeTimers()
    fireEvent.pointerDown(a, { pointerType: 'touch', button: 0, clientX: 5, clientY: 5 })
    fireEvent.pointerMove(screen.getByRole('grid'), { pointerType: 'touch', clientX: 40, clientY: 5 })
    act(() => {
      vi.advanceTimersByTime(500)
    })
    fireEvent.pointerUp(a, { pointerType: 'touch', button: 0 })
    expect(useStore.getState().dateFrom).toBe(before.dateFrom)
  })
})
