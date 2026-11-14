import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { useT } from '../../i18n'
import { useStore } from '../../state/store'
import { AboutDialog } from './AboutDialog'
import { CheckIcon, ChartIcon, ChevronIcon, FiltersIcon, InfoIcon, LayersIcon, ListIcon, RingsIcon } from './icons'
import { messages } from './messages'

interface CheckItem {
  key: string
  label: string
  icon: ReactNode
  checked: boolean
  onSelect: () => void
}

export function ViewMenu() {
  const t = useT(messages)
  const [open, setOpen] = useState(false)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const dialogRef = useRef<HTMLDialogElement>(null)
  const focusTarget = useRef<'first' | 'last'>('first')
  const menuId = useId()

  const sidebarOpen = useStore((s) => s.sidebarOpen)
  const sidebarTab = useStore((s) => s.sidebarTab)
  const setSidebarOpen = useStore((s) => s.setSidebarOpen)
  const setSidebarTab = useStore((s) => s.setSidebarTab)
  const bottomOpen = useStore((s) => s.bottomOpen)
  const setBottomOpen = useStore((s) => s.setBottomOpen)
  const showHotspots = useStore((s) => s.showHotspots)
  const setShowHotspots = useStore((s) => s.setShowHotspots)

  const panelItem = (tab: 'hotspots' | 'filters', label: string, icon: ReactNode): CheckItem => {
    const checked = sidebarOpen && sidebarTab === tab
    return { key: tab, label, icon, checked, onSelect: () => (checked ? setSidebarOpen(false) : setSidebarTab(tab)) }
  }
  const items: CheckItem[] = [
    panelItem('hotspots', t.hotspotsPanel, <ListIcon />),
    panelItem('filters', t.filtersPanel, <FiltersIcon />),
    { key: 'charts', label: t.chartsPanel, icon: <ChartIcon />, checked: bottomOpen, onSelect: () => setBottomOpen(!bottomOpen) },
    { key: 'rings', label: t.rings, icon: <RingsIcon />, checked: showHotspots, onSelect: () => setShowHotspots(!showHotspots) },
  ]

  const menuItems = () => Array.from(menuRef.current?.querySelectorAll<HTMLElement>('[role^="menuitem"]') ?? [])

  useEffect(() => {
    if (!open) return
    const els = menuItems()
    ;(focusTarget.current === 'last' ? els[els.length - 1] : els[0])?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      const node = e.target as Node
      if (!menuRef.current?.contains(node) && !buttonRef.current?.contains(node)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  const openMenu = (where: 'first' | 'last') => {
    focusTarget.current = where
    setOpen(true)
  }
  const closeMenu = (returnFocus: boolean) => {
    setOpen(false)
    if (returnFocus) buttonRef.current?.focus()
  }

  const onButtonKey = (e: KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      openMenu('first')
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      openMenu('last')
    }
  }

  const onMenuKey = (e: KeyboardEvent) => {
    const els = menuItems()
    const i = els.indexOf(document.activeElement as HTMLElement)
    const go = (n: number) => {
      e.preventDefault()
      els[(n + els.length) % els.length]?.focus()
    }
    switch (e.key) {
      case 'ArrowDown':
        return go(i + 1)
      case 'ArrowUp':
        return go(i - 1)
      case 'Home':
        return go(0)
      case 'End':
        return go(els.length - 1)
      case 'Escape':
        e.preventDefault()
        return closeMenu(true)
      case 'Tab':
        return closeMenu(false)
    }
  }

  const openAbout = () => {
    closeMenu(false)
    dialogRef.current?.showModal()
  }

  return (
    <div className="header-view">
      <button
        ref={buttonRef}
        type="button"
        className="btn header-view__btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={t.viewAria}
        onClick={() => (open ? closeMenu(false) : openMenu('first'))}
        onKeyDown={onButtonKey}
      >
        <LayersIcon />
        <span className="header-view__text">{t.view}</span>
        <ChevronIcon />
      </button>

      {open && (
        <div ref={menuRef} id={menuId} role="menu" aria-label={t.viewAria} className="header-menu" onKeyDown={onMenuKey}>
          {items.map((it) => (
            <button
              key={it.key}
              type="button"
              role="menuitemcheckbox"
              aria-checked={it.checked}
              tabIndex={-1}
              className="header-menu__item"
              onClick={it.onSelect}
            >
              {it.icon}
              <span className="header-menu__label">{it.label}</span>
              <span className="header-menu__check">{it.checked && <CheckIcon />}</span>
            </button>
          ))}
          <div role="separator" className="header-menu__sep" />
          <button type="button" role="menuitem" tabIndex={-1} className="header-menu__item" onClick={openAbout}>
            <InfoIcon />
            <span className="header-menu__label">{t.about}</span>
            <span className="header-menu__check" />
          </button>
        </div>
      )}

      <AboutDialog ref={dialogRef} />
    </div>
  )
}
