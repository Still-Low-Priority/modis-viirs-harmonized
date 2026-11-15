import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { ApiError } from '../../api/http'
import { FIRMS_PRODUCTS, MAX_INGESTION_DAYS, firmsRequestCount, isNearRealTime, toIngestionBbox } from '../../api/ingestion'
import { useApiMode, useBackendHealth, useCreateIngestionJob, useIngestionJob } from '../../api/queries'
import type { Bbox } from '../../api/types'
import { fmt, plural, useLang, useT } from '../../i18n'
import { sourceColor, sourceLabel } from '../../lib/colors'
import { daysBetween, isValidDay, todayUtc } from '../../lib/dates'
import { formatDateTimeUtc, formatDay } from '../../lib/format'
import { useStore } from '../../state/store'
import './ingestion.css'
import { clearJobs, isExpired, pushJob, readJobs, type StoredJob } from './jobs'
import { messages } from './messages'

type Messages = (typeof messages)['en']
type Tone = 'idle' | 'busy' | 'ok' | 'bad'

const NRT = FIRMS_PRODUCTS.filter(isNearRealTime)
const SP = FIRMS_PRODUCTS.filter((p) => !isNearRealTime(p))

/** Longitude span in degrees, also for a box that crosses the antimeridian. */
function lonSpan(b: Bbox): number {
  return b[0] <= b[2] ? b[2] - b[0] : 360 - b[0] + b[2]
}

function formatBbox(b: Bbox): string {
  const lat = (n: number) => `${Math.abs(n).toFixed(2)}°${n < 0 ? 'S' : 'N'}`
  const lon = (n: number) => `${Math.abs(n).toFixed(2)}°${n < 0 ? 'W' : 'E'}`
  return `${lat(b[1])} – ${lat(b[3])}, ${lon(b[0])} – ${lon(b[2])}`
}

function describeError(e: unknown, t: Messages): string {
  if (e instanceof ApiError) {
    if (e.status === 422) return fmt(t.errInvalid, { detail: e.message })
    if (e.status === 503) return t.errQueue
    return fmt(t.errOther, { detail: e.message })
  }
  return fmt(t.errOther, { detail: e instanceof Error ? e.message : String(e) })
}

/** Sidebar tab: start a FIRMS ingestion job on the backend and follow its status. */
export function IngestionPanel() {
  const t = useT(messages)
  const lang = useLang()
  const uid = useId()
  const demo = useApiMode() === 'mock'
  const health = useBackendHealth()
  const create = useCreateIngestionJob()

  const filterFrom = useStore((s) => s.dateFrom)
  const filterTo = useStore((s) => s.dateTo)
  const region = useStore((s) => s.region)
  const viewBbox = useStore((s) => s.viewBbox)

  const [source, setSource] = useState<string>(FIRMS_PRODUCTS[0])
  const [from, setFrom] = useState(filterFrom)
  const [to, setTo] = useState(filterTo)
  const [jobs, setJobs] = useState(readJobs)

  const rawBbox = region?.bbox ?? viewBbox
  const bbox = rawBbox ? toIngestionBbox(rawBbox) : null
  const today = todayUtc()

  const datesOk = isValidDay(from) && isValidDay(to) && from <= to
  const days = datesOk ? daysBetween(from, to) : 0

  let problem: string | null = null
  if (!rawBbox) problem = t.areaWaiting
  else if (!bbox) problem = t.areaInvalid
  else if (!datesOk) problem = t.badDates
  else if (to > today) problem = t.future
  else if (days > MAX_INGESTION_DAYS) problem = fmt(t.tooLong, { max: MAX_INGESTION_DAYS, n: days })

  const online = health.isSuccess
  const offline = health.isError
  const canStart = !problem && !offline && !create.isPending

  function onSubmit(e: FormEvent) {
    e.preventDefault()
    if (!canStart || !bbox) return
    const [west, south, east, north] = bbox
    create.mutate(
      { source, west, south, east, north, start_date: from, end_date: to },
      {
        onSuccess: (accepted) =>
          setJobs(
            pushJob({
              taskId: accepted.task_id,
              source,
              bbox,
              startDate: from,
              endDate: to,
              place: region?.name ?? null,
              submittedAt: new Date().toISOString(),
            }),
          ),
      },
    )
  }

  const requests = bbox && days > 0 ? firmsRequestCount(bbox, days) : 0
  const big = bbox != null && lonSpan(bbox) * (bbox[3] - bbox[1]) > 3000

  return (
    <div className="ingest">
      <p className="ingest-intro">{t.intro}</p>
      {demo ? <p className="ingest-note muted">{t.demoNote}</p> : null}

      <p className="ingest-backend" role="status">
        <span className="label ingest-backend__label">{t.backend}</span>
        <span className="badge" data-tone={online ? 'ok' : offline ? 'bad' : 'busy'}>
          <i className="ingest-dot" aria-hidden="true" />
          {online ? t.online : offline ? t.offline : t.checking}
        </span>
      </p>

      <form className="ingest-form" onSubmit={onSubmit} noValidate>
        <div>
          <label className="label" htmlFor={`${uid}-source`}>
            {t.product}
          </label>
          <div className="ingest-select">
            <i className="ingest-swatch" style={{ background: sourceColor(source) }} aria-hidden="true" />
            <select id={`${uid}-source`} className="field" value={source} onChange={(e) => setSource(e.target.value)}>
              <optgroup label={t.nrt}>
                {NRT.map((p) => (
                  <option key={p} value={p}>
                    {sourceLabel(p)}
                  </option>
                ))}
              </optgroup>
              <optgroup label={t.sp}>
                {SP.map((p) => (
                  <option key={p} value={p}>
                    {sourceLabel(p)}
                  </option>
                ))}
              </optgroup>
            </select>
          </div>
          <p className="ingest-hint muted">
            <span className="mono">{source}</span>. {isNearRealTime(source) ? t.nrtHint : t.spHint}
          </p>
        </div>

        <fieldset className="ingest-fieldset">
          <legend className="label">{t.period}</legend>
          <div className="ingest-dates">
            <div>
              <label className="label" htmlFor={`${uid}-from`}>
                {t.from}
              </label>
              <input id={`${uid}-from`} className="field" type="date" value={from} max={today} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor={`${uid}-to`}>
                {t.to}
              </label>
              <input id={`${uid}-to`} className="field" type="date" value={to} max={today} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>
          <button
            type="button"
            className="btn btn--ghost ingest-link"
            disabled={from === filterFrom && to === filterTo}
            onClick={() => {
              setFrom(filterFrom)
              setTo(filterTo)
            }}
          >
            {t.useFilters}
          </button>
        </fieldset>

        <div>
          <span className="label">{t.area}</span>
          <p className="ingest-area">
            <span>{region ? fmt(t.areaPlace, { place: region.name }) : t.areaView}</span>
            {bbox ? <span className="mono muted ingest-area__box">{formatBbox(bbox)}</span> : null}
          </p>
          {big ? <p className="ingest-hint muted">{t.areaWorld}</p> : null}
        </div>

        {problem ? (
          <p className="ingest-problem" role="status">
            {problem}
          </p>
        ) : (
          <p className="ingest-hint muted">
            {fmt(t.days, { n: days, unit: plural(days, t.unitDay, t.unitDays) })}.{' '}
            {fmt(t.cost, { n: requests, unit: plural(requests, t.unitRequest, t.unitRequests) })}
          </p>
        )}

        <button type="submit" className="btn ingest-submit" disabled={!canStart}>
          {create.isPending ? t.starting : t.start}
        </button>
        {offline ? <p className="ingest-hint muted">{t.offlineHint}</p> : null}
        {create.isError ? (
          <p className="ingest-error" role="alert">
            {describeError(create.error, t)}
          </p>
        ) : null}
      </form>

      <section className="ingest-jobs" aria-labelledby={`${uid}-jobs`}>
        <div className="ingest-jobs__head">
          <h2 id={`${uid}-jobs`} className="label ingest-jobs__title">
            {t.jobs}
          </h2>
          {jobs.length > 0 ? (
            <button type="button" className="btn btn--ghost ingest-link" onClick={() => setJobs(clearJobs())}>
              {t.clear}
            </button>
          ) : null}
        </div>
        {jobs.length === 0 ? (
          <p className="ingest-hint muted">{t.noJobs}</p>
        ) : (
          <ul className="ingest-list">
            {jobs.map((job) => (
              <JobItem key={job.taskId} job={job} t={t} lang={lang} />
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function JobItem({ job, t, lang }: { job: StoredJob; t: Messages; lang: ReturnType<typeof useLang> }) {
  const expired = isExpired(job)
  const query = useIngestionJob(job.taskId, !expired)
  const status = query.data?.status

  // New detections are in the database: the map, the calendar and the charts
  // (and the available date range) are stale now.
  // Jobs restored from an earlier visit finished long ago; only a job seen
  // going from running to SUCCESS in this session triggers a refresh.
  const queryClient = useQueryClient()
  const wasRunning = useRef(false)
  useEffect(() => {
    if (status && status !== 'SUCCESS') wasRunning.current = true
    if (status !== 'SUCCESS' || !wasRunning.current) return
    wasRunning.current = false
    void queryClient.invalidateQueries({ predicate: (q) => q.queryKey[0] !== 'health' && q.queryKey[0] !== 'ingestion-job' })
  }, [status, queryClient])

  let label: string
  let tone: Tone
  let hint: string | null = null
  if (expired) {
    label = t.statusUnknown
    tone = 'idle'
    hint = t.unknownHint
  } else if (!status && query.isError) {
    label = t.statusLost
    tone = 'bad'
    hint = t.lostHint
  } else if (status === 'SUCCESS') {
    label = t.statusDone
    tone = 'ok'
  } else if (status === 'FAILURE') {
    label = t.statusFailed
    tone = 'bad'
    hint = t.failedHint
  } else if (status === 'REVOKED') {
    label = t.statusCancelled
    tone = 'idle'
  } else if (status === 'STARTED') {
    label = t.statusRunning
    tone = 'busy'
  } else if (status === 'RETRY') {
    label = t.statusRetry
    tone = 'busy'
  } else {
    label = t.statusQueued
    tone = 'busy'
  }

  const days = daysBetween(job.startDate, job.endDate)
  const period = job.startDate === job.endDate ? formatDay(job.startDate, lang) : `${formatDay(job.startDate, lang)} – ${formatDay(job.endDate, lang)}`

  return (
    <li className="ingest-job">
      <div className="ingest-job__top">
        <span className="ingest-job__source">
          <i className="ingest-swatch" style={{ background: sourceColor(job.source) }} aria-hidden="true" />
          <span>{sourceLabel(job.source)}</span>
        </span>
        <span className="badge" data-tone={tone} role="status">
          <i className="ingest-dot" aria-hidden="true" />
          {label}
        </span>
      </div>
      <p className="ingest-job__line">
        {period} · {fmt(t.days, { n: days, unit: plural(days, t.unitDay, t.unitDays) })}
      </p>
      <p className="ingest-job__line muted">{job.place ?? formatBbox(job.bbox)}</p>
      <p className="ingest-job__line muted">
        <span className="mono">{job.source}</span> · {fmt(t.started, { when: formatDateTimeUtc(job.submittedAt, lang) })}
      </p>
      {hint ? <p className="ingest-job__hint">{hint}</p> : null}
    </li>
  )
}
