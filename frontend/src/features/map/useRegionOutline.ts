import { useQuery } from '@tanstack/react-query'
import L from 'leaflet'
import { useEffect } from 'react'
import { loadCountryPolygon } from '../../lib/geo'
import type { Place } from '../../lib/geo'
import { useStore } from '../../state/store'
import { bboxOutlineRings, multiPolygonToLines } from './geo'
import { ensurePane } from './leafletShared'

const REGION_PANE = 'map-region'

/**
 * Extent of `store.region`: the country outline when one is available,
 * otherwise a dashed rectangle of the place's bbox. Purely decorative: the
 * layer is non-interactive and never blocks the map.
 */
export function useRegionOutline(map: L.Map | null) {
  const region = useStore((s) => s.region)
  const country = region?.kind === 'country' ? region.countryCode : null
  // Same key as useScopedHotspots, so the outline is fetched once.
  const outline = useQuery({
    queryKey: ['country-outline', country],
    queryFn: () => loadCountryPolygon(country as string),
    enabled: country != null,
    staleTime: Infinity,
  })
  const polygon = country ? (outline.data ?? null) : null
  // Until the outline resolves (or when there is none) the bbox is shown.
  const pending = country != null && outline.isLoading

  useEffect(() => {
    if (!map || !region || pending) return
    // Between the hotspot rings (610) and the tiles; below the points (overlay pane, 400).
    const pane = ensurePane(map, REGION_PANE, 390)
    const layer = polygon ? outlineLayer(polygon, pane) : bboxLayer(region, pane)
    layer.addTo(map)
    return () => {
      layer.remove()
    }
  }, [map, region, polygon, pending])
}

function outlineLayer(polygon: [number, number][][][], pane: string): L.Layer {
  return L.polyline(multiPolygonToLines(polygon), {
    pane,
    interactive: false,
    className: 'map-region-outline',
    weight: 1.5,
    opacity: 0.95,
    fill: false,
  })
}

function bboxLayer(region: Place, pane: string): L.Layer {
  return L.polyline(bboxOutlineRings(region.bbox), {
    pane,
    interactive: false,
    className: 'map-region-box',
    weight: 1.5,
    opacity: 0.95,
    dashArray: '6 5',
    fill: false,
  })
}
