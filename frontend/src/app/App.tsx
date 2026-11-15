import { lazy, Suspense, useEffect } from 'react'
import { processingKinds, useFullMeta, useMeta } from '../api/queries'
import { ActivityCalendar } from '../features/calendar/ActivityCalendar'
import { DetectionDrawer } from '../features/details/DetectionDrawer'
import { Header } from '../features/header/Header'
import { MapView } from '../features/map/MapView'
import { Sidebar } from '../features/sidebar/Sidebar'
import { SummaryBar } from '../features/summary/SummaryBar'
import { clampDay } from '../lib/dates'
import { defaultRange, useStore } from '../state/store'
import { ErrorBoundary } from './ErrorBoundary'
import './app.css'

// recharts is the heaviest dependency and sits below the fold: load it separately.
const YearlyChart = lazy(() => import('../features/charts/YearlyChart').then((m) => ({ default: m.YearlyChart })))

export default function App() {
  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const bottomOpen = useStore((s) => s.bottomOpen)
  const { data: meta } = useMeta()
  const { data: fullMeta } = useFullMeta()

  // The backend may hold only archive data (or only recent data): start there.
  useEffect(() => {
    const kinds = processingKinds(fullMeta)
    const { processing, setProcessing } = useStore.getState()
    if (kinds.length > 0 && !kinds.includes(processing)) setProcessing(kinds[0])
  }, [fullMeta])

  // Once we know which days have data, move the default period onto them.
  useEffect(() => {
    if (!meta?.date_min || !meta.date_max) return
    const { dateFrom, dateTo, setDateRange } = useStore.getState()
    if (dateTo > meta.date_max || dateFrom < meta.date_min) {
      const fresh = defaultRange(meta.date_max)
      setDateRange(clampDay(fresh.dateFrom, meta.date_min, meta.date_max), fresh.dateTo)
    }
  }, [meta])

  return (
    <div className="app" data-sidebar={sidebarOpen ? 'open' : 'closed'} data-bottom={bottomOpen ? 'open' : 'closed'}>
      <header className="app__header">
        <ErrorBoundary name="Header">
          <Header />
        </ErrorBoundary>
      </header>
      <aside className="app__sidebar">
        <ErrorBoundary name="Sidebar">
          <Sidebar />
        </ErrorBoundary>
      </aside>
      <main className="app__main">
        <div className="app__summary">
          <ErrorBoundary name="Summary">
            <SummaryBar />
          </ErrorBoundary>
        </div>
        <div className="app__map">
          <ErrorBoundary name="Map">
            <MapView />
          </ErrorBoundary>
        </div>
        <section className="app__bottom">
          <div className="app__panel">
            <ErrorBoundary name="Calendar">
              <ActivityCalendar />
            </ErrorBoundary>
          </div>
          <div className="app__panel">
            <ErrorBoundary name="Charts">
              <Suspense fallback={<div className="skeleton app-panel-skeleton" />}>
                <YearlyChart />
              </Suspense>
            </ErrorBoundary>
          </div>
        </section>
      </main>
      <ErrorBoundary name="Details">
        <DetectionDrawer />
      </ErrorBoundary>
    </div>
  )
}
