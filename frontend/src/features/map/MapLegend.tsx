import type { ReactNode } from 'react'
import { useId, useMemo, useState, useSyncExternalStore } from 'react'
import { useMeta } from '../../api/queries'
import type { DetectionFeature } from '../../api/types'
import { fmt, useLang, useT } from '../../i18n'
import { CONFIDENCE_COLORS, CONFIDENCE_ORDER, FRP_STOPS, HEAT_RAMP, SEVERITY_COLORS, sourceColor, sourceLabel } from '../../lib/colors'
import { SEVERITY_ORDER } from '../../lib/hotspots'
import { formatNumber } from '../../lib/format'
import type { ColorBy } from '../../state/store'
import { ChevronIcon } from './icons'
import type { GridData } from './useGridLayer'
import { messages } from './messages'

interface Item {
  color: string
  label: string
}

function useSensorItems(features: DetectionFeature[] | null): Item[] {
  const { data: meta } = useMeta()
  return useMemo(() => {
    const products = new Set<string>()
    if (features?.length) for (const f of features) products.add(f.properties.source_product)
    else for (const s of meta?.sources ?? []) products.add(s.source_product)
    // MODIS_NRT and MODIS_SP share a label and a colour: show them once.
    const byLabel = new Map<string, Item>()
    for (const p of [...products].sort()) {
      const label = sourceLabel(p)
      if (!byLabel.has(label)) byLabel.set(label, { label, color: sourceColor(p) })
    }
    return [...byLabel.values()]
  }, [features, meta])
}

const PHONE_QUERY = '(max-width: 599px)'

function subscribePhone(cb: () => void) {
  if (typeof window === 'undefined' || !window.matchMedia) return () => {}
  const mq = window.matchMedia(PHONE_QUERY)
  mq.addEventListener('change', cb)
  return () => mq.removeEventListener('change', cb)
}

function isPhone(): boolean {
  return typeof window !== 'undefined' && !!window.matchMedia && window.matchMedia(PHONE_QUERY).matches
}

/** True on phone-width screens (under 600px). */
function usePhone(): boolean {
  return useSyncExternalStore(subscribePhone, isPhone, () => false)
}

function DotList({ items, ring = false }: { items: Item[]; ring?: boolean }) {
  return (
    <ul className="map-legend__list">
      {items.map((it) => (
        <li key={it.label} className="map-legend__item">
          <span
            className={ring ? 'map-legend__ring' : 'map-legend__dot'}
            style={ring ? { borderColor: it.color } : { background: it.color }}
            aria-hidden="true"
          />
          {it.label}
        </li>
      ))}
    </ul>
  )
}

interface Props {
  colorBy: ColorBy
  features: DetectionFeature[] | null
  grid: GridData | null
  /** Add the severity entry for hotspot rings. */
  hotspots: boolean
}

/**
 * Legend for the active colour mode (or the heat ramp in grid mode), plus the
 * hotspot severities when rings are shown. Collapsible on phones, collapsed
 * there by default.
 */
export function MapLegend({ colorBy, features, grid, hotspots }: Props) {
  const t = useT(messages)
  const lang = useLang()
  const sensors = useSensorItems(features)
  const phone = usePhone()
  // null = not touched by the user: follow the screen size.
  const [userOpen, setUserOpen] = useState<boolean | null>(null)
  const open = !phone || (userOpen ?? false)
  const bodyId = useId()

  let main: ReactNode = null
  if (grid) {
    main = (
      <section>
        <div className="map-legend__title">
          {t.legendGrid}
          <span className="map-legend__sub">{fmt(t.legendGridCell, { cell: formatNumber(grid.cell, lang, 2) })}</span>
        </div>
        <div className="map-legend__ramp" style={{ background: `linear-gradient(90deg, ${HEAT_RAMP.slice(1).join(', ')})` }} />
        <div className="map-legend__ramp-labels mono">
          <span>{formatNumber(grid.min, lang)}</span>
          <span>{formatNumber(grid.max, lang)}</span>
        </div>
      </section>
    )
  } else {
    let title: string
    let items: Item[]
    if (colorBy === 'confidence') {
      title = t.legendConfidence
      items = CONFIDENCE_ORDER.map((c) => ({ color: CONFIDENCE_COLORS[c], label: t[`confidence_${c}`] }))
    } else if (colorBy === 'frp') {
      title = t.legendFrp
      items = FRP_STOPS.map((s, i) => {
        const next = FRP_STOPS[i + 1]
        return {
          color: s.color,
          label: next
            ? fmt(t.frpRange, { from: formatNumber(s.from, lang), to: formatNumber(next.from, lang) })
            : fmt(t.frpOver, { from: formatNumber(s.from, lang) }),
        }
      })
    } else {
      title = t.legendSensors
      items = sensors
    }
    if (items.length)
      main = (
        <section>
          <div className="map-legend__title">{title}</div>
          <DotList items={items} />
        </section>
      )
  }

  const severity = hotspots ? (
    <section>
      <div className="map-legend__title">{t.legendHotspots}</div>
      <DotList ring items={SEVERITY_ORDER.map((s) => ({ color: SEVERITY_COLORS[s], label: t[`severity_${s}`] }))} />
    </section>
  ) : null

  if (!main && !severity) return null
  return (
    <div className={`map-panel map-legend${open ? '' : ' map-legend--collapsed'}`} role="group" aria-label={t.legend}>
      {phone && (
        <button
          type="button"
          className="map-legend__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => setUserOpen(!open)}
        >
          <span>{open ? t.legendHide : t.legend}</span>
          <ChevronIcon up={!open} />
        </button>
      )}
      <div id={bodyId} className="map-legend__body" hidden={!open}>
        {main}
        {severity}
      </div>
    </div>
  )
}
