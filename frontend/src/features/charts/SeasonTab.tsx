import { Area, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useMeta, useTimeseries } from '../../api/queries'
import { fmt, useLang, useT } from '../../i18n'
import { clampDay } from '../../lib/dates'
import { formatCompact, formatNumber } from '../../lib/format'
import { useStore } from '../../state/store'
import { TipBox, type TipProps } from './ChartTooltip'
import { StateBox } from './StateBox'
import { messages } from './messages'
import { monthRange, seasonality, type SeasonRow } from './transform'
import { AXIS_TICK, BAND, CURRENT, GRID_STROKE } from './style'

function monthName(m: number): string {
  return new Intl.DateTimeFormat('en-GB', { month: 'short', timeZone: 'UTC' }).format(new Date(Date.UTC(2001, m - 1, 1)))
}

type PlotRow = SeasonRow & { band: [number, number] | null; name: string }

export function SeasonTab({ animate }: { animate: boolean }) {
  const t = useT(messages)
  const lang = useLang()
  const meta = useMeta()
  const dateTo = useStore((s) => s.dateTo)
  const setDateRange = useStore((s) => s.setDateRange)
  const min = meta.data?.date_min ?? null
  const max = meta.data?.date_max ?? null
  const q = useTimeseries({ interval: 'month', dateFrom: min ?? undefined, dateTo: max ?? undefined, enabled: !!min && !!max })

  const year = Number(clampDay(dateTo, min ?? dateTo, max ?? dateTo).slice(0, 4))
  const rows: PlotRow[] =
    q.data && min && max
      ? seasonality(q.data.items, min, max, year).map((r) => ({
          ...r,
          band: r.min != null && r.max != null ? [r.min, r.max] : null,
          name: monthName(r.month),
        }))
      : []
  const hasData = !!q.data && q.data.items.some((i) => i.count > 0)

  const pick = (month: number) => {
    if (!min || !max) return
    const [a, b] = monthRange(year, month)
    setDateRange(clampDay(a, min, max), clampDay(b, min, max))
  }

  const tip = ({ active, payload }: TipProps) => {
    const r = payload?.[0]?.payload as PlotRow | undefined
    if (!active || !r) return null
    const lines = [{ color: CURRENT, label: fmt(t.yearLine, { year }), value: r.current == null ? '—' : formatNumber(r.current, lang) }]
    if (r.avg != null && r.min != null && r.max != null) {
      lines.push({ color: BAND, label: `${t.average} (${fmt(t.avgOver, { n: r.years })})`, value: formatNumber(r.avg, lang) })
      lines.push({ color: BAND, label: t.range, value: `${formatNumber(r.min, lang)}–${formatNumber(r.max, lang)}` })
    }
    return <TipBox title={`${r.name} ${year}`} lines={lines} footer={t.clickMonth} />
  }

  return (
    <StateBox loading={q.isPending && !!min} fetching={q.isFetching} error={q.isError} onRetry={() => void q.refetch()} empty={!!q.data && !hasData}>
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart
          data={rows}
          margin={{ top: 6, right: 12, bottom: 0, left: 0 }}
          style={{ cursor: 'pointer' }}
          onClick={(s) => {
            const i = Number(s?.activeTooltipIndex)
            if (Number.isInteger(i) && rows[i]) pick(rows[i].month)
          }}
        >
          <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeWidth={1} />
          <XAxis dataKey="name" tick={AXIS_TICK} tickLine={false} axisLine={{ stroke: GRID_STROKE }} interval="preserveStartEnd" />
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={42} tickFormatter={(v: number) => formatCompact(v, lang)} />
          <Tooltip content={tip} isAnimationActive={false} cursor={{ stroke: GRID_STROKE }} />
          <Area dataKey="band" stroke="none" fill={BAND} fillOpacity={0.16} isAnimationActive={animate} activeDot={false} connectNulls />
          <Line dataKey="avg" stroke={BAND} strokeWidth={1.5} strokeDasharray="4 3" dot={false} activeDot={false} isAnimationActive={animate} connectNulls />
          <Line
            dataKey="current"
            stroke={CURRENT}
            strokeWidth={2.5}
            dot={{ r: 3, fill: CURRENT, strokeWidth: 0 }}
            activeDot={{ r: 5, fill: CURRENT, stroke: '#fff', strokeWidth: 1 }}
            isAnimationActive={animate}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </StateBox>
  )
}
