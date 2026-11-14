import { useQueries } from '@tanstack/react-query'
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useScopedHotspots } from '../../api/queries'
import type { Hotspot, Severity } from '../../api/types'
import { fmt, plural, useLang, useT } from '../../i18n'
import { SEVERITY_COLORS, sourceColor, sourceLabel } from '../../lib/colors'
import { formatCompact, formatCoord, formatFrp, formatNumber } from '../../lib/format'
import { nearestPlace, type NearestPlace } from '../../lib/geo'
import { addDays, daysBetween } from '../../lib/dates'
import { DEFAULT_MIN_COUNT, DEFAULT_RADIUS_KM, SEVERITY_ORDER, SEVERITY_RULES } from '../../lib/hotspots'
import { useStore } from '../../state/store'
import {
  SORTS,
  activeDaysText,
  coordKey,
  extentText,
  flyToBbox,
  periodText,
  placeLabel,
  severityTotals,
  sortHotspots,
  sourceShares,
  type HotspotSort,
} from './hotspotsModel'
import { messages, type HotspotsMessages } from './messages'
import './hotspots.css'

const LIST_LIMIT = 30
/** Period offered from the empty state: a week rarely holds a 10-detection cluster in a small country. */
const WIDE_PERIOD_DAYS = 90
const SKELETON_ROWS = 5

const SORT_LABEL: Record<HotspotSort, keyof HotspotsMessages> = {
  severity: 'sortSeverity',
  count: 'sortCount',
  frp: 'sortFrp',
  recent: 'sortRecent',
}

function ruleFor(severity: Severity) {
  return SEVERITY_RULES.find((r) => r.severity === severity)
}

/** Ranked critical fire zones for the selected place or the current map view. */
export function HotspotsPanel() {
  const t = useT(messages)
  const query = useScopedHotspots({ limit: LIST_LIMIT })
  const data = query.data
  const region = useStore((s) => s.region)
  const dateFrom = useStore((s) => s.dateFrom)
  const dateTo = useStore((s) => s.dateTo)
  const setDateRange = useStore((s) => s.setDateRange)
  const canWiden = daysBetween(dateFrom, dateTo) < WIDE_PERIOD_DAYS
  const [sort, setSort] = useState<HotspotSort>('severity')

  const items = data?.items ?? []
  const scope = { countryCode: region?.kind === 'country' ? region.countryCode : null }

  const labelQueries = useQueries({
    queries: items.map((h) => {
      const [lat, lon] = coordKey(h.lat, h.lon)
      return {
        queryKey: ['nearest-place', lat, lon],
        queryFn: () => nearestPlace(lat, lon),
        staleTime: Infinity,
        retry: false,
      }
    }),
  })
  const places = new Map<string, NearestPlace | null | undefined>()
  items.forEach((h, i) => places.set(h.id, labelQueries[i]?.data))

  let body: ReactNode
  if (data == null && query.error) {
    body = <ErrorState t={t} onRetry={() => void query.refetch()} />
  } else if (data == null) {
    body = <Skeleton label={t.loading} />
  } else if (items.length === 0) {
    body = (
      <div className="hotspots-state">
        <p>{t.empty}</p>
        <p className="muted">{fmt(t.emptyHint, { min: data.min_count, radius: data.radius_km })}</p>
        {canWiden && (
          <button type="button" className="btn" onClick={() => setDateRange(addDays(dateTo, 1 - WIDE_PERIOD_DAYS), dateTo)}>
            {fmt(t.widen, { n: WIDE_PERIOD_DAYS })}
          </button>
        )}
      </div>
    )
  } else {
    const ranked = sortHotspots(items, sort)
    body = (
      <>
        {query.error && <ErrorState t={t} onRetry={() => void query.refetch()} />}
        <HotspotList
          ranked={ranked}
          places={places}
          scope={scope}
          busy={query.isFetching && query.isPlaceholderData}
          t={t}
        />
        {data.total > items.length && (
          <p className="hotspots-more muted">{fmt(t.showing, { n: items.length, total: formatNumber(data.total, 'en') })}</p>
        )}
      </>
    )
  }

  return (
    <section className="hotspots">
      <ScopeHeader items={items} t={t} />
      {data?.approximate && <p className="hotspots-notice" role="note">{t.approximate}</p>}
      {items.length > 1 && (
        <div className="hotspots-seg" role="group" aria-label={t.sortBy}>
          {SORTS.map((s) => (
            <button key={s} type="button" className="btn hotspots-seg__btn" aria-pressed={sort === s} onClick={() => setSort(s)}>
              {t[SORT_LABEL[s]]}
            </button>
          ))}
        </div>
      )}
      {body}
      <HowDefined radiusKm={data?.radius_km} minCount={data?.min_count} t={t} />
    </section>
  )
}

function ScopeHeader({ items, t }: { items: Hotspot[]; t: HotspotsMessages }) {
  const region = useStore((s) => s.region)
  const setRegion = useStore((s) => s.setRegion)
  const dateFrom = useStore((s) => s.dateFrom)
  const dateTo = useStore((s) => s.dateTo)
  const showHotspots = useStore((s) => s.showHotspots)
  const setShowHotspots = useStore((s) => s.setShowHotspots)
  const totals = severityTotals(items)

  return (
    <header className="hotspots-head">
      <div className="hotspots-scope">
        <h2 className="hotspots-title">{region ? fmt(t.scopePlace, { place: region.name }) : t.scopeView}</h2>
        {region && (
          <button
            type="button"
            className="btn btn--ghost hotspots-clear"
            onClick={() => setRegion(null)}
            aria-label={fmt(t.clearPlaceLabel, { place: region.name })}
            title={t.clearPlace}
          >
            <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true">
              <path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
            </svg>
          </button>
        )}
      </div>
      <p className="hotspots-period muted">{periodText(dateFrom, dateTo)}</p>
      <div className="hotspots-headrow">
        <ul className="hotspots-totals" aria-label={t.totals}>
          {SEVERITY_ORDER.map((s) => (
            <li key={s} className="hotspots-total">
              <span className="hotspots-dot" style={{ background: SEVERITY_COLORS[s] }} aria-hidden="true" />
              <span className="mono">{totals[s]}</span> {t[s]}
            </li>
          ))}
        </ul>
        <label className="hotspots-switch">
          <input
            type="checkbox"
            role="switch"
            checked={showHotspots}
            onChange={(e) => setShowHotspots(e.target.checked)}
          />
          <span className="hotspots-switch__track" aria-hidden="true" />
          {t.showOnMap}
        </label>
      </div>
    </header>
  )
}

interface ListProps {
  ranked: ReturnType<typeof sortHotspots>
  places: Map<string, NearestPlace | null | undefined>
  scope: { countryCode: string | null }
  busy: boolean
  t: HotspotsMessages
}

function HotspotList({ ranked, places, scope, busy, t }: ListProps) {
  const lang = useLang()
  const selectedId = useStore((s) => s.selectedHotspotId)
  const refs = useRef(new Map<string, HTMLButtonElement>())

  // Keep the selected row visible, also when the selection comes from the map.
  useEffect(() => {
    if (!selectedId) return
    refs.current.get(selectedId)?.scrollIntoView?.({ block: 'nearest', behavior: 'smooth' })
  }, [selectedId])

  const choose = (h: Hotspot) => {
    const s = useStore.getState()
    s.selectHotspot(h.id)
    s.requestFlyTo(flyToBbox(h))
  }

  return (
    <ol className={`hotspots-list${busy ? ' hotspots-list--busy' : ''}`} aria-label={t.listLabel} aria-busy={busy}>
      {ranked.map(({ rank, hotspot: h }) => {
        const label = placeLabel(places.get(h.id), scope, t) ?? formatCoord(h.lat, h.lon)
        const shares = sourceShares(h.by_source)
        const sharesTitle = fmt(t.sensors, {
          list: shares.map((x) => `${sourceLabel(x.source)} ${Math.round(x.share * 100)}%`).join(', '),
        })
        const selected = h.id === selectedId
        return (
          <li key={h.id}>
            <button
              type="button"
              ref={(el) => {
                if (el) refs.current.set(h.id, el)
                else refs.current.delete(h.id)
              }}
              className="hotspots-row"
              aria-current={selected ? 'true' : undefined}
              onClick={() => choose(h)}
            >
              <span className="hotspots-rank mono" aria-label={fmt(t.rank, { n: rank })}>
                {rank}
              </span>
              <span className="hotspots-main">
                <span className="hotspots-line">
                  <span className={`hotspots-badge hotspots-badge--${h.severity}`} style={{ color: SEVERITY_COLORS[h.severity] }}>
                    {t[h.severity]}
                  </span>
                  <span className="hotspots-place">{label}</span>
                </span>
                <span className="hotspots-stats">
                  <span className="mono">{fmt(t.detections, { n: formatNumber(h.count, lang), word: plural(h.count, t.detection) })}</span>
                  <span className="mono" title={formatFrp(h.frp_sum, lang)}>
                    {fmt(t.frpTotal, { frp: `${formatCompact(h.frp_sum, lang)} MW` })}
                  </span>
                </span>
                <span className="hotspots-meta muted">
                  {extentText(h.radius_km, t)} · {activeDaysText(h, t)}
                </span>
                {shares.length > 0 && (
                  <span className="hotspots-sources" title={sharesTitle}>
                    <span className="sr-only">{sharesTitle}</span>
                    {shares.map((x) => (
                      <span key={x.source} style={{ flexGrow: x.count, background: sourceColor(x.source) }} aria-hidden="true" />
                    ))}
                  </span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

function Skeleton({ label }: { label: string }) {
  return (
    <div className="hotspots-skeleton" role="status" aria-label={label}>
      {Array.from({ length: SKELETON_ROWS }, (_, i) => (
        <div key={i} className="skeleton hotspots-skeleton__row" />
      ))}
    </div>
  )
}

function ErrorState({ t, onRetry }: { t: HotspotsMessages; onRetry: () => void }) {
  return (
    <div className="hotspots-state" role="alert">
      <p>{t.error}</p>
      <button type="button" className="btn" onClick={onRetry}>
        {t.retry}
      </button>
    </div>
  )
}

function HowDefined({ radiusKm, minCount, t }: { radiusKm?: number; minCount?: number; t: HotspotsMessages }) {
  const high = ruleFor('high')
  const critical = ruleFor('critical')
  const radius = radiusKm ?? DEFAULT_RADIUS_KM
  const min = minCount ?? DEFAULT_MIN_COUNT
  return (
    <details className="hotspots-how">
      <summary>{t.howTitle}</summary>
      <ul>
        <li>{fmt(t.howGroup, { radius })}</li>
        <li>{fmt(t.howMin, { min })}</li>
        {high && <li>{fmt(t.howHigh, { count: high.minCount, frp: formatNumber(high.minFrp, 'en') })}</li>}
        {critical && <li>{fmt(t.howCritical, { count: critical.minCount, frp: formatNumber(critical.minFrp, 'en') })}</li>}
        <li>{t.howOrder}</li>
      </ul>
    </details>
  )
}
