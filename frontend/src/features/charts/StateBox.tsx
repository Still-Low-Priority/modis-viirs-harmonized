import type { ReactNode } from 'react'
import { useT } from '../../i18n'
import { messages } from './messages'

interface Props {
  loading: boolean
  fetching: boolean
  error: boolean
  empty: boolean
  onRetry: () => void
  children: ReactNode
}

export function StateBox({ loading, fetching, error, empty, onRetry, children }: Props) {
  const t = useT(messages)
  if (loading) return <div className="charts-state"><div className="skeleton charts-skeleton" role="status" aria-label={t.loading} /></div>
  if (error) {
    return (
      <div className="charts-state" role="alert">
        <span className="muted">{t.loadError}</span>
        <button type="button" className="btn" onClick={onRetry}>{t.retry}</button>
      </div>
    )
  }
  if (empty) return <div className="charts-state"><span className="muted">{t.noData}</span></div>
  return <div className="charts-plot" data-fetching={fetching || undefined}>{children}</div>
}
