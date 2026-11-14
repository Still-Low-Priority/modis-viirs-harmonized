import type { ReactNode } from 'react'

export interface TipLine {
  color?: string
  label: string
  value: string
}

export function TipBox({ title, lines, footer }: { title: string; lines: TipLine[]; footer?: ReactNode }) {
  return (
    <div className="charts-tip">
      <div className="charts-tip__title">{title}</div>
      {lines.map((l) => (
        <div key={l.label} className="charts-tip__row">
          {l.color && <span className="charts-tip__dot" style={{ background: l.color }} />}
          <span className="charts-tip__label">{l.label}</span>
          <span className="charts-tip__value mono">{l.value}</span>
        </div>
      ))}
      {footer && <div className="charts-tip__foot">{footer}</div>}
    </div>
  )
}

/** Minimal shape of what recharts passes to a tooltip `content` renderer. */
export interface TipProps {
  active?: boolean
  payload?: ReadonlyArray<{ payload?: unknown }>
}
