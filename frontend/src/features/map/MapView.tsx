import type { Map as LeafletMap } from 'leaflet'
import 'leaflet/dist/leaflet.css'
import { useMemo, useState } from 'react'
import { MapContainer } from 'react-leaflet'
import { useDetections, useGrid, useScopedHotspots } from '../../api/queries'
import type { GridCell } from '../../api/types'
import { useLang, useT } from '../../i18n'
import { useStore } from '../../state/store'
import { BaseLayers, MAX_ZOOM } from './BaseLayers'
import { cellForZoom, LAT_LIMIT } from './geo'
import { MapControls } from './MapControls'
import { MapLegend } from './MapLegend'
import { MapStatus } from './MapStatus'
import './map.css'
import { messages } from './messages'
import type { GridData } from './useGridLayer'
import { useGridLayer } from './useGridLayer'
import { useFlyTo, useInvalidateOnResize, useViewportSync, useZoom } from './useMapSync'
import { useHotspotsLayer, useStableHotspots } from './useHotspotsLayer'
import { usePointsLayer, useSelectedRing } from './usePointsLayer'
import { useRegionOutline } from './useRegionOutline'

const POINT_LIMIT = 20_000
/** Same limit as the hotspots panel, so the map and the list show the same set. */
const HOTSPOT_LIMIT = 30
const INITIAL_CENTER: [number, number] = [20, 15]
const INITIAL_ZOOM = 3
const MIN_ZOOM = 2
// Wide in longitude so world copies stay reachable; latitudes stop at the Mercator edge.
const MAX_BOUNDS: [[number, number], [number, number]] = [
  [-LAT_LIMIT, -720],
  [LAT_LIMIT, 720],
]

function summarizeGrid(cells: GridCell[], cell: number): GridData {
  let max = 0
  let min = Infinity
  for (const c of cells) {
    if (c.count > max) max = c.count
    if (c.count < min) min = c.count
  }
  return { cells, cell, max, min: Number.isFinite(min) ? min : 0 }
}

export function MapView() {
  const t = useT(messages)
  const lang = useLang()
  const basemap = useStore((s) => s.basemap)
  const dateTo = useStore((s) => s.dateTo)
  const colorBy = useStore((s) => s.colorBy)
  const showHotspots = useStore((s) => s.showHotspots)
  const placeName = useStore((s) => s.region?.name ?? null)
  const [map, setMap] = useState<LeafletMap | null>(null)

  useViewportSync(map)
  useFlyTo(map)
  useInvalidateOnResize(map)
  const zoom = useZoom(map)

  const detections = useDetections(POINT_LIMIT)
  const data = detections.data
  const truncated = data?.truncated === true

  const cell = cellForZoom(zoom ?? INITIAL_ZOOM)
  const gridQuery = useGrid(cell, truncated)
  // Keep the last fresh grid together with the cell size it was requested with,
  // so placeholder data from a previous zoom is never drawn with the wrong cell size.
  const [grid, setGrid] = useState<GridData | null>(null)
  const freshCells = truncated && !gridQuery.isPlaceholderData ? gridQuery.data : undefined
  if (freshCells !== undefined && freshCells !== grid?.cells) {
    setGrid(freshCells ? summarizeGrid(freshCells, cell) : null)
  }
  if (!truncated && grid) setGrid(null)

  const gridMode = truncated && grid != null && grid.cells.length > 0
  const features = data?.features ?? null
  const pointFeatures = gridMode ? null : features
  const labels = useMemo(() => ({ t, lang }), [t, lang])

  usePointsLayer(map, pointFeatures, colorBy, zoom, labels)
  useSelectedRing(map, pointFeatures, zoom)
  useGridLayer(map, gridMode ? grid : null, labels)

  const hotspotsQuery = useScopedHotspots({ limit: HOTSPOT_LIMIT })
  const hotspots = useStableHotspots(showHotspots ? (hotspotsQuery.data?.items ?? null) : null)
  useHotspotsLayer(map, hotspots, zoom, labels)
  useRegionOutline(map)

  return (
    <div className="map-root" role="region" aria-label={t.mapLabel}>
      <MapContainer
        ref={setMap}
        className="map-leaflet"
        center={INITIAL_CENTER}
        zoom={INITIAL_ZOOM}
        minZoom={MIN_ZOOM}
        maxZoom={MAX_ZOOM}
        maxBounds={MAX_BOUNDS}
        maxBoundsViscosity={1}
        worldCopyJump
        zoomSnap={0.5}
        attributionControl
      >
        <BaseLayers basemap={basemap} day={dateTo} />
      </MapContainer>

      <div className="map-overlay">
        <MapStatus
          fetching={detections.isFetching || (truncated && gridQuery.isFetching)}
          error={detections.isError}
          onRetry={() => void detections.refetch()}
          total={data?.total ?? null}
          shown={features?.length ?? 0}
          truncated={truncated}
          gridMode={gridMode}
          placeName={placeName}
        />
        <div className="map-overlay__tl">
          <MapControls gridMode={gridMode} />
        </div>
        <div className="map-overlay__bl">
          <MapLegend colorBy={colorBy} features={features} grid={gridMode ? grid : null} hotspots={hotspots != null && hotspots.length > 0} />
        </div>
      </div>
    </div>
  )
}
