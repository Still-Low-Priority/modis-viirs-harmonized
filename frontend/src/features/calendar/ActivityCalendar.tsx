import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { useMeta, useTimeseries } from '../../api/queries'
import { fmt, plural, useLang, useT } from '../../i18n'
import { addDays } from '../../lib/dates'
import { heatColor } from '../../lib/colors'
import { formatDay, formatNumber } from '../../lib/format'
import { useStore } from '../../state/store'
import {
  buildWeeks,
  cellSize,
  clampRange,
  dayStatus,
  monthLabels,
  normalise,
  queryEnd,
  robustMax,
  yearEnd,
  yearOf,
  yearStart,
} from './layout'
import { messages } from './messages'
import './calendar.css'

const GAP = 2
const MIN_CELL = 9
const MAX_CELL = 16
const LABEL_W = 30
const PAD_X = 12
const LEGEND_STOPS = [0, 0.1, 0.3, 0.6, 1]
/** Touch: hold this long on a day to start a range selection instead of scrolling. */
const LONG_PRESS_MS = 350
/** Touch: finger travel (px) before the hold counts as a scroll. */
const MOVE_SLOP = 8
const SKELETON_DAYS = new Array<number>(7).fill(0)

interface Tip {
  day: string
  x: number
  y: number
  below: boolean
}

export function ActivityCalendar() {
  const t = useT(messages)
  const lang = useLang()
  const { data: meta } = useMeta()
  const dateFrom = useStore((s) => s.dateFrom)
  const dateTo = useStore((s) => s.dateTo)
  const setDateRange = useStore((s) => s.setDateRange)
  const regionName = useStore((s) => s.region?.name ?? null)

  const dateMin = meta?.date_min ?? null
  const dateMax = meta?.date_max ?? null
  const minYear = dateMin ? yearOf(dateMin) : null
  const maxYear = dateMax ? yearOf(dateMax) : null

  // Year follows the filter period, but can be browsed freely.
  const filterYear = yearOf(dateTo)
  const [rawYear, setRawYear] = useState(filterYear)
  const [seenFilterYear, setSeenFilterYear] = useState(filterYear)
  if (seenFilterYear !== filterYear) {
    setSeenFilterYear(filterYear)
    setRawYear(filterYear)
  }
  let year = rawYear
  if (minYear != null && maxYear != null) year = Math.min(maxYear, Math.max(minYear, year))

  const query = useTimeseries({
    interval: 'day',
    dateFrom: yearStart(year),
    dateTo: queryEnd(year, dateMax),
    enabled: meta != null,
  })
  const { data, isError, isPending, isFetching, isPlaceholderData, refetch } = query

  const weeks = useMemo(() => buildWeeks(year), [year])
  const months = useMemo(() => monthLabels(year), [year])

  const counts = useMemo(() => {
    const m = new Map<string, number>()
    if (data && !isPlaceholderData) for (const it of data.items) m.set(it.period, it.count)
    else if (data) for (const it of data.items) if (it.period.startsWith(`${year}-`)) m.set(it.period, it.count)
    return m
  }, [data, isPlaceholderData, year])
  const total = useMemo(() => {
    let s = 0
    for (const c of counts.values()) s += c
    return s
  }, [counts])
  // Keep the last settled total on screen (dimmed) while a refetch is running,
  // so the header never changes width.
  const settled = !!data && !isPlaceholderData
  const [shownTotal, setShownTotal] = useState<number | null>(null)
  if (settled && shownTotal !== total) setShownTotal(total)
  const max = useMemo(() => robustMax([...counts.values()]), [counts])

  // --- sizing ---
  const scrollRef = useRef<HTMLDivElement>(null)
  const rootRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState(600)
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    setWidth(el.clientWidth || 600)
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth || 600))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const cell = cellSize(width - LABEL_W - PAD_X * 2, weeks.length, GAP, MIN_CELL, MAX_CELL)

  // --- selection ---
  const [drag, setDrag] = useState<{ anchor: string; end: string } | null>(null)
  const dragRef = useRef(drag)
  dragRef.current = drag
  const lastClicked = useRef<string | null>(null)

  const commit = useCallback(
    (a: string, b: string) => {
      if (!dateMin || !dateMax) return
      const [from, to] = a <= b ? [a, b] : [b, a]
      const r = clampRange(from, to, dateMin, dateMax)
      if (r) setDateRange(r[0], r[1])
    },
    [dateMin, dateMax, setDateRange],
  )

  const select = (day: string, extend: boolean) => {
    if (dayStatus(day, dateMin, dateMax) === 'nodata') return
    const anchor = extend ? (lastClicked.current ?? dateFrom) : day
    if (!extend) lastClicked.current = day
    commit(anchor, day)
  }

  useEffect(() => {
    if (!drag) return
    const up = () => {
      const d = dragRef.current
      setDrag(null)
      setTouchSelecting(false)
      if (!d) return
      if (d.anchor === d.end) select(d.anchor, false)
      else commit(d.anchor, d.end)
    }
    const cancel = () => {
      setDrag(null)
      setTouchSelecting(false)
    }
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    return () => {
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag !== null, commit])

  const dayAt = (e: { clientX: number; clientY: number }): string | null => {
    const el = document.elementFromPoint(e.clientX, e.clientY)
    const d = el instanceof HTMLElement ? el.dataset.day : undefined
    return d ?? null
  }

  // Touch: scrolling is the default; a long press on a day starts a range selection.
  const press = useRef<{ day: string; x: number; y: number; timer: number } | null>(null)
  const [touchSelecting, setTouchSelecting] = useState(false)
  const clearPress = () => {
    if (press.current) window.clearTimeout(press.current.timer)
    press.current = null
  }
  useEffect(() => clearPress, [])
  // While a long-press selection is active, keep the browser from scrolling.
  useEffect(() => {
    const el = scrollRef.current
    if (!touchSelecting || !el) return
    const stop = (e: TouchEvent) => {
      if (e.cancelable) e.preventDefault()
    }
    el.addEventListener('touchmove', stop, { passive: false })
    return () => el.removeEventListener('touchmove', stop)
  }, [touchSelecting])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    const day = dayAt(e)
    if (!day || dayStatus(day, dateMin, dateMax) === 'nodata') return
    if (e.shiftKey) {
      select(day, true)
      return
    }
    if (e.pointerType === 'touch') {
      clearPress()
      const timer = window.setTimeout(() => {
        press.current = null
        setTouchSelecting(true)
        setDrag({ anchor: day, end: day })
      }, LONG_PRESS_MS)
      press.current = { day, x: e.clientX, y: e.clientY, timer }
      return
    }
    setDrag({ anchor: day, end: day })
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (!p || e.pointerType !== 'touch') return
    clearPress()
    select(p.day, false) // plain tap
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const p = press.current
    if (p && Math.hypot(e.clientX - p.x, e.clientY - p.y) > MOVE_SLOP) clearPress()
    if (!drag) return
    const day = dayAt(e)
    if (day && day !== drag.end) setDrag({ ...drag, end: day })
  }

  // --- focus + tooltip ---
  const [focusDay, setFocusDay] = useState<string | null>(null)
  const [tip, setTip] = useState<Tip | null>(null)
  const focusPending = useRef(false)
  const firstDay = useMemo(() => {
    const inYear = (d: string) => dayStatus(d, dateMin, dateMax) === 'data'
    const candidate = dateTo >= yearStart(year) && dateTo <= yearEnd(year) ? dateTo : yearStart(year)
    return inYear(candidate) ? candidate : yearStart(year)
  }, [dateTo, year, dateMin, dateMax])
  const tabDay = focusDay && focusDay.startsWith(`${year}-`) ? focusDay : firstDay

  useEffect(() => {
    if (!focusPending.current) return
    focusPending.current = false
    scrollRef.current?.querySelector<HTMLElement>(`[data-day="${tabDay}"]`)?.focus()
  }, [tabDay])

  const showTip = (day: string, el: HTMLElement) => {
    const root = rootRef.current
    if (!root) return
    const r = el.getBoundingClientRect()
    const rr = root.getBoundingClientRect()
    const x = Math.min(rr.width - 80, Math.max(80, r.left - rr.left + r.width / 2))
    const below = r.top - rr.top < 56
    setTip({ day, x, y: below ? r.bottom - rr.top + 4 : r.top - rr.top - 4, below })
  }

  const onKeyDown = (e: ReactKeyboardEvent<HTMLButtonElement>, day: string) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      select(day, e.shiftKey)
      return
    }
    const step: Record<string, number> = { ArrowUp: -1, ArrowDown: 1, ArrowLeft: -7, ArrowRight: 7 }
    let next: string | null = null
    if (e.key in step) next = addDays(day, step[e.key])
    else if (e.key === 'Home') next = yearStart(year)
    else if (e.key === 'End') next = yearEnd(year)
    if (!next) return
    e.preventDefault()
    if (next < yearStart(year) || next > yearEnd(year)) return
    focusPending.current = true
    setFocusDay(next)
  }

  // --- derived display ---
  const monthFmt = useMemo(() => new Intl.DateTimeFormat(lang, { month: 'short', timeZone: 'UTC' }), [lang])
  const monthLong = useMemo(() => new Intl.DateTimeFormat(lang, { month: 'long', timeZone: 'UTC' }), [lang])
  const weekdayLabels = useMemo(() => {
    const f = new Intl.DateTimeFormat(lang, { weekday: 'short', timeZone: 'UTC' })
    // 2024-01-01 is a Monday.
    return [0, 2, 4].map((i) => ({ row: i, text: f.format(new Date(Date.UTC(2024, 0, 1 + i))) }))
  }, [lang])

  const canPrev = minYear == null || year > minYear
  const canNext = maxYear == null || year < maxYear

  const inSelection = (day: string) => {
    if (drag) {
      const [a, b] = drag.anchor <= drag.end ? [drag.anchor, drag.end] : [drag.end, drag.anchor]
      return day >= a && day <= b
    }
    return day >= dateFrom && day <= dateTo
  }

  const gridStyle = {
    '--cal-cell': `${cell}px`,
    '--cal-gap': `${GAP}px`,
    '--cal-cols': weeks.length,
  } as React.CSSProperties

  const showEmpty = !!data && !isPlaceholderData && total === 0
  const showError = isError && !data
  const showSkeleton = (isPending || meta == null) && !showError

  const countText = (n: number) => fmt(t.count, { n: formatNumber(n, lang), unit: plural(n, t.detectionOne, t.detectionMany) })

  const dayLabel = (day: string) => {
    const date = formatDay(day, lang)
    if (dayStatus(day, dateMin, dateMax) === 'nodata') return fmt(t.cellNoData, { date })
    return fmt(t.cellLabel, { date, count: countText(counts.get(day) ?? 0) })
  }

  return (
    <section className="cal" ref={rootRef} aria-label={t.title} data-fetching={isFetching && !isPending ? 'true' : undefined}>
      <header className="cal-head">
        <div className="cal-titles">
          <h2 className="cal-title">{t.title}</h2>
          <span className="cal-scope muted">{regionName ? fmt(t.scopePlace, { place: regionName }) : t.scopeView}</span>
        </div>
        <div className="cal-years">
          <button type="button" className="btn btn--ghost cal-yearbtn" aria-label={t.prevYear} disabled={!canPrev} onClick={() => setRawYear(year - 1)}>
            ‹
          </button>
          <span className="cal-year mono">{year}</span>
          <button type="button" className="btn btn--ghost cal-yearbtn" aria-label={t.nextYear} disabled={!canNext} onClick={() => setRawYear(year + 1)}>
            ›
          </button>
        </div>
        <span className="cal-total muted mono" aria-live="polite" data-stale={settled ? undefined : 'true'}>
          {shownTotal != null ? countText(shownTotal) : ''}
        </span>
      </header>

      <div className="cal-scroll" ref={scrollRef}>
        {showError ? (
          <div className="cal-state" role="alert">
            <span>{t.error}</span>
            <button type="button" className="btn" onClick={() => void refetch()}>
              {t.retry}
            </button>
          </div>
        ) : showSkeleton ? (
          <div className="cal-body" style={gridStyle} aria-hidden="true">
            <div className="cal-months" />
            <div className="cal-grid">
              {weeks.map((_, c) => (
                <div className="cal-col" key={c}>
                  {SKELETON_DAYS.map((_, r) => (
                    <span className="cal-cell skeleton" key={r} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="cal-body" style={gridStyle}>
            <div className="cal-months">
              {months.map((m) => (
                <button
                  type="button"
                  key={m.month}
                  className="cal-month"
                  style={{ left: LABEL_W + m.col * (cell + GAP) }}
                  aria-label={fmt(t.selectMonth, { month: monthLong.format(new Date(Date.UTC(2024, m.month, 1))), year })}
                  onClick={() => {
                    if (dateMin && dateMax) commit(m.from, m.to)
                  }}
                >
                  {monthFmt.format(new Date(Date.UTC(2024, m.month, 1)))}
                </button>
              ))}
            </div>
            <div className="cal-main">
              <div className="cal-weekdays" aria-hidden="true">
                {weekdayLabels.map((w) => (
                  <span key={w.row} style={{ top: w.row * (cell + GAP) }}>
                    {w.text}
                  </span>
                ))}
              </div>
              <div
                className="cal-grid"
                role="grid"
                aria-label={fmt(t.gridLabel, { year })}
                aria-busy={isFetching}
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={clearPress}
                onContextMenu={(e) => {
                  if (press.current || touchSelecting) e.preventDefault()
                }}
                data-touch-selecting={touchSelecting ? 'true' : undefined}
                onPointerLeave={() => setTip(null)}
              >
                {weeks.map((col, c) => (
                  <div className="cal-col" role="row" key={c}>
                    {col.map((day, r) => {
                      if (!day) return <span className="cal-cell cal-cell--void" key={r} />
                      const nodata = dayStatus(day, dateMin, dateMax) === 'nodata'
                      const count = counts.get(day) ?? 0
                      const cls = ['cal-cell', nodata ? 'cal-cell--nodata' : '', inSelection(day) ? 'cal-cell--sel' : ''].filter(Boolean).join(' ')
                      return (
                        <button
                          type="button"
                          role="gridcell"
                          key={r}
                          className={cls}
                          data-day={day}
                          style={nodata ? undefined : { background: heatColor(normalise(count, max)) }}
                          tabIndex={day === tabDay ? 0 : -1}
                          aria-label={dayLabel(day)}
                          aria-disabled={nodata || undefined}
                          aria-selected={inSelection(day)}
                          onKeyDown={(e) => onKeyDown(e, day)}
                          onPointerEnter={(e) => showTip(day, e.currentTarget)}
                          onFocus={(e) => {
                            setFocusDay(day)
                            showTip(day, e.currentTarget)
                          }}
                          onBlur={() => setTip(null)}
                        />
                      )
                    })}
                  </div>
                ))}
              </div>
            </div>
            {showEmpty && <div className="cal-empty">{fmt(t.empty, { year })}</div>}
          </div>
        )}
      </div>

      <footer className="cal-legend" aria-hidden="true">
        <span className="cal-legend-item">
          <i className="cal-swatch cal-cell--nodata" /> {t.noData}
        </span>
        <span className="cal-legend-item">
          {t.less}
          {LEGEND_STOPS.map((s) => (
            <i key={s} className="cal-swatch" style={{ background: heatColor(s) }} />
          ))}
          {t.more}
        </span>
      </footer>

      {tip && (
        <div className="cal-tip" data-below={tip.below ? 'true' : undefined} style={{ left: tip.x, top: tip.y }} role="tooltip">
          <strong>{formatDay(tip.day, lang)}</strong>
          <span>
            {dayStatus(tip.day, dateMin, dateMax) === 'nodata' ? t.noData : countText(counts.get(tip.day) ?? 0)}
          </span>
        </div>
      )}
    </section>
  )
}
