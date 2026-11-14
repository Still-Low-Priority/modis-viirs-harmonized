import { useCallback, useEffect, useId, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent, ReactNode } from 'react'
import { loadPlaces, searchPlaces } from '../../lib/geo'
import type { Place } from '../../lib/geo'
import { fmt, useT } from '../../i18n'
import { useStore } from '../../state/store'
import { messages } from './messages'
import { pushRecent, readRecents } from './recents'
import './search.css'

type Status = 'idle' | 'loading' | 'done' | 'error'

const DEBOUNCE_MS = 120

function fold(s: string): string {
  return s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase()
}

/** Wraps the first case/diacritic-insensitive match of `query` in <mark>. */
function highlight(name: string, query: string): ReactNode {
  const q = fold(query.trim())
  const folded = fold(name)
  if (!q || folded.length !== name.length) return name
  const at = folded.indexOf(q)
  if (at < 0) return name
  return (
    <>
      {name.slice(0, at)}
      <mark className="search-mark">{name.slice(at, at + q.length)}</mark>
      {name.slice(at + q.length)}
    </>
  )
}

function SearchIcon() {
  return (
    <svg className="search-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="7" cy="7" r="4.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function ClearIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
      <path d="M2.5 2.5l7 7M9.5 2.5l-7 7" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function isEditable(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false
  return el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName)
}

export function SearchBox() {
  const t = useT(messages)
  const region = useStore((s) => s.region)
  const uid = useId()
  const listId = `${uid}-list`
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const reqRef = useRef(0)

  const [text, setText] = useState(region?.name ?? '')
  const [typed, setTyped] = useState(false)
  const [open, setOpen] = useState(false)
  const [outcome, setOutcome] = useState<{ query: string; results: Place[]; error: boolean } | null>(null)
  const [recents, setRecents] = useState<Place[]>(readRecents)
  const [active, setActive] = useState(-1)
  const [prevRegion, setPrevRegion] = useState(region)

  // Keep the input in step with the store (region picked or cleared elsewhere).
  if (prevRegion !== region) {
    setPrevRegion(region)
    setText(region?.name ?? '')
    setTyped(false)
    setOutcome(null)
  }

  const query = text.trim()
  const searching = typed && query !== ''
  const showRecents = open && query === ''
  const current = searching && outcome?.query === query ? outcome : null
  const results = outcome?.results ?? []
  const status: Status = !searching ? 'idle' : current ? (current.error ? 'error' : 'done') : 'loading'
  const options: Place[] = showRecents ? recents : searching ? results : []

  const [prevShowRecents, setPrevShowRecents] = useState(showRecents)
  if (prevShowRecents !== showRecents) {
    setPrevShowRecents(showRecents)
    if (showRecents) setActive(-1)
  }

  // Debounced search; responses of superseded requests are ignored.
  useEffect(() => {
    if (!searching) {
      reqRef.current++
      return
    }
    const id = ++reqRef.current
    const timer = setTimeout(() => {
      searchPlaces(query, 8).then(
        (res) => {
          if (id !== reqRef.current) return
          setOutcome({ query, results: res, error: false })
          setActive(res.length > 0 ? 0 : -1)
        },
        () => {
          if (id !== reqRef.current) return
          setOutcome({ query, results: [], error: true })
        },
      )
    }, DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [searching, query])

  // Click outside closes.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  // "/" focuses the search when focus is not in another field.
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || isEditable(e.target)) return
      e.preventDefault()
      inputRef.current?.focus()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const select = useCallback((place: Place) => {
    useStore.getState().setRegion(place)
    setRecents(pushRecent(place))
    setText(place.name)
    setTyped(false)
    setOpen(false)
  }, [])

  const clear = useCallback(() => {
    setText('')
    setTyped(false)
    setOutcome(null)
    if (useStore.getState().region) useStore.getState().setRegion(null)
  }, [])

  const onChange = (e: ChangeEvent<HTMLInputElement>) => {
    setText(e.target.value)
    setTyped(true)
    setOpen(true)
  }

  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    const n = options.length
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        if (!open) setOpen(true)
        else if (n) setActive((a) => (a + 1) % n)
        break
      case 'ArrowUp':
        e.preventDefault()
        if (!open) setOpen(true)
        else if (n) setActive((a) => (a <= 0 ? n - 1 : a - 1))
        break
      case 'Home':
        if (open && n) {
          e.preventDefault()
          setActive(0)
        }
        break
      case 'End':
        if (open && n) {
          e.preventDefault()
          setActive(n - 1)
        }
        break
      case 'Enter':
        if (open && active >= 0 && active < n) {
          e.preventDefault()
          select(options[active])
        }
        break
      case 'Escape':
        e.preventDefault()
        if (open) setOpen(false)
        else if (text !== '' || region) clear()
        break
    }
  }

  const kindLabel = (p: Place) => t[p.kind]
  const secondary = (p: Place): string => {
    if (p.kind === 'region') return p.countryName
    if (p.kind === 'city') return [p.regionName, p.countryName].filter(Boolean).join(', ')
    return ''
  }

  const showList = open && (showRecents || searching)
  const listVisible = options.length > 0
  const pendingFirst = searching && status === 'loading' && results.length === 0
  const optId = (i: number) => `${uid}-opt-${i}`

  return (
    <div className="search-root" ref={rootRef}>
      <div className="search-field">
        <SearchIcon />
        <input
          ref={inputRef}
          className="search-input"
          type="text"
          role="combobox"
          aria-label={t.label}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList && active >= 0 && active < options.length ? optId(active) : undefined}
          placeholder={t.placeholder}
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={onChange}
          onKeyDown={onKeyDown}
          onFocus={() => {
            setOpen(true)
            void loadPlaces().catch(() => undefined)
          }}
        />
        {text !== '' ? (
          <button
            type="button"
            className="search-clear"
            aria-label={t.clear}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              clear()
              inputRef.current?.focus()
            }}
          >
            <ClearIcon />
          </button>
        ) : (
          <kbd className="search-kbd" aria-hidden="true">
            /
          </kbd>
        )}
      </div>

      {showList && (
        <div className="search-panel" onMouseDown={(e) => e.preventDefault()}>
          {showRecents && listVisible && (
            <div className="search-heading" id={`${uid}-recent`}>
              {t.recent}
            </div>
          )}
          <ul
            id={listId}
            className="search-list"
            role="listbox"
            aria-label={showRecents ? t.recent : t.results}
            hidden={!listVisible}
          >
            {options.map((p, i) => (
              <li
                key={p.id}
                id={optId(i)}
                role="option"
                aria-selected={i === active}
                className={`search-option${i === active ? ' search-option--active' : ''}`}
                onMouseEnter={() => setActive(i)}
                onClick={() => select(p)}
              >
                <span className="search-text">
                  <span className="search-name">{showRecents ? p.name : highlight(p.name, query)}</span>
                  {secondary(p) && <span className="search-sub">{secondary(p)}</span>}
                </span>
                <span className="search-kind">{kindLabel(p)}</span>
              </li>
            ))}
          </ul>
          {pendingFirst && <div className="search-note">{t.loading}</div>}
          {searching && status === 'done' && results.length === 0 && (
            <div className="search-note" role="status">
              {fmt(t.noResults, { query })}
            </div>
          )}
          {searching && status === 'error' && (
            <div className="search-note" role="status">
              {t.failed}
            </div>
          )}
          {showRecents && <div className="search-hint">{t.hint}</div>}
        </div>
      )}
    </div>
  )
}
