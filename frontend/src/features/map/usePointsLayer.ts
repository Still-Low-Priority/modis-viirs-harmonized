import L from 'leaflet'
import { useEffect, useMemo, useRef } from 'react'
import type { DetectionFeature } from '../../api/types'
import type { Lang } from '../../i18n'
import { CONFIDENCE_COLORS, frpColor, sourceColor, sourceLabel } from '../../lib/colors'
import { formatDateTimeUtc, formatFrp } from '../../lib/format'
import type { ColorBy } from '../../state/store'
import { useStore } from '../../state/store'
import { darken, radiusForZoom } from './geo'
import { createHoverTooltip, ensurePane, sharedCanvas, tooltipContent } from './leafletShared'
import type { MapMessages } from './messages'

export function pointColor(f: DetectionFeature, colorBy: ColorBy): string {
  const p = f.properties
  if (colorBy === 'confidence') return CONFIDENCE_COLORS[p.confidence] ?? CONFIDENCE_COLORS.low
  if (colorBy === 'frp') return frpColor(p.frp)
  return sourceColor(p.source_product)
}

interface Labels {
  t: MapMessages
  lang: Lang
}

/**
 * Imperative points layer: thousands of circle markers on one canvas, so React
 * never renders a component per point. Rebuilt when data or colour mode changes.
 */
export function usePointsLayer(
  map: L.Map | null,
  features: DetectionFeature[] | null,
  colorBy: ColorBy,
  zoom: number | null,
  labels: Labels,
) {
  const groupRef = useRef<L.FeatureGroup | null>(null)
  const labelsRef = useRef(labels)
  useEffect(() => {
    labelsRef.current = labels
  })

  useEffect(() => {
    if (!map || !features) return
    const renderer = sharedCanvas(map)
    const radius = radiusForZoom(map.getZoom())
    const group = L.featureGroup()
    const byLayer = new Map<L.Layer, DetectionFeature>()
    const strokeCache = new Map<string, string>()

    for (const f of features) {
      const [lon, lat] = f.geometry.coordinates
      const fill = pointColor(f, colorBy)
      let stroke = strokeCache.get(fill)
      if (!stroke) {
        stroke = darken(fill, 0.4)
        strokeCache.set(fill, stroke)
      }
      const marker = L.circleMarker([lat, lon], {
        renderer,
        radius,
        fillColor: fill,
        fillOpacity: 0.6,
        color: stroke,
        weight: 0.7,
        opacity: 0.9,
        bubblingMouseEvents: false,
      })
      byLayer.set(marker, f)
      group.addLayer(marker)
    }

    const tooltip = createHoverTooltip()
    const featureOf = (e: L.LeafletEvent) => byLayer.get((e.propagatedFrom ?? e.layer) as L.Layer)

    group.on('mouseover', (e) => {
      const f = featureOf(e)
      if (!f) return
      const { t, lang } = labelsRef.current
      const p = f.properties
      const [lon, lat] = f.geometry.coordinates
      tooltip
        .setLatLng([lat, lon])
        .setContent(
          tooltipContent(
            sourceLabel(p.source_product),
            [
              { label: '', value: formatDateTimeUtc(p.acquired_at, lang) },
              { label: t.tipFrp, value: formatFrp(p.frp, lang) },
              { label: t.tipConfidence, value: t[`confidence_${p.confidence}`] ?? p.confidence },
            ],
            pointColor(f, colorBy),
          ),
        )
      map.openTooltip(tooltip)
    })
    group.on('mouseout', () => map.closeTooltip(tooltip))
    group.on('click', (e) => {
      const f = featureOf(e)
      if (f) useStore.getState().select(f.id)
    })

    group.addTo(map)
    groupRef.current = group
    return () => {
      map.closeTooltip(tooltip)
      group.off()
      group.remove()
      if (groupRef.current === group) groupRef.current = null
    }
  }, [map, features, colorBy])

  // Radius follows the zoom without rebuilding the layer.
  useEffect(() => {
    if (zoom == null) return
    const r = radiusForZoom(zoom)
    groupRef.current?.eachLayer((l) => (l as L.CircleMarker).setRadius(r))
  }, [zoom])
}

/** Highlight ring for `store.selectedId`, in its own pane above the points. */
export function useSelectedRing(map: L.Map | null, features: DetectionFeature[] | null, zoom: number | null) {
  const selectedId = useStore((s) => s.selectedId)
  const selected = useMemo(
    () => (selectedId == null || !features ? null : (features.find((f) => f.id === selectedId) ?? null)),
    [features, selectedId],
  )

  useEffect(() => {
    if (!map || !selected) return
    const pane = ensurePane(map, 'map-selected', 620)
    const [lon, lat] = selected.geometry.coordinates
    const r = radiusForZoom(zoom ?? map.getZoom())
    const halo = L.circleMarker([lat, lon], {
      pane,
      interactive: false,
      radius: r + 6,
      color: '#ffffff',
      weight: 2.5,
      opacity: 0.95,
      fill: false,
      className: 'map-selected-halo',
    })
    const core = L.circleMarker([lat, lon], {
      pane,
      interactive: false,
      radius: r + 1.5,
      color: '#0b0f16',
      weight: 1.5,
      fillColor: '#ffffff',
      fillOpacity: 0.9,
      className: 'map-selected-core',
    })
    const group = L.layerGroup([halo, core]).addTo(map)
    return () => {
      group.remove()
    }
  }, [map, selected, zoom])
}
