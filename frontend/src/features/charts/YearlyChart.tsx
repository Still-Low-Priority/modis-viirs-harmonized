import { useId, useRef, useState, useSyncExternalStore, type KeyboardEvent } from 'react'
import { useMeta } from '../../api/queries'
import { useT, fmt } from '../../i18n'
import { sourceColor, sourceLabel } from '../../lib/colors'
import { useStore } from '../../state/store'
import { SeasonTab } from './SeasonTab'
import { YearTab } from './YearTab'
import { messages } from './messages'
import './charts.css'

type Tab = 'year' | 'season'
type Metric = 'count' | 'frp'
const TABS: Tab[] = ['year', 'season']

const REDUCED = '(prefers-reduced-motion: reduce)'
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (cb) => {
      const m = window.matchMedia(REDUCED)
      m.addEventListener('change', cb)
      return () => m.removeEventListener('change', cb)
    },
    () => window.matchMedia(REDUCED).matches,
    () => false,
  )
}

export function YearlyChart() {
  const t = useT(messages)
  const uid = useId()
  const [tab, setTab] = useState<Tab>('year')
  const [metric, setMetric] = useState<Metric>('count')
  const reduced = useReducedMotion()
  const regionName = useStore((s) => s.region?.name ?? null)
  const sources = useMeta().data?.sources ?? []
  const refs = useRef<Record<Tab, HTMLButtonElement | null>>({ year: null, season: null })
  const label: Record<Tab, string> = { year: t.tabYear, season: t.tabSeason }

  const onKey = (e: KeyboardEvent) => {
    const i = TABS.indexOf(tab)
    let next = i
    if (e.key === 'ArrowRight') next = (i + 1) % TABS.length
    else if (e.key === 'ArrowLeft') next = (i + TABS.length - 1) % TABS.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = TABS.length - 1
    else return
    e.preventDefault()
    setTab(TABS[next])
    refs.current[TABS[next]]?.focus()
  }

  return (
    <section className="charts" aria-label={t.title}>
      <header className="charts-head">
        <div className="charts-titles">
          <h2 className="charts-title">{t.title}</h2>
          <span className="charts-sub muted">{regionName ? fmt(t.subtitlePlace, { place: regionName }) : t.subtitleView}</span>
        </div>
        <div className="charts-tabs" role="tablist" aria-label={t.tabsLabel} onKeyDown={onKey}>
          {TABS.map((id) => (
            <button
              key={id}
              ref={(el) => {
                refs.current[id] = el
              }}
              type="button"
              role="tab"
              id={`${uid}-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`${uid}-panel`}
              tabIndex={tab === id ? 0 : -1}
              className="charts-tab"
              onClick={() => setTab(id)}
            >
              {label[id]}
            </button>
          ))}
        </div>
        {tab === 'year' && metric === 'count' && sources.length > 0 && (
          <ul className="charts-legend" aria-label={t.legendLabel}>
            {sources.map((s) => (
              <li key={s.source_product} className="charts-legend__item">
                <span className="charts-legend__dot" style={{ background: sourceColor(s.source_product) }} aria-hidden="true" />
                {sourceLabel(s.source_product)}
              </li>
            ))}
          </ul>
        )}
        {tab === 'year' && (
          <div className="charts-metric" role="group" aria-label={t.metricLabel}>
            <button type="button" className="charts-seg" aria-pressed={metric === 'count'} onClick={() => setMetric('count')}>
              {t.metricCount}
            </button>
            <button type="button" className="charts-seg" aria-pressed={metric === 'frp'} onClick={() => setMetric('frp')}>
              {t.metricFrp}
            </button>
          </div>
        )}
      </header>
      <div className="charts-body" role="tabpanel" id={`${uid}-panel`} aria-labelledby={`${uid}-tab-${tab}`}>
        {tab === 'year' ? <YearTab metric={metric} animate={!reduced} /> : <SeasonTab animate={!reduced} />}
      </div>
    </section>
  )
}
