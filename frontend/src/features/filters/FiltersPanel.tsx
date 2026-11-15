import { useId } from 'react'
import { processingKinds, useFullMeta, useMeta } from '../../api/queries'
import type { Confidence, DayNight, Processing } from '../../api/types'
import { fmt, plural, useT } from '../../i18n'
import { sourceColor, sourceLabel } from '../../lib/colors'
import { addDays, clampDay, daysBetween, isValidDay } from '../../lib/dates'
import { defaultRange, useStore } from '../../state/store'
import './filters.css'
import { messages } from './messages'
import { Segmented } from './Segmented'

const PRESETS = [
  { days: 1, key: 'preset1' },
  { days: 7, key: 'preset7' },
  { days: 30, key: 'preset30' },
  { days: 90, key: 'preset90' },
  { days: 365, key: 'preset365' },
] as const

export function FiltersPanel() {
  const t = useT(messages)
  const uid = useId()
  const meta = useMeta()
  const kinds = processingKinds(useFullMeta().data)

  const dateFrom = useStore((s) => s.dateFrom)
  const dateTo = useStore((s) => s.dateTo)
  const sources = useStore((s) => s.sources)
  const daynight = useStore((s) => s.daynight)
  const minConfidence = useStore((s) => s.minConfidence)
  const processing = useStore((s) => s.processing)
  const setProcessing = useStore((s) => s.setProcessing)
  const region = useStore((s) => s.region)
  const setRegion = useStore((s) => s.setRegion)
  const setDateRange = useStore((s) => s.setDateRange)
  const setSources = useStore((s) => s.setSources)
  const setDaynight = useStore((s) => s.setDaynight)
  const setMinConfidence = useStore((s) => s.setMinConfidence)
  const resetFilters = useStore((s) => s.resetFilters)

  const dateMin = meta.data?.date_min ?? null
  const dateMax = meta.data?.date_max ?? null
  const allSources = meta.data?.sources ?? []
  const allIds = allSources.map((s) => s.source_product)

  const clamp = (day: string) => (dateMin && dateMax ? clampDay(day, dateMin, dateMax) : day)

  function onDate(which: 'from' | 'to', value: string) {
    if (!isValidDay(value)) return
    const day = clamp(value)
    if (which === 'from') setDateRange(day, dateTo)
    else setDateRange(dateFrom, day)
  }

  function presetRange(days: number): [string, string] | null {
    if (!dateMax) return null
    const from = addDays(dateMax, -(days - 1))
    return [dateMin ? clampDay(from, dateMin, dateMax) : from, dateMax]
  }

  // Sensors: [] in the store means "all"; the UI shows every box checked then.
  const selected = sources.length ? sources : allIds
  function toggleSource(id: string) {
    const next = selected.includes(id) ? selected.filter((x) => x !== id) : allIds.filter((x) => x === id || selected.includes(x))
    if (next.length === 0) return
    setSources(next.length >= allIds.length ? [] : next)
  }

  const defaults = dateMax ? presetRange(7) : null
  const def = defaults ? { dateFrom: defaults[0], dateTo: defaults[1] } : defaultRange()
  const isDefault =
    dateFrom === def.dateFrom &&
    dateTo === def.dateTo &&
    sources.length === 0 &&
    daynight === null &&
    minConfidence === null

  function reset() {
    resetFilters()
    // resetFilters assumes "yesterday"; follow the data instead.
    if (defaults) setDateRange(defaults[0], defaults[1])
  }

  const length = daysBetween(dateFrom, dateTo)

  const dnOptions: { value: DayNight | null; label: string }[] = [
    { value: null, label: t.dnAll },
    { value: 'D', label: t.dnDay },
    { value: 'N', label: t.dnNight },
  ]
  const kindOptions: { value: Processing; label: string }[] = [
    { value: 'NRT', label: t.kindNrt },
    { value: 'SP', label: t.kindSp },
  ]
  const confOptions: { value: Confidence | null; label: string }[] = [
    { value: null, label: t.confAny },
    { value: 'nominal', label: t.confNominal },
    { value: 'high', label: t.confHigh },
  ]

  return (
    <div className="filters">
      {region ? (
        <div className="filters-scope" role="status">
          <span>{fmt(t.scope, { place: region.name })}</span>
          <button type="button" className="btn btn--ghost filters-preset" onClick={() => setRegion(null)}>
            {t.clearScope}
          </button>
        </div>
      ) : null}

      {meta.isError ? (
        <div className="filters-error" role="alert">
          <span>{t.loadError}</span>
          <button type="button" className="btn" onClick={() => void meta.refetch()}>
            {t.retry}
          </button>
        </div>
      ) : null}

      {/* Only when the backend holds both kinds; with one, the app is already on it. */}
      {kinds.length > 1 ? (
        <fieldset className="filters-section">
          <legend>{t.kind}</legend>
          <Segmented label={t.kind} options={kindOptions} value={processing} onChange={setProcessing} />
          <p className="filters-note muted">{processing === 'NRT' ? t.kindNrtNote : t.kindSpNote}</p>
        </fieldset>
      ) : null}

      <fieldset className="filters-section">
        <legend>{t.period}</legend>
        <div className="filters-dates">
          <div>
            <label className="label" htmlFor={`${uid}-from`}>
              {t.from}
            </label>
            <input
              id={`${uid}-from`}
              className="field"
              type="date"
              value={dateFrom}
              min={dateMin ?? undefined}
              max={dateMax ?? undefined}
              onChange={(e) => onDate('from', e.target.value)}
            />
          </div>
          <div>
            <label className="label" htmlFor={`${uid}-to`}>
              {t.to}
            </label>
            <input
              id={`${uid}-to`}
              className="field"
              type="date"
              value={dateTo}
              min={dateMin ?? undefined}
              max={dateMax ?? undefined}
              onChange={(e) => onDate('to', e.target.value)}
            />
          </div>
        </div>
        <div className="filters-presets" role="group" aria-label={t.presetLabel}>
          {PRESETS.map((p) => {
            const r = presetRange(p.days)
            return (
              <button
                key={p.days}
                type="button"
                className="btn filters-preset"
                disabled={!r}
                aria-pressed={!!r && r[0] === dateFrom && r[1] === dateTo}
                onClick={() => r && setDateRange(r[0], r[1])}
              >
                {t[p.key]}
              </button>
            )
          })}
        </div>
        <p className="filters-length muted">{fmt(t.length, { n: length, unit: plural(length, t.unitDay, t.unitDays) })}</p>
      </fieldset>

      <fieldset className="filters-section">
        <legend className="filters-legend--row">
          <span>{t.sensors}</span>
          <button type="button" className="btn btn--ghost filters-preset" disabled={sources.length === 0} onClick={() => setSources([])}>
            {t.selectAll}
          </button>
        </legend>
        {meta.isLoading ? (
          <div className="filters-skel" aria-hidden="true">
            <div className="skeleton" style={{ height: 28 }} />
            <div className="skeleton" style={{ height: 28 }} />
            <div className="skeleton" style={{ height: 28 }} />
          </div>
        ) : (
          <>
            <ul className="filters-sources">
              {allSources.map((s) => {
                const checked = selected.includes(s.source_product)
                const sub = [s.instrument, ...s.satellites].join(' · ')
                return (
                  <li key={s.source_product}>
                    <label className="filters-source">
                      <span className="filters-source__dot" style={{ background: sourceColor(s.source_product) }} aria-hidden="true" />
                      <span className="filters-source__text">
                        <span>{sourceLabel(s.source_product)}</span>
                        <span className="filters-source__sub">{sub}</span>
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={checked && selected.length === 1}
                        onChange={() => toggleSource(s.source_product)}
                      />
                    </label>
                  </li>
                )
              })}
            </ul>
            {allSources.length > 1 && selected.length === 1 ? <p className="filters-note muted">{t.sensorsHint}</p> : null}
          </>
        )}
      </fieldset>

      <fieldset className="filters-section">
        <legend>{t.daynight}</legend>
        <Segmented label={t.daynight} options={dnOptions} value={daynight} onChange={setDaynight} />
      </fieldset>

      <fieldset className="filters-section">
        <legend>{t.confidence}</legend>
        <Segmented label={t.confidence} options={confOptions} value={minConfidence} onChange={setMinConfidence} />
        <p className="filters-note muted">{t.confNote}</p>
      </fieldset>

      <div>
        <button type="button" className="btn filters-reset" disabled={isDefault} onClick={reset}>
          {t.reset}
        </button>
        <p className="filters-note muted">{t.resetNote}</p>
      </div>

      <footer className="filters-foot">
        {t.credit}
        <a href="https://firms.modaps.eosdis.nasa.gov/" target="_blank" rel="noopener">
          NASA FIRMS
        </a>
        . {t.timesUtc}
      </footer>
    </div>
  )
}
