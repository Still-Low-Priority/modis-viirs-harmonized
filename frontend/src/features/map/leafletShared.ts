import L from 'leaflet'

const renderers = new WeakMap<L.Map, L.Canvas>()

/** One canvas renderer per map, shared by the points and the grid. */
export function sharedCanvas(map: L.Map): L.Canvas {
  let r = renderers.get(map)
  if (!r) {
    r = L.canvas({ padding: 0.4, tolerance: 3 })
    renderers.set(map, r)
  }
  return r
}

/** Creates a pane once and returns its name. */
export function ensurePane(map: L.Map, name: string, zIndex: number): string {
  if (!map.getPane(name)) {
    const pane = map.createPane(name)
    pane.style.zIndex = String(zIndex)
    pane.style.pointerEvents = 'none'
  }
  return name
}

export function createHoverTooltip(): L.Tooltip {
  return L.tooltip({ direction: 'top', offset: [0, -8], className: 'map-tooltip', opacity: 1 })
}

export interface TooltipRow {
  label: string
  value: string
}

/** Tooltip body built with textContent (no HTML injection from data). */
export function tooltipContent(title: string, rows: TooltipRow[], swatch?: string, footer?: string): HTMLElement {
  const root = document.createElement('div')
  const head = document.createElement('div')
  head.className = 'map-tooltip__title'
  if (swatch) {
    const dot = document.createElement('span')
    dot.className = 'map-tooltip__dot'
    dot.style.background = swatch
    head.append(dot)
  }
  head.append(document.createTextNode(title))
  root.append(head)
  for (const row of rows) {
    const line = document.createElement('div')
    line.className = 'map-tooltip__row'
    const k = document.createElement('span')
    k.className = 'map-tooltip__key'
    k.textContent = row.label
    const v = document.createElement('span')
    v.className = 'map-tooltip__value'
    v.textContent = row.value
    line.append(k, v)
    root.append(line)
  }
  if (footer) {
    const f = document.createElement('div')
    f.className = 'map-tooltip__footer'
    f.textContent = footer
    root.append(f)
  }
  return root
}
