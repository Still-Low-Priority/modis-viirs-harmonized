import type { Map as LeafletMap } from 'leaflet'
import { useEffect, useState } from 'react'
import { useStore } from '../../state/store'
import { bboxToLatLngs, boundsToBbox } from './geo'

const VIEWPORT_DEBOUNCE_MS = 300

/** Writes the (debounced) viewport to the store on ready and on every `moveend`. */
export function useViewportSync(map: LeafletMap | null) {
  useEffect(() => {
    if (!map) return
    let timer: ReturnType<typeof setTimeout> | undefined
    const push = () => {
      const b = map.getBounds()
      useStore.getState().setViewBbox(boundsToBbox(b.getWest(), b.getSouth(), b.getEast(), b.getNorth()))
    }
    const schedule = () => {
      clearTimeout(timer)
      timer = setTimeout(push, VIEWPORT_DEBOUNCE_MS)
    }
    map.whenReady(schedule)
    map.on('moveend', schedule)
    return () => {
      clearTimeout(timer)
      map.off('moveend', schedule)
    }
  }, [map])
}

/** Executes `store.flyTo` commands (a new nonce = a new command). */
export function useFlyTo(map: LeafletMap | null) {
  const flyTo = useStore((s) => s.flyTo)
  useEffect(() => {
    if (!map || !flyTo) return
    map.fitBounds(bboxToLatLngs(flyTo.bbox), { padding: [32, 32], animate: true, duration: 0.8, maxZoom: 11 })
  }, [map, flyTo])
}

/** Fixes the Leaflet-in-flex problem: re-measure when side panels open or close. */
export function useInvalidateOnResize(map: LeafletMap | null) {
  useEffect(() => {
    if (!map || typeof ResizeObserver === 'undefined') return
    let frame = 0
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(() => map.invalidateSize({ debounceMoveend: true }))
    })
    ro.observe(map.getContainer())
    return () => {
      cancelAnimationFrame(frame)
      ro.disconnect()
    }
  }, [map])
}

/** Current zoom level as React state. */
export function useZoom(map: LeafletMap | null): number | null {
  const [zoom, setZoom] = useState<number | null>(null)
  useEffect(() => {
    if (!map) return
    const update = () => setZoom(map.getZoom())
    map.whenReady(update)
    map.on('zoomend', update)
    return () => {
      map.off('zoomend', update)
    }
  }, [map])
  return zoom
}
