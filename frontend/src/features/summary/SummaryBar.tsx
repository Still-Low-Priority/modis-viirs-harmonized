import { useMemo, useRef, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useTimeseries } from '../../api/queries'
import type { Interval, TimeseriesItem } from '../../api/types'
import { fmt, plural, useLang, useT } from '../../i18n'
import type { Lang } from '../../i18n'
import { sourceColor, sourceLabel } from '../../lib/colors'
import { formatDay, formatNumber } from '../../lib/format'
import { useStore } from '../../state/store'
import { chartGeometry, chooseInterval, periodDays, periodRange, stepIndex, summarize } from './aggregate'
import type { DayRange } from './aggregate'
import { messages } from './messages'
import './summary.css'

// The shape of the string decides the format, not the requested interval:
// while a new interval is loading, the previous response is still on screen.
function formatPeriod(period: string, lang: Lang): string {
  if (period.length === 10) return formatDay(period, lang)
  if (period.length === 7) return formatDay(`${period}-01`, lang, { month: 'short', year: 'numeric' })
  return period
}

function formatRange(from: string, to: string, lang: Lang): string {
  if (from === to) return formatDay(from, lang)
  const sameYear = from.slice(0, 4) === to.slice(0, 4)
  const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7)
  const start = sameMonth
    ? formatDay(from, lang, { day: 'numeric' })
    : sameYear
      ? formatDay(from, lang, { day: 'numeric', month: 'short' })
      : formatDay(from, lang)
  return `${start} – ${formatDay(to, lang)}`
}

/** "MODIS (Terra / Aqua)" -> "MODIS"; "VIIRS NOAA-20" stays. */
function shortSourceLabel(source: string): string {
  return sourceLabel(source).replace(/\s*\(.*\)\s*$/, '')
}

const VIEW_H = 30
const HEADROOM = 0.74

interface ChartProps {
  items: TimeseriesItem[]
  interval: Interval
  lang: Lang
  peakIndex: number
  onPick: (period: string) => void
}

function DetectionsChart({ items, interval, lang, peakIndex, onPick }: ChartProps) {
  const t = useT(messages)
  const [hover, setHover] = useState<number | null>(null)
  const [focus, setFocus] = useState<number | null>(null)
  const raw = hover ?? focus
  const active = raw != null && raw < items.length ? raw : null
  const intervalName = interval === 'day' ? t.intervalDay : interval === 'month' ? t.intervalMonth : t.intervalYear
  const geo = useMemo(() => chartGeometry(items.map((i) => i.count), items.length * 10, VIEW_H * HEADROOM), [items])
  const n = items.length

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      setFocus(stepIndex(active, e.key === 'ArrowRight' ? 1 : -1, n))
    } else if (e.key === 'Home' || e.key === 'End') {
      e.preventDefault()
      setFocus(e.key === 'Home' ? 0 : n - 1)
    } else if ((e.key === 'Enter' || e.key === ' ') && active != null) {
      e.preventDefault()
      onPick(items[active].period)
    }
  }

  const activeItem = active != null ? items[active] : null
  const readout = activeItem
    ? fmt(t.readout, {
        period: formatPeriod(activeItem.period, lang),
        count: formatNumber(activeItem.count, lang),
        unit: plural(activeItem.count, t.detection, t.detections),
        frp: formatNumber(activeItem.frp_sum, lang, 1),
      })
    : n > 1
      ? t.chartHint
      : ''

  const peak = peakIndex >= 0 ? items[peakIndex] : null
  const peakPos = peak ? ((peakIndex + 0.5) / n) * 100 : 0
  const peakAlign = peakPos < 14 ? 'start' : peakPos > 86 ? 'end' : 'mid'

  return (
    <div className="summary-plot">
      <div className="summary-axis" aria-hidden="true">
        <span className="summary-num">{formatNumber(geo.max, lang)}</span>
        <span className="summary-num">0</span>
      </div>
      <div
        className="summary-chart"
        role="group"
        tabIndex={0}
        aria-label={fmt(t.chartLabel, { interval: intervalName })}
        aria-describedby="summary-readout"
        onKeyDown={onKeyDown}
        onFocus={() => setFocus((f) => f ?? (peakIndex >= 0 ? peakIndex : n - 1))}
        onBlur={() => setFocus(null)}
        onMouseLeave={() => setHover(null)}
      >
        <svg className="summary-bars" viewBox={`0 0 ${n * 10} ${VIEW_H}`} preserveAspectRatio="none" aria-hidden="true">
          <line className="summary-guide" x1="0" x2={n * 10} y1={VIEW_H - 1 - VIEW_H * HEADROOM} y2={VIEW_H - 1 - VIEW_H * HEADROOM} />
          <line className="summary-base" x1="0" x2={n * 10} y1={VIEW_H - 0.5} y2={VIEW_H - 0.5} />
          {geo.bars.map((b, i) => (
            <rect
              key={items[i].period}
              className={i === active ? 'summary-bar summary-bar--active' : 'summary-bar'}
              x={b.x}
              width={b.width}
              y={VIEW_H - 1 - b.height}
              height={b.height}
            />
          ))}
        </svg>
        <div className="summary-slots">
          {items.map((it, i) => (
            <span
              key={it.period}
              className="summary-slot"
              data-period={it.period}
              onMouseEnter={() => setHover(i)}
              onClick={() => onPick(it.period)}
            />
          ))}
        </div>
        {peak && (
          <span className={`summary-peak summary-peak--${peakAlign}`} style={{ left: `${peakPos}%` }} aria-hidden="true">
            <span className="summary-num">{formatNumber(peak.count, lang)}</span>
            <i />
          </span>
        )}
      </div>
      <div id="summary-readout" className="summary-readout" aria-live="polite">
        {readout}
      </div>
    </div>
  )
}

function Skeleton({ scope, period }: { scope: React.ReactNode; period: React.ReactNode }) {
  const t = useT(messages)
  return (
    <div className="summary" role="region" aria-label={t.region} aria-busy="true">
      <div className="summary-scope">{scope}{period}</div>
      <div className="summary-block summary-block--chart">
        <span className="skeleton summary-skel" />
        <span className="skeleton summary-skel summary-skel--chart" />
      </div>
      <div className="summary-block summary-block--frp">
        <span className="skeleton summary-skel" />
        <span className="skeleton summary-skel summary-skel--lg" />
      </div>
      <div className="summary-block summary-block--sensors">
        <span className="skeleton summary-skel" />
        <span className="skeleton summary-skel summary-skel--bar" />
      </div>
    </div>
  )
}

export function SummaryBar() {
  const t = useT(messages)
  const lang = useLang()
  const dateFrom = useStore((s) => s.dateFrom)
  const dateTo = useStore((s) => s.dateTo)
  const setDateRange = useStore((s) => s.setDateRange)
  const region = useStore((s) => s.region)
  const setRegion = useStore((s) => s.setRegion)
  const days = periodDays(dateFrom, dateTo)
  const q = useTimeseries({ interval: chooseInterval(days), groupBySource: true })
  const data = q.data
  const summary = useMemo(() => (data ? summarize(data.items) : null), [data])
  const peakIndex = useMemo(
    () => (data && summary?.peak ? data.items.findIndex((i) => i.period === summary.peak?.period) : -1),
    [data, summary],
  )
  const [back, setBack] = useState<{ prev: DayRange; applied: DayRange } | null>(null)
  const [tip, setTip] = useState<{ x: number; y: number } | null>(null)
  const frpRef = useRef<HTMLSpanElement>(null)

  const showTip = () => {
    const r = frpRef.current?.getBoundingClientRect()
    if (r) setTip({ x: r.left, y: r.bottom + 6 })
  }

  const pick = (period: string) => {
    const range = periodRange(period)
    if (range.from === dateFrom && range.to === dateTo) return
    setBack({ prev: { from: dateFrom, to: dateTo }, applied: range })
    setDateRange(range.from, range.to)
  }

  const scopeName = region ? region.name : t.scopeView
  const scope = (
    <div className="summary-scope__name">
      <span className="summary-scope__text" title={scopeName}>
        {scopeName}
      </span>
      {region && (
        <button type="button" className="summary-clear" aria-label={t.clearPlace} title={t.clearPlace} onClick={() => setRegion(null)}>
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M2 2l8 8M10 2l-8 8" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" fill="none" />
          </svg>
        </button>
      )}
    </div>
  )
  const periodEl = (
    <div className="summary-scope__period">
      {fmt(t.period, { from: formatRange(dateFrom, dateTo, lang), days, unit: plural(days, t.day, t.days) })}
    </div>
  )

  if (q.isError && !summary) {
    return (
      <div className="summary" role="region" aria-label={t.region}>
        <div className="summary-scope">{scope}{periodEl}</div>
        <div className="summary-error" role="alert">
          <span>{t.error}</span>
          <button type="button" className="btn" onClick={() => void q.refetch()}>
            {t.retry}
          </button>
        </div>
      </div>
    )
  }

  if (!summary || !data) return <Skeleton scope={scope} period={periodEl} />

  const stale = q.isFetching
  const interval = data.interval
  const intervalName = interval === 'day' ? t.intervalDay : interval === 'month' ? t.intervalMonth : t.intervalYear
  const showBack = back != null && back.applied.from === dateFrom && back.applied.to === dateTo

  return (
    <div className="summary" role="region" aria-label={t.region} aria-busy={stale} data-stale={stale || undefined}>
      <div className="summary-scope">{scope}{periodEl}</div>
      {q.isError && (
        <div className="summary-error summary-error--inline" role="alert">
          <span>{t.error}</span>
          <button type="button" className="btn" onClick={() => void q.refetch()}>
            {t.retry}
          </button>
        </div>
      )}
      {showBack && back && (
        <button
          type="button"
          className="btn summary-back"
          onClick={() => {
            setDateRange(back.prev.from, back.prev.to)
            setBack(null)
          }}
        >
          <svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true">
            <path d="M7.5 2L3.5 6l4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" fill="none" />
          </svg>
          {fmt(t.back, { period: formatRange(back.prev.from, back.prev.to, lang) })}
        </button>
      )}
      {summary.total === 0 ? (
        <div className="summary-empty muted">{fmt(t.empty, { scope: region ? region.name : t.scopeViewInline })}</div>
      ) : (
        <>
          <div className="summary-block summary-block--chart">
            <div className="summary-caption">
              <span className="summary-caption__text">{fmt(t.chartCaption, { interval: intervalName })}</span>
              <b className="summary-num summary-total" title={formatNumber(summary.total, lang)}>
                {formatNumber(summary.total, lang)}
              </b>
            </div>
            <DetectionsChart items={data.items} interval={interval} lang={lang} peakIndex={peakIndex} onPick={pick} />
          </div>
          <div className="summary-block summary-block--frp">
            <span className="summary-label">{t.totalFrp}</span>
            <span
              ref={frpRef}
              className="summary-frp"
              tabIndex={0}
              aria-describedby="summary-frp-help"
              onMouseEnter={showTip}
              onMouseLeave={() => setTip(null)}
              onFocus={showTip}
              onBlur={() => setTip(null)}
            >
              <b className="summary-num summary-frp__value">{formatNumber(summary.frpTotal, lang)}</b>
              <small>{t.frpUnit}</small>
            </span>
            <span id="summary-frp-help" role="tooltip" className={tip ? 'summary-tip summary-tip--on' : 'summary-tip'} style={tip ? { left: tip.x, top: tip.y } : undefined}>
              {t.frpHelp}
            </span>
          </div>
          <div className="summary-block summary-block--sensors">
            <span className="summary-label">{t.sensors}</span>
            <div
              className="summary-split"
              role="img"
              aria-label={summary.sources.map((s) => `${shortSourceLabel(s.source)} ${formatNumber(s.percent, lang)}%`).join(', ')}
            >
              {summary.sources.map((s) => (
                <span
                  key={s.source}
                  className="summary-split__seg"
                  style={{ flexGrow: s.count, background: sourceColor(s.source) }}
                  title={`${sourceLabel(s.source)}: ${formatNumber(s.percent, lang, 1)}% (${formatNumber(s.count, lang)})`}
                />
              ))}
            </div>
            <ul className="summary-legend">
              {summary.sources.map((s) => (
                <li key={s.source} title={`${sourceLabel(s.source)}: ${formatNumber(s.count, lang)}`}>
                  <i style={{ background: sourceColor(s.source) }} />
                  {shortSourceLabel(s.source)} <b className="summary-num">{formatNumber(s.percent, lang)}%</b>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}
    </div>
  )
}
