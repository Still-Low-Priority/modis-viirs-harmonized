import L from 'leaflet'
import { useEffect, useRef } from 'react'
import type { GridCell } from '../../api/types'
import type { Lang } from '../../i18n'
import { fmt } from '../../i18n'
import { heatColor } from '../../lib/colors'
import { formatFrp, formatNumber } from '../../lib/format'
import { darken, heatT } from './geo'
import { createHoverTooltip, sharedCanvas, tooltipContent } from './leafletShared'
import type { MapMessages } from './messages'

export interface GridData {
  cells: GridCell[]
  cell: number
  max: number
  min: number
}

/** Aggregated view for dense data: one rectangle per grid cell, coloured by count. */
export function useGridLayer(map: L.Map | null, grid: GridData | null, labels: { t: MapMessages; lang: Lang }) {
  const labelsRef = useRef(labels)
  useEffect(() => {
    labelsRef.current = labels
  })

  useEffect(() => {
    if (!map || !grid) return
    const renderer = sharedCanvas(map)
    const half = grid.cell / 2
    const group = L.featureGroup()
    const byLayer = new Map<L.Layer, GridCell>()

    for (const c of grid.cells) {
      const fill = heatColor(heatT(c.count, grid.max))
      const rect = L.rectangle(
        [
          [c.lat - half, c.lon - half],
          [c.lat + half, c.lon + half],
        ],
        { renderer, fillColor: fill, fillOpacity: 0.78, color: darken(fill, 0.6), weight: 0.5, opacity: 0.8, bubblingMouseEvents: false },
      )
      byLayer.set(rect, c)
      group.addLayer(rect)
    }

    const tooltip = createHoverTooltip()
    const cellOf = (e: L.LeafletEvent) => byLayer.get((e.propagatedFrom ?? e.layer) as L.Layer)

    group.on('mouseover', (e) => {
      const c = cellOf(e)
      if (!c) return
      const { t, lang } = labelsRef.current
      tooltip
        .setLatLng([c.lat + half, c.lon])
        .setContent(
          tooltipContent(
            fmt(t.legendGridCell, { cell: formatNumber(grid.cell, lang, 2) }),
            [
              { label: t.tipCount, value: formatNumber(c.count, lang) },
              { label: t.tipFrpSum, value: formatFrp(c.frp_sum, lang) },
            ],
            heatColor(heatT(c.count, grid.max)),
            t.tipCellZoom,
          ),
        )
      map.openTooltip(tooltip)
    })
    group.on('mouseout', () => map.closeTooltip(tooltip))
    group.on('click', (e) => {
      const c = cellOf(e)
      if (!c) return
      map.closeTooltip(tooltip)
      map.fitBounds(
        [
          [c.lat - half, c.lon - half],
          [c.lat + half, c.lon + half],
        ],
        { padding: [24, 24], animate: true },
      )
    })

    group.addTo(map)
    return () => {
      map.closeTooltip(tooltip)
      group.off()
      group.remove()
    }
  }, [map, grid])
}
