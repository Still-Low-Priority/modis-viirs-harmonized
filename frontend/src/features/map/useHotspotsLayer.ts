import L from 'leaflet'
import { useEffect, useRef, useState } from 'react'
import type { Hotspot } from '../../api/types'
import type { Lang } from '../../i18n'
import { fmt } from '../../i18n'
import { SEVERITY_COLORS } from '../../lib/colors'
import { formatFrp, formatNumber } from '../../lib/format'
import { useStore } from '../../state/store'
import { ringRadiusMeters, ringRadiusPx } from './geo'
import { ensurePane, tooltipContent } from './leafletShared'
import type { MapMessages } from './messages'

/** Rings sit above points and grid cells; badges above the rings. */
const RING_PANE = 'map-hotspots'
const BADGE_PANE = 'map-hotspot-badges'
/** Numbered badges are drawn for this many of the strongest hotspots. */
export const BADGE_COUNT = 10
/**
 * Marker z-order is screen y + offset. Offsets this large keep the ranks in
 * order (1 on top) whatever the badges' screen positions; selected wins.
 */
const rankZ = (rank: number, selected: boolean) => (selected ? 1_000_000 : (BADGE_COUNT - rank) * 10_000)
/** Rings never shrink below this on screen, so they stay visible and clickable. */
const MIN_RING_PX = 10
/** Above this on-screen radius only the stroke catches clicks, so points inside stay clickable. */
const FILL_CLICK_MAX_PX = 28

interface Labels {
  t: MapMessages
  lang: Lang
}

interface Entry {
  hotspot: Hotspot
  rank: number
  ring: L.Circle
  badge: L.Marker | null
}

function ringStyle(h: Hotspot, selected: boolean): L.PathOptions {
  const color = SEVERITY_COLORS[h.severity]
  return selected
    ? { color, weight: 3.5, opacity: 1, fillColor: color, fillOpacity: 0.32 }
    : { color, weight: 1.75, opacity: 0.95, fillColor: color, fillOpacity: 0.1 }
}

function badgeIcon(h: Hotspot, rank: number, selected: boolean): L.DivIcon {
  const size = selected ? 24 : 20
  const cls = `map-hotspot-badge${selected ? ' map-hotspot-badge--selected' : ''}`
  return L.divIcon({
    className: cls,
    // Only a number and a constant colour go into the HTML: no data-derived strings.
    html: `<span class="map-hotspot-badge__dot" style="--sev:${SEVERITY_COLORS[h.severity]}">${rank}</span>`,
    iconSize: [size, size],
    iconAnchor: [size / 2, size / 2],
  })
}

function tooltipFor(entry: Entry, { t, lang }: Labels): HTMLElement {
  const h = entry.hotspot
  return tooltipContent(
    fmt(t.hotspotTitle, { rank: entry.rank }),
    [
      { label: t.tipSeverity, value: t[`severity_${h.severity}`] },
      { label: t.tipCount, value: formatNumber(h.count, lang) },
      { label: t.tipFrpSum, value: formatFrp(h.frp_sum, lang) },
    ],
    SEVERITY_COLORS[h.severity],
    t.hotspotClick,
  )
}

/** Applies the zoom-dependent radius and the click-through rule to a ring. */
function fitRing(entry: Entry, zoom: number) {
  const h = entry.hotspot
  const r = ringRadiusMeters(h.radius_km, h.lat, zoom, MIN_RING_PX)
  entry.ring.setRadius(r)
  const el = entry.ring.getElement()
  el?.classList.toggle('map-hotspot-ring--stroke-only', ringRadiusPx(r, h.lat, zoom) > FILL_CLICK_MAX_PX)
}

function signature(list: Hotspot[] | null): string {
  return list ? list.map((h) => `${h.id}:${h.severity}:${h.count}:${h.frp_sum}:${h.radius_km}`).join('|') : ''
}

/**
 * The scoped-hotspots hook may hand out a new array on every render (it
 * filters and slices). Keep the previous array while the content is the same,
 * so the layer is not rebuilt for nothing.
 */
export function useStableHotspots(list: Hotspot[] | null): Hotspot[] | null {
  const [stable, setStable] = useState(list)
  if (list !== stable && signature(list) !== signature(stable)) {
    setStable(list)
    return list
  }
  return stable
}

/**
 * Hotspot rings (real radius, at least MIN_RING_PX on screen) with numbered
 * badges for the strongest ones, in the order received. Clicking selects the
 * hotspot and opens the hotspots tab; the selected one is emphasised.
 */
export function useHotspotsLayer(map: L.Map | null, hotspots: Hotspot[] | null, zoom: number | null, labels: Labels) {
  const selectedId = useStore((s) => s.selectedHotspotId)
  const entriesRef = useRef<Map<string, Entry>>(new Map())
  const labelsRef = useRef(labels)
  const selectedRef = useRef(selectedId)
  useEffect(() => {
    labelsRef.current = labels
    selectedRef.current = selectedId
  })

  // Build the layers when the set changes.
  useEffect(() => {
    if (!map || !hotspots?.length) return
    const ringPane = ensurePane(map, RING_PANE, 610)
    const badgePane = ensurePane(map, BADGE_PANE, 640)
    const group = L.layerGroup()
    const entries = new Map<string, Entry>()
    const z = map.getZoom()
    const selected = selectedRef.current

    const onClick = (id: string) => () => {
      const s = useStore.getState()
      s.selectHotspot(id)
      s.setSidebarTab('hotspots')
    }

    hotspots.forEach((h, i) => {
      const rank = i + 1
      const isSel = h.id === selected
      const ring = L.circle([h.lat, h.lon], {
        pane: ringPane,
        radius: ringRadiusMeters(h.radius_km, h.lat, z, MIN_RING_PX),
        className: 'map-hotspot-ring',
        bubblingMouseEvents: false,
        ...ringStyle(h, isSel),
      })
      const badge =
        i < BADGE_COUNT
          ? L.marker([h.lat, h.lon], {
              pane: badgePane,
              icon: badgeIcon(h, rank, isSel),
              keyboard: true,
              title: fmt(labelsRef.current.t.hotspotBadge, {
                rank,
                severity: labelsRef.current.t[`severity_${h.severity}`],
                count: formatNumber(h.count, labelsRef.current.lang),
              }),
              zIndexOffset: rankZ(rank, isSel),
              bubblingMouseEvents: false,
            })
          : null
      const entry: Entry = { hotspot: h, rank, ring, badge }
      const tip = { className: 'map-tooltip', direction: 'top' as const, offset: [0, -10] as [number, number], opacity: 1 }
      for (const layer of badge ? [ring, badge] : [ring]) {
        layer.bindTooltip(() => tooltipFor(entry, labelsRef.current), tip)
        layer.on('click', onClick(h.id))
      }
      entries.set(h.id, entry)
    })

    // SVG paints in insertion order: add the weakest first so rank 1 is on top.
    for (const e of [...entries.values()].reverse()) {
      group.addLayer(e.ring)
      if (e.badge) group.addLayer(e.badge)
    }
    group.addTo(map)
    for (const e of entries.values()) fitRing(e, z)
    entries.get(selected ?? '')?.ring.bringToFront()
    entriesRef.current = entries
    return () => {
      group.eachLayer((l) => l.off())
      group.remove()
      if (entriesRef.current === entries) entriesRef.current = new Map()
    }
  }, [map, hotspots])

  // Radius follows the zoom without rebuilding.
  useEffect(() => {
    if (zoom == null) return
    for (const e of entriesRef.current.values()) fitRing(e, zoom)
  }, [zoom, hotspots])

  // Selection: restyle in place and bring the selected one to the top.
  const prevSelected = useRef<string | null>(null)
  useEffect(() => {
    const entries = entriesRef.current
    const restyle = (id: string | null, on: boolean) => {
      const e = id ? entries.get(id) : undefined
      if (!e) return
      e.ring.setStyle(ringStyle(e.hotspot, on))
      e.badge?.setIcon(badgeIcon(e.hotspot, e.rank, on))
      e.badge?.setZIndexOffset(rankZ(e.rank, on))
      if (on) e.ring.bringToFront()
    }
    if (prevSelected.current !== selectedId) restyle(prevSelected.current, false)
    restyle(selectedId, true)
    prevSelected.current = selectedId
  }, [selectedId, hotspots])
}
