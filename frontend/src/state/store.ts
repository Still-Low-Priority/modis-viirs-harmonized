import { create } from 'zustand'
import type { Bbox, Confidence, DayNight } from '../api/types'
import type { Place } from '../lib/geo/types'
import { addDays, todayUtc } from '../lib/dates'

export type ColorBy = 'source' | 'confidence' | 'frp'
export type Basemap = 'dark' | 'light' | 'satellite'
export type SidebarTab = 'hotspots' | 'filters' | 'ingest'

export interface AppState {
  // --- filters (sent to the API) ---
  dateFrom: string
  dateTo: string
  /** Selected source_product values. Empty = all sources. */
  sources: string[]
  daynight: DayNight | null
  minConfidence: Confidence | null
  /** Current map viewport; written by the map (debounced). */
  viewBbox: Bbox | null
  /**
   * Place picked in the search (country, region or city). While set, every
   * query uses its bbox instead of the viewport, so panning does not change
   * the numbers; clearing it returns to "what is on screen".
   */
  region: Place | null

  // --- UI state ---
  /** Command for the map: fit this bbox. `nonce` changes on every request. */
  flyTo: { bbox: Bbox; nonce: number } | null
  /** Detection opened in the details drawer. */
  selectedId: number | null
  colorBy: ColorBy
  basemap: Basemap
  sidebarOpen: boolean
  sidebarTab: SidebarTab
  bottomOpen: boolean
  /** Draw hotspot rings on the map. */
  showHotspots: boolean
  /** Hotspot highlighted in the list and on the map. */
  selectedHotspotId: string | null

  // --- actions ---
  setDateRange: (from: string, to: string) => void
  toggleSource: (source: string) => void
  setSources: (sources: string[]) => void
  setDaynight: (v: DayNight | null) => void
  setMinConfidence: (v: Confidence | null) => void
  setViewBbox: (b: Bbox) => void
  /** Pick a place: locks the data scope to it and moves the map there. Null clears it. */
  setRegion: (place: Place | null) => void
  requestFlyTo: (bbox: Bbox) => void
  select: (id: number | null) => void
  setColorBy: (v: ColorBy) => void
  setBasemap: (v: Basemap) => void
  setSidebarOpen: (v: boolean) => void
  setSidebarTab: (v: SidebarTab) => void
  setShowHotspots: (v: boolean) => void
  selectHotspot: (id: string | null) => void
  setBottomOpen: (v: boolean) => void
  resetFilters: () => void
}

/** Default period: the last 7 full UTC days. */
export function defaultRange(lastDay = addDays(todayUtc(), -1)): { dateFrom: string; dateTo: string } {
  return { dateFrom: addDays(lastDay, -6), dateTo: lastDay }
}

let nonce = 0

/** Phones start with the map visible; the filters sheet opens on demand. */
const wideScreen = typeof window === 'undefined' || !window.matchMedia || window.matchMedia('(min-width: 901px)').matches

export const useStore = create<AppState>((set) => ({
  ...defaultRange(),
  sources: [],
  daynight: null,
  minConfidence: null,
  viewBbox: null,
  region: null,

  flyTo: null,
  selectedId: null,
  colorBy: 'source',
  basemap: 'dark',
  sidebarOpen: wideScreen,
  sidebarTab: 'hotspots',
  bottomOpen: true,
  showHotspots: true,
  selectedHotspotId: null,

  setDateRange: (from, to) => set(from <= to ? { dateFrom: from, dateTo: to } : { dateFrom: to, dateTo: from }),
  toggleSource: (source) =>
    set((s) => ({ sources: s.sources.includes(source) ? s.sources.filter((x) => x !== source) : [...s.sources, source] })),
  setSources: (sources) => set({ sources }),
  setDaynight: (daynight) => set({ daynight }),
  setMinConfidence: (minConfidence) => set({ minConfidence }),
  setViewBbox: (viewBbox) => set({ viewBbox }),
  setRegion: (region) =>
    set(region ? { region, selectedHotspotId: null, flyTo: { bbox: region.bbox, nonce: ++nonce } } : { region: null, selectedHotspotId: null }),
  requestFlyTo: (bbox) => set({ flyTo: { bbox, nonce: ++nonce } }),
  select: (selectedId) => set({ selectedId }),
  setColorBy: (colorBy) => set({ colorBy }),
  setBasemap: (basemap) => set({ basemap }),
  setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
  setSidebarTab: (sidebarTab) => set({ sidebarTab, sidebarOpen: true }),
  setShowHotspots: (showHotspots) => set({ showHotspots }),
  selectHotspot: (selectedHotspotId) => set({ selectedHotspotId }),
  setBottomOpen: (bottomOpen) => set({ bottomOpen }),
  resetFilters: () => set({ ...defaultRange(), sources: [], daynight: null, minConfidence: null }),
}))
