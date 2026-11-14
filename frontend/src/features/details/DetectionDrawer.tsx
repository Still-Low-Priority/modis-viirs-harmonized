import { useEffect, useRef, useState } from 'react'
import { ApiError } from '../../api/http'
import { useDetection, useScopedHotspots } from '../../api/queries'
import type { DetectionDetail, Hotspot } from '../../api/types'
import { fmt, useLang, useT } from '../../i18n'
import { CONFIDENCE_COLORS, FRP_STOPS, SEVERITY_COLORS, frpColor, sourceColor, sourceLabel } from '../../lib/colors'
import { haversineKm } from '../../lib/hotspots'
import { formatCoord, formatDateTimeUtc, formatFrp, formatNumber } from '../../lib/format'
import { useStore } from '../../state/store'
import './details.css'
import { messages } from './messages'

type Msgs = (typeof messages)['en']

const FRP_MAX = 150
const ZOOM_D = 0.15

function Icon({ children }: { children: React.ReactNode }) {
  return (
    <svg className="details-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  )
}

const SunIcon = () => (
  <Icon>
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </Icon>
)
const MoonIcon = () => (
  <Icon>
    <path d="M21 12.8A9 9 0 1 1 11.2 3 7 7 0 0 0 21 12.8z" />
  </Icon>
)

const BackIcon = () => (
  <Icon>
    <path d="M15 5l-7 7 7 7" />
  </Icon>
)

/** Hotspot this detection belongs to: the highlighted one, else the first whose circle contains the point. */
function useParentHotspot(d: DetectionDetail): { rank: number; hotspot: Hotspot } | null {
  const selectedHotspotId = useStore((s) => s.selectedHotspotId)
  const items = useScopedHotspots({ limit: 30 }).data?.items ?? []
  let index = selectedHotspotId ? items.findIndex((h) => h.id === selectedHotspotId) : -1
  if (index < 0) index = items.findIndex((h) => haversineKm(d.latitude, d.longitude, h.lat, h.lon) <= h.radius_km)
  return index < 0 ? null : { rank: index + 1, hotspot: items[index] }
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="details-section">
      <h3 className="label">{title}</h3>
      {children}
    </section>
  )
}

function frpGradient(): string {
  const stops = FRP_STOPS.map((s) => `${s.color} ${Math.min(100, (s.from / FRP_MAX) * 100)}%`)
  return `linear-gradient(90deg, ${stops.join(', ')})`
}

function typeLabel(t: Msgs, n: number): string {
  const known: Record<number, string> = { 0: t.type0, 1: t.type1, 2: t.type2, 3: t.type3 }
  return known[n] ?? fmt(t.typeUnknown, { n })
}

function CopyCoords({ text }: { text: string }) {
  const t = useT(messages)
  const [state, setState] = useState<'idle' | 'ok' | 'fail'>('idle')
  const timer = useRef<number | undefined>(undefined)
  useEffect(() => () => window.clearTimeout(timer.current), [])

  async function copy() {
    let ok = false
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text)
        ok = true
      }
    } catch {
      ok = false
    }
    setState(ok ? 'ok' : 'fail')
    window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => setState('idle'), 1800)
  }

  return (
    <>
      <button type="button" className="btn btn--ghost" onClick={() => void copy()} aria-label={t.copy} title={t.copy}>
        <Icon>
          <rect x="9" y="9" width="11" height="11" rx="2" />
          <path d="M5 15V6a2 2 0 0 1 2-2h9" />
        </Icon>
      </button>
      <span className="details-copied" role="status">
        {state === 'ok' ? t.copied : state === 'fail' ? t.copyFailed : ''}
      </span>
    </>
  )
}

function Content({ d }: { d: DetectionDetail }) {
  const t = useT(messages)
  const lang = useLang()
  const requestFlyTo = useStore((s) => s.requestFlyTo)
  const selectHotspot = useStore((s) => s.selectHotspot)
  const setSidebarTab = useStore((s) => s.setSidebarTab)
  const parent = useParentHotspot(d)
  const coords = formatCoord(d.latitude, d.longitude)
  const night = d.daynight === 'N'
  const brightness: [string, number | null][] = [
    [t.brightness, d.brightness],
    [t.brightT31, d.bright_t31],
    [t.brightTi4, d.bright_ti4],
    [t.brightTi5, d.bright_ti5],
  ]
  const isModis = /^\d+$/.test(d.confidence_raw.trim())
  const isViirs = /^[lnh]$/i.test(d.confidence_raw.trim())
  const rawNote = isModis ? t.rawModis : isViirs ? t.rawViirs : t.rawOther
  const level = t[`level_${d.confidence}`]
  const frpPos = Math.max(0, Math.min(100, (d.frp / FRP_MAX) * 100))

  return (
    <>
      <Section title={t.secWhen}>
        <dl className="details-rows">
          <Row label={t.acquired}>{formatDateTimeUtc(d.acquired_at, lang)}</Row>
          <Row label={t.dayNight}>
            <span className="details-inline">
              {night ? <MoonIcon /> : <SunIcon />}
              {night ? t.night : t.day}
            </span>
          </Row>
          {parent && (
            <Row label={t.partOfHotspot}>
              <span className="details-inline">
                <span>{fmt(t.hotspotRank, { rank: parent.rank })}</span>
                <span className="details-sev" style={{ color: SEVERITY_COLORS[parent.hotspot.severity] }}>
                  {t[parent.hotspot.severity]}
                </span>
                <button
                  type="button"
                  className="btn"
                  onClick={() => {
                    selectHotspot(parent.hotspot.id)
                    setSidebarTab('hotspots')
                  }}
                >
                  {t.showHotspot}
                </button>
              </span>
            </Row>
          )}
          <Row label={t.coords}>
            <span className="details-inline">
              <span className="mono">{coords}</span>
              <CopyCoords text={`${d.latitude}, ${d.longitude}`} />
            </span>
          </Row>
        </dl>
        <div className="details-actions">
          <button
            type="button"
            className="btn"
            onClick={() => requestFlyTo([d.longitude - ZOOM_D, d.latitude - ZOOM_D, d.longitude + ZOOM_D, d.latitude + ZOOM_D])}
          >
            {t.zoom}
          </button>
        </div>
      </Section>

      <Section title={t.secIntensity}>
        <dl className="details-rows">
          <Row label={t.frp}>
            <span className="mono" style={{ color: frpColor(d.frp) }}>
              {formatFrp(d.frp, lang)}
            </span>
          </Row>
        </dl>
        <div className="details-frpbar" style={{ background: frpGradient() }} role="img" aria-label={t.frpScale}>
          <span className="details-frpbar__marker" style={{ left: `${frpPos}%` }} />
        </div>
        <dl className="details-rows">
          {brightness
            .filter((b): b is [string, number] => b[1] != null)
            .map(([label, v]) => (
              <Row key={label} label={label}>
                <span className="mono">{fmt(t.kelvin, { value: formatNumber(v, lang, 1) })}</span>
              </Row>
            ))}
        </dl>
      </Section>

      <Section title={t.secConfidence}>
        <dl className="details-rows">
          <Row label={t.harmonised}>
            <span className="details-pill" style={{ background: CONFIDENCE_COLORS[d.confidence] }}>
              {level}
            </span>
          </Row>
          <Row label={t.rawValue}>
            <span className="mono">{isModis ? `${d.confidence_raw.trim()}%` : d.confidence_raw}</span>
          </Row>
        </dl>
        <p className="details-note">{rawNote}</p>
      </Section>

      <Section title={t.secTechnical}>
        <dl className="details-rows">
          <Row label={t.pixel}>
            <span className="mono">{fmt(t.pixelValue, { scan: formatNumber(d.scan, lang, 2), track: formatNumber(d.track, lang, 2) })}</span>
          </Row>
          <Row label={t.type}>{typeLabel(t, d.detection_type)}</Row>
          <Row label={t.version}>
            <span className="mono">{d.version}</span>
          </Row>
          <Row label={t.recordId}>
            <span className="mono">{d.id}</span>
          </Row>
        </dl>
        <a
          className="details-link"
          href={`https://www.google.com/maps?q=${d.latitude},${d.longitude}`}
          target="_blank"
          rel="noopener noreferrer"
        >
          {t.maps}
        </a>
      </Section>
    </>
  )
}

function Skeleton() {
  return (
    <div aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="skeleton details-skel" style={{ width: i % 3 === 2 ? '55%' : '100%' }} />
      ))}
    </div>
  )
}

function Drawer({ id }: { id: number }) {
  const t = useT(messages)
  const select = useStore((s) => s.select)
  const q = useDetection(id)
  const headingRef = useRef<HTMLHeadingElement>(null)
  // Last loaded record, so switching points does not flash an empty panel.
  const [last, setLast] = useState<DetectionDetail | null>(null)
  if (q.data && last !== q.data) setLast(q.data)

  useEffect(() => {
    headingRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') select(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [select])

  const shown = q.data ?? last
  const failed = q.isError
  const notFound = failed && q.error instanceof ApiError && q.error.status === 404

  let body
  if (failed) {
    body = (
      <div className="details-message">
        <p>{notFound ? t.notFound : t.error}</p>
        {!notFound && (
          <button type="button" className="btn" onClick={() => void q.refetch()}>
            {t.retry}
          </button>
        )}
      </div>
    )
  } else if (shown) {
    body = <Content d={shown} />
  } else {
    body = <Skeleton />
  }

  const head = !failed ? shown : null
  return (
    <aside className="details-drawer" role="complementary" aria-label={t.title}>
      <div className="details-top">
        <button type="button" className="btn btn--ghost details-back" onClick={() => select(null)}>
          <BackIcon />
          {t.back}
        </button>
      </div>
      <div className="details-head">
        {head && <span className="details-dot" style={{ background: sourceColor(head.source_product) }} />}
        <div className="details-head__text">
          <h2 className="details-title" ref={headingRef} tabIndex={-1}>
            {head ? sourceLabel(head.source_product) : t.title}
          </h2>
          {head && <p className="details-sub">{fmt(t.satellite, { name: head.satellite })}</p>}
        </div>
      </div>
      <div className="details-body" aria-busy={!failed && q.isFetching && shown?.id !== id}>
        {body}
      </div>
    </aside>
  )
}

export function DetectionDrawer() {
  const selectedId = useStore((s) => s.selectedId)
  if (selectedId == null) return null
  return <Drawer id={selectedId} />
}
