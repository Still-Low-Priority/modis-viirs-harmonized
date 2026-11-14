import { useId } from 'react'
import { useApiMode, useMeta } from '../../api/queries'
import { Logo } from '../../app/Logo'
import { fmt, useLang, useT } from '../../i18n'
import { formatDateTimeUtc } from '../../lib/format'
import { SearchBox } from '../search/SearchBox'
import { messages } from './messages'
import { ViewMenu } from './ViewMenu'
import './header.css'

function StatusPill() {
  const t = useT(messages)
  const mode = useApiMode()
  const tipId = useId()
  const demo = mode === 'mock'
  const label = demo ? t.demo : t.live
  const hint = demo ? t.demoHint : t.liveHint

  return (
    <span className="header-status">
      {/* Focusable so keyboard users get the same explanation as hover users. */}
      <span
        className={`header-mode ${demo ? 'header-mode--demo' : 'header-mode--live'}`}
        tabIndex={0}
        role="group"
        aria-label={label}
        aria-describedby={tipId}
      >
        <i className="header-mode__dot" aria-hidden="true" />
        <span className="header-mode__text">{label}</span>
      </span>
      <span id={tipId} role="tooltip" className="header-tip">
        {hint}
      </span>
    </span>
  )
}

export function Header() {
  const t = useT(messages)
  const lang = useLang()
  const { data: meta } = useMeta()
  const ingested = meta?.last_ingested_at

  return (
    <div className="header">
      <div className="header-brand">
        <Logo size={26} />
        <h1 className="header-title">
          <span className="header-title__full">{t.title}</span>
          <span className="header-title__short">{t.titleShort}</span>
        </h1>
        <span className="header-tagline muted">{t.tagline}</span>
      </div>

      <div className="header-search">
        <SearchBox />
      </div>

      <StatusPill />
      {ingested && <span className="header-updated muted">{fmt(t.updated, { when: formatDateTimeUtc(ingested, lang) })}</span>}

      <ViewMenu />
    </div>
  )
}
