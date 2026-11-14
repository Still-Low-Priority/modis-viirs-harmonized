import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Place } from '../../lib/geo'
import { useStore } from '../../state/store'
import { SearchBox } from './SearchBox'

const bbox = { min_lat: 0, min_lon: 0, max_lat: 1, max_lon: 1 } as unknown as Place['bbox']

const UA: Place = { id: 'country:UA', kind: 'country', name: 'Ukraine', countryCode: 'UA', countryName: 'Ukraine', bbox, lat: 49, lon: 31 }
const RIVNE: Place = { id: 'region:UA-56', kind: 'region', name: 'Rivne', countryCode: 'UA', countryName: 'Ukraine', bbox, lat: 51, lon: 26 }
const RIVNE_CITY: Place = { id: 'city:1', kind: 'city', name: 'Rivne', regionName: 'Rivne', countryCode: 'UA', countryName: 'Ukraine', bbox, lat: 50.6, lon: 26.2 }

const search = vi.hoisted(() => vi.fn())
vi.mock('../../lib/geo', () => ({
  searchPlaces: search,
  loadPlaces: vi.fn(async () => []),
}))

afterEach(cleanup)

beforeEach(() => {
  localStorage.clear()
  useStore.setState({ region: null })
  search.mockReset()
  search.mockImplementation(async (q: string) => (q.toLowerCase().startsWith('riv') ? [RIVNE, RIVNE_CITY] : q.toLowerCase().startsWith('ukr') ? [UA] : []))
})

const userEvent = {
  type: async (el: HTMLElement, text: string) => {
    act(() => el.focus())
    fireEvent.change(el, { target: { value: text } })
  },
  keyboard: async (keys: string) => {
    const target = document.activeElement ?? document.body
    for (const m of keys.matchAll(/\{(\w+)\}|(.)/g)) fireEvent.keyDown(target, { key: m[1] ?? m[2] })
  },
}
const click = async (el: HTMLElement) => {
  fireEvent.click(el)
}

describe('SearchBox', () => {
  it('shows results with disambiguation while typing', async () => {
    render(<SearchBox />)
    await userEvent.type(screen.getByRole('combobox'), 'riv')
    const options = await screen.findAllByRole('option')
    expect(options).toHaveLength(2)
    expect(options[0]).toHaveTextContent('Region')
    expect(options[1]).toHaveTextContent('Rivne, Ukraine')
    expect(search).toHaveBeenLastCalledWith('riv', 8)
  })

  it('selects with the keyboard and moves the region', async () => {
    const user = { ...userEvent, click }
    render(<SearchBox />)
    const input = screen.getByRole('combobox')
    await user.type(input, 'riv')
    await screen.findAllByRole('option')
    await user.keyboard('{ArrowDown}{Enter}')
    expect(useStore.getState().region?.id).toBe('city:1')
    expect(input).toHaveValue('Rivne')
    expect(screen.queryByRole('option')).toBeNull()
  })

  it('Escape closes, then clears', async () => {
    const user = { ...userEvent, click }
    render(<SearchBox />)
    const input = screen.getByRole('combobox')
    await user.type(input, 'ukr')
    await screen.findByRole('option')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('option')).toBeNull()
    expect(input).toHaveValue('ukr')
    await user.keyboard('{Escape}')
    expect(input).toHaveValue('')
  })

  it('clear button resets the region', async () => {
    const user = { ...userEvent, click }
    render(<SearchBox />)
    await user.type(screen.getByRole('combobox'), 'ukr')
    await user.click(await screen.findByRole('option'))
    expect(useStore.getState().region?.id).toBe('country:UA')
    await user.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(useStore.getState().region).toBeNull()
    expect(screen.getByRole('combobox')).toHaveValue('')
  })

  it('empties the input when the region is cleared elsewhere', () => {
    render(<SearchBox />)
    act(() => useStore.getState().setRegion(UA))
    expect(screen.getByRole('combobox')).toHaveValue('Ukraine')
    act(() => useStore.getState().setRegion(null))
    expect(screen.getByRole('combobox')).toHaveValue('')
  })

  it('shows a no-results message', async () => {
    render(<SearchBox />)
    await userEvent.type(screen.getByRole('combobox'), 'zzz')
    expect(await screen.findByText('No places found for "zzz"')).toBeInTheDocument()
  })

  it('shows a failure message when search rejects', async () => {
    search.mockRejectedValue(new Error('boom'))
    render(<SearchBox />)
    await userEvent.type(screen.getByRole('combobox'), 'abc')
    expect(await screen.findByText(/unavailable/)).toBeInTheDocument()
  })

  it('persists recents and shows them on empty focus', async () => {
    const user = { ...userEvent, click }
    const { unmount } = render(<SearchBox />)
    await user.type(screen.getByRole('combobox'), 'ukr')
    await user.click(await screen.findByRole('option'))
    expect(JSON.parse(localStorage.getItem('mvh.recentPlaces') ?? '[]')[0].id).toBe('country:UA')
    unmount()

    act(() => useStore.getState().setRegion(null))
    render(<SearchBox />)
    fireEvent.focus(screen.getByRole('combobox'))
    expect(await screen.findByText('Recent')).toBeInTheDocument()
    expect(screen.getByRole('option')).toHaveTextContent('Ukraine')
    expect(screen.getByText(/Try: Ukraine/)).toBeInTheDocument()
  })

  it('"/" focuses the input', async () => {
    render(<SearchBox />)
    await userEvent.keyboard('/')
    expect(screen.getByRole('combobox')).toHaveFocus()
  })
})
