import { Bar, BarChart, CartesianGrid, Cell, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { useMeta, useTimeseries } from '../../api/queries'
import { useLang, useT } from '../../i18n'
import { clampDay } from '../../lib/dates'
import { formatCompact, formatFrp, formatNumber } from '../../lib/format'
import { sourceColor, sourceLabel } from '../../lib/colors'
import { useStore } from '../../state/store'
import { TipBox, type TipLine, type TipProps } from './ChartTooltip'
import { StateBox } from './StateBox'
import { messages } from './messages'
import { sourceKeys, stackedData, yearlyRows, yearOverlaps, type YearRow } from './transform'
import { AXIS_TICK, GRID_STROKE, ACCENT } from './style'

interface TickProps {
  x?: number
  y?: number
  payload?: { value: string }
}

/** Year label under the axis. Selected years are bold, light and underlined with the accent colour. */
function YearTick({ x = 0, y = 0, payload, rows, dateFrom, dateTo }: TickProps & { rows: readonly YearRow[]; dateFrom: string; dateTo: string }) {
  const year = payload?.value ?? ''
  const partial = rows.find((r) => r.year === year)?.partial
  const on = yearOverlaps(year, dateFrom, dateTo)
  return (
    <g transform={`translate(${x},${y})`}>
      <text y={12} textAnchor="middle" fill={on ? '#fff' : AXIS_TICK.fill} fontSize={AXIS_TICK.fontSize} fontWeight={on ? 700 : 400}>
        {partial ? `${year}*` : year}
      </text>
      {on && <rect x={-13} y={18} width={26} height={2} rx={1} fill={ACCENT} />}
    </g>
  )
}

type Row = Record<string, number | string | boolean>

export function YearTab({ metric, animate }: { metric: 'count' | 'frp'; animate: boolean }) {
  const t = useT(messages)
  const lang = useLang()
  const meta = useMeta()
  const dateFrom = useStore((s) => s.dateFrom)
  const dateTo = useStore((s) => s.dateTo)
  const setDateRange = useStore((s) => s.setDateRange)
  const min = meta.data?.date_min ?? null
  const max = meta.data?.date_max ?? null
  const q = useTimeseries({ interval: 'year', groupBySource: true, dateFrom: min ?? undefined, dateTo: max ?? undefined, enabled: !!min && !!max })

  const items = q.data?.items
  const rows = items && min && max ? yearlyRows(items, min, max) : []
  const keys = sourceKeys(rows)
  const data = stackedData(rows, keys)
  const selectedYears = rows.filter((r) => yearOverlaps(r.year, dateFrom, dateTo)).map((r) => r.year)
  const hasData = rows.some((r) => r.count > 0)

  const pick = (year: string) => {
    if (!min || !max) return
    setDateRange(clampDay(`${year}-01-01`, min, max), clampDay(`${year}-12-31`, min, max))
  }

  const tip = ({ active, payload }: TipProps) => {
    const row = payload?.[0]?.payload as Row | undefined
    if (!active || !row) return null
    const year = String(row.year)
    const partial = row.partial === true
    const lines: TipLine[] =
      metric === 'frp'
        ? [{ label: t.frpTotal, value: formatFrp(Number(row.frp), lang) }]
        : [...keys].reverse().map((k) => ({ color: sourceColor(k), label: sourceLabel(k), value: formatNumber(Number(row[k]), lang) }))
    if (metric === 'count' && keys.length !== 1) lines.push({ label: t.total, value: formatNumber(Number(row.count), lang) })
    return <TipBox title={partial ? `${year} (${t.partialYear})` : year} lines={lines} footer={t.clickYear} />
  }

  return (
    <StateBox loading={q.isPending && !!min} fetching={q.isFetching} error={q.isError} onRetry={() => void q.refetch()} empty={!!q.data && !hasData}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: 0 }} barCategoryGap="18%">
          <CartesianGrid vertical={false} stroke={GRID_STROKE} strokeWidth={1} />
          <XAxis
            dataKey="year"
            tickLine={false}
            axisLine={{ stroke: GRID_STROKE }}
            interval="preserveStartEnd"
            tick={<YearTick rows={rows} dateFrom={dateFrom} dateTo={dateTo} />}
          />
          {selectedYears.length > 0 && (
            <ReferenceArea x1={selectedYears[0]} x2={selectedYears[selectedYears.length - 1]} fill={ACCENT} fillOpacity={0.1} stroke="none" ifOverflow="visible" />
          )}
          <YAxis tick={AXIS_TICK} tickLine={false} axisLine={false} width={42} tickFormatter={(v: number) => formatCompact(v, lang)} />
          <Tooltip content={tip} cursor={{ fill: 'rgb(255 255 255 / 0.05)' }} isAnimationActive={false} />
          {(metric === 'frp' ? ['frp'] : keys).map((k, si, arr) => (
            <Bar
              key={k}
              dataKey={k}
              stackId="y"
              fill={k === 'frp' ? ACCENT : sourceColor(k)}
              isAnimationActive={animate}
              cursor="pointer"
              onClick={(_d, i) => pick(rows[i].year)}
              radius={si === arr.length - 1 ? [2, 2, 0, 0] : 0}
            >
              {rows.map((r) => (
                <Cell
                  key={r.year}
                  stroke={r.partial ? '#fff' : 'none'}
                  strokeOpacity={0.7}
                  strokeDasharray={r.partial ? '3 2' : undefined}
                  strokeWidth={r.partial ? 1 : 0}
                />
              ))}
            </Bar>
          ))}
        </BarChart>
      </ResponsiveContainer>
      {rows.some((r) => r.partial) && <div className="charts-note">{t.partialNote}</div>}
    </StateBox>
  )
}
