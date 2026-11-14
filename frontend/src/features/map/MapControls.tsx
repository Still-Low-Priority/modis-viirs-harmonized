import type { FocusEvent } from 'react'
import { useEffect, useId, useRef, useState } from 'react'
import { fmt, useLang, useT } from '../../i18n'
import { formatDay } from '../../lib/format'
import type { Basemap, ColorBy } from '../../state/store'
import { useStore } from '../../state/store'
import { LayersIcon } from './icons'
import { messages } from './messages'

const BASEMAPS: Basemap[] = ['dark', 'light', 'satellite']
const COLOR_MODES: ColorBy[] = ['source', 'confidence', 'frp']

/**
 * Compact "Layers" button (top left, under the zoom buttons) with a popover
 * for base map, colour mode and the hotspots overlay. Closes on Escape and on
 * a click outside; focus moves into the popover and back to the button.
 */
export function MapControls({ gridMode }: { gridMode: boolean }) {
  const t = useT(messages)
  const lang = useLang()
  const basemap = useStore((s) => s.basemap)
  const setBasemap = useStore((s) => s.setBasemap)
  const colorBy = useStore((s) => s.colorBy)
  const setColorBy = useStore((s) => s.setColorBy)
  const showHotspots = useStore((s) => s.showHotspots)
  const setShowHotspots = useStore((s) => s.setShowHotspots)
  const dateTo = useStore((s) => s.dateTo)

  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)
  const buttonRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const panelId = useId()

  useEffect(() => {
    if (!open) return
    // Focus the active choice of the first group (or the first button).
    const panel = panelRef.current
    const first = panel?.querySelector<HTMLButtonElement>('button[aria-pressed="true"]') ?? panel?.querySelector<HTMLButtonElement>('button')
    first?.focus()

    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      setOpen(false)
      buttonRef.current?.focus()
    }
    const onPointer = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [open])

  // Close when focus leaves the control (e.g. Tab past the last option).
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    if (open && e.relatedTarget && !rootRef.current?.contains(e.relatedTarget as Node)) setOpen(false)
  }

  const basemapLabel: Record<Basemap, string> = { dark: t.basemapDark, light: t.basemapLight, satellite: t.basemapSatellite }
  const colorLabel: Record<ColorBy, string> = { source: t.colorSource, confidence: t.colorConfidence, frp: t.colorFrp }
  const day = formatDay(dateTo, lang)

  return (
    <div className="map-layers" ref={rootRef} onBlur={onBlur}>
      <button
        ref={buttonRef}
        type="button"
        className="map-panel map-layers__button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-haspopup="dialog"
        onClick={() => setOpen((o) => !o)}
      >
        <LayersIcon />
        <span>{t.layers}</span>
      </button>

      <div
        ref={panelRef}
        id={panelId}
        className="map-panel map-layers__panel"
        role="dialog"
        aria-label={t.layersPanel}
        hidden={!open}
      >
        <div className="map-controls__group" role="group" aria-label={t.basemap}>
          <span className="map-controls__label">{t.basemap}</span>
          <div className="map-seg">
            {BASEMAPS.map((b) => (
              <button
                key={b}
                type="button"
                className="map-seg__btn"
                aria-pressed={basemap === b}
                title={b === 'satellite' ? fmt(t.satelliteHint, { day }) : undefined}
                onClick={() => setBasemap(b)}
              >
                {basemapLabel[b]}
              </button>
            ))}
          </div>
          {basemap === 'satellite' && <p className="map-controls__note">{fmt(t.satelliteNote, { day })}</p>}
        </div>

        <div className="map-controls__group" role="group" aria-label={t.colorBy}>
          <span className="map-controls__label">{t.colorBy}</span>
          <div className="map-seg">
            {COLOR_MODES.map((c) => (
              <button
                key={c}
                type="button"
                className="map-seg__btn"
                aria-pressed={colorBy === c}
                disabled={gridMode}
                title={gridMode ? t.colorDisabledInGrid : undefined}
                onClick={() => setColorBy(c)}
              >
                {colorLabel[c]}
              </button>
            ))}
          </div>
          {gridMode && <p className="map-controls__note">{t.colorDisabledInGrid}</p>}
        </div>

        <div className="map-controls__group" role="group" aria-label={t.overlays}>
          <span className="map-controls__label">{t.overlays}</span>
          <button
            type="button"
            className="map-toggle"
            aria-pressed={showHotspots}
            title={t.hotspotsToggleHint}
            onClick={() => setShowHotspots(!showHotspots)}
          >
            <span className="map-toggle__track" aria-hidden="true">
              <span className="map-toggle__thumb" />
            </span>
            {t.hotspotsToggle}
          </button>
        </div>
      </div>
    </div>
  )
}
