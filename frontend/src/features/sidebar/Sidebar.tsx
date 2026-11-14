import { ErrorBoundary } from '../../app/ErrorBoundary'
import { useT } from '../../i18n'
import { useStore, type SidebarTab } from '../../state/store'
import { FiltersPanel } from '../filters/FiltersPanel'
import { HotspotsPanel } from '../hotspots/HotspotsPanel'
import { messages } from './messages'
import './sidebar.css'

const TABS: SidebarTab[] = ['hotspots', 'filters']

/** Left column: two tabs, "Hotspots" (ranked critical zones) and "Filters". */
export function Sidebar() {
  const t = useT(messages)
  const tab = useStore((s) => s.sidebarTab)
  const setTab = useStore((s) => s.setSidebarTab)
  const close = () => useStore.getState().setSidebarOpen(false)

  return (
    <div className="sidebar">
      <div className="sidebar-head">
        <div className="sidebar-tabs" role="tablist" aria-label={t.tabs}>
          {TABS.map((id) => (
            <button
              key={id}
              type="button"
              role="tab"
              id={`sidebar-tab-${id}`}
              aria-selected={tab === id}
              aria-controls={`sidebar-panel-${id}`}
              tabIndex={tab === id ? 0 : -1}
              className="sidebar-tab"
              onClick={() => setTab(id)}
              onKeyDown={(e) => {
                if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
                const next = TABS[(TABS.indexOf(id) + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length]
                setTab(next)
                document.getElementById(`sidebar-tab-${next}`)?.focus()
              }}
            >
              {t[id]}
            </button>
          ))}
        </div>
        <button type="button" className="btn btn--ghost sidebar-close" onClick={close}>
          {t.close}
        </button>
      </div>
      <div className="sidebar-body" role="tabpanel" id={`sidebar-panel-${tab}`} aria-labelledby={`sidebar-tab-${tab}`}>
        <ErrorBoundary name={t[tab]}>{tab === 'hotspots' ? <HotspotsPanel /> : <FiltersPanel />}</ErrorBoundary>
      </div>
    </div>
  )
}
