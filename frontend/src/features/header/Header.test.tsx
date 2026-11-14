import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import type { ApiMode } from '../../api'
import { mockApi } from '../../api/mock'
import { useStore } from '../../state/store'
import { Header } from './Header'

vi.mock('../search/SearchBox', () => ({ SearchBox: () => <div data-testid="search-stub" /> }))

const initial = useStore.getState()

beforeAll(() => {
  HTMLDialogElement.prototype.showModal = function (this: HTMLDialogElement) {
    this.setAttribute('open', '')
  }
  HTMLDialogElement.prototype.close = function (this: HTMLDialogElement) {
    this.removeAttribute('open')
  }
})

function setup(mode: ApiMode = 'mock') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <ApiProvider api={mockApi} mode={mode}>
        <Header />
      </ApiProvider>
    </QueryClientProvider>,
  )
}

const button = () => screen.getByRole('button', { name: 'View menu' })

beforeEach(() => {
  useStore.setState(initial, true)
})
afterEach(cleanup)

describe('Header status', () => {
  it('shows the demo pill with its explanation in mock mode', () => {
    setup('mock')
    expect(screen.getByText('Demo data')).toBeInTheDocument()
    expect(screen.getByRole('tooltip')).toHaveTextContent('generated, not real')
  })

  it('shows the live state in real mode', () => {
    setup('real')
    expect(screen.getByText('Live data')).toBeInTheDocument()
    expect(screen.queryByText('Demo data')).toBeNull()
    expect(screen.getByRole('tooltip')).toHaveTextContent('Data comes from the backend API.')
  })

  it('renders the search box', () => {
    setup()
    expect(screen.getByTestId('search-stub')).toBeInTheDocument()
  })
})

describe('View menu', () => {
  it('opens with click, ArrowDown, closes with Escape and returns focus', () => {
    setup()
    expect(screen.queryByRole('menu')).toBeNull()
    fireEvent.click(button())
    expect(screen.getByRole('menu')).toBeInTheDocument()
    expect(screen.getAllByRole('menuitemcheckbox')[0]).toHaveFocus()
    fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
    expect(screen.queryByRole('menu')).toBeNull()
    expect(button()).toHaveFocus()

    button().focus()
    fireEvent.keyDown(button(), { key: 'ArrowDown' })
    expect(screen.getByRole('menu')).toBeInTheDocument()
  })

  it('moves with arrows, Home and End, and closes on Tab and outside click', () => {
    setup()
    fireEvent.click(button())
    const items = [...screen.getAllByRole('menuitemcheckbox'), screen.getByRole('menuitem')]
    fireEvent.keyDown(items[0], { key: 'ArrowDown' })
    expect(items[1]).toHaveFocus()
    fireEvent.keyDown(items[1], { key: 'End' })
    expect(items[items.length - 1]).toHaveFocus()
    fireEvent.keyDown(items[items.length - 1], { key: 'ArrowDown' })
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(items[0], { key: 'ArrowUp' })
    expect(items[items.length - 1]).toHaveFocus()
    fireEvent.keyDown(items[0], { key: 'Home' })
    expect(items[0]).toHaveFocus()
    fireEvent.keyDown(items[0], { key: 'Tab' })
    expect(screen.queryByRole('menu')).toBeNull()

    fireEvent.click(button())
    fireEvent.pointerDown(document.body)
    expect(screen.queryByRole('menu')).toBeNull()
  })

  it('panel items toggle the sidebar tabs', () => {
    useStore.setState({ sidebarOpen: true, sidebarTab: 'hotspots' })
    setup()
    fireEvent.click(button())
    const hot = screen.getByRole('menuitemcheckbox', { name: 'Hotspots panel' })
    const fil = screen.getByRole('menuitemcheckbox', { name: 'Filters panel' })
    expect(hot).toHaveAttribute('aria-checked', 'true')
    expect(fil).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(fil)
    expect(useStore.getState()).toMatchObject({ sidebarOpen: true, sidebarTab: 'filters' })
    expect(fil).toHaveAttribute('aria-checked', 'true')
    expect(hot).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(fil)
    expect(useStore.getState().sidebarOpen).toBe(false)
    expect(fil).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(hot)
    expect(useStore.getState()).toMatchObject({ sidebarOpen: true, sidebarTab: 'hotspots' })
  })

  it('charts and rings items toggle their store fields', () => {
    setup()
    fireEvent.click(button())
    const charts = screen.getByRole('menuitemcheckbox', { name: 'Charts and calendar' })
    const rings = screen.getByRole('menuitemcheckbox', { name: 'Hotspot rings on map' })
    expect(charts).toHaveAttribute('aria-checked', 'true')
    fireEvent.click(charts)
    expect(useStore.getState().bottomOpen).toBe(false)
    expect(charts).toHaveAttribute('aria-checked', 'false')

    fireEvent.click(rings)
    expect(useStore.getState().showHotspots).toBe(false)
    expect(rings).toHaveAttribute('aria-checked', 'false')
  })

  it('opens the About dialog with the NASA acknowledgement', () => {
    setup('mock')
    fireEvent.click(button())
    fireEvent.click(screen.getByRole('menuitem', { name: 'About the data' }))
    expect(screen.queryByRole('menu')).toBeNull()
    const dialog = screen.getByRole('dialog', { name: 'About the data' })
    expect(dialog).toHaveTextContent("We acknowledge the use of data and/or imagery from NASA's Fire Information for Resource Management System (FIRMS) (https://earthdata.nasa.gov/firms), part of NASA's Earth Science Data and Information System (ESDIS).")
    expect(dialog).toHaveTextContent('generated data')
  })
})
