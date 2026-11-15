# Frontend architecture

React 19 + TypeScript + Vite. Dark, map-first single page: fire detections from
NASA FIRMS (MODIS + VIIRS) on a Leaflet map, ranked fire hotspots, place search,
filters, an activity calendar and per-year charts, plus a panel that starts FIRMS
ingestion jobs on the backend. The UI is English only.

## Layout

```
┌──── Header: logo · SearchBox · data badge · View menu (52px) ─────────┐
├───────────────┬───────────────────────────────────────────────────────┤
│ Sidebar       │ SummaryBar (scope, detections per day, FRP, sensors)  │
│ (320px)       ├───────────────────────────────────────────────────────┤
│ Hotspots tab  │ MapView (fills the rest)            [DetectionDrawer] │
│ Filters tab   │                                                       │
│ Data tab      ├──────────────────────────────┬────────────────────────┤
│               │ ActivityCalendar             │ YearlyChart   (232px)  │
└───────────────┴──────────────────────────────┴────────────────────────┘
```

The View menu in the header toggles the sidebar tabs, the bottom panels and the
hotspot rings, and opens the About dialog (data sources and NASA
acknowledgement). Basemap and colouring live in the map's Layers control.

`src/app/App.tsx` owns the skeleton; every box is one feature component.

## Directory map

| Path | What |
|---|---|
| `src/api/types.ts` | API contract (source of truth, mirrors the backend spec) |
| `src/api/http.ts` | real client (`/api/...`) |
| `src/api/mock/` | deterministic demo data implementing the same `Api` interface |
| `src/api/index.ts` | picks real vs mock (`VITE_API_MODE=auto\|real\|mock`, auto = probe `/api/meta`) |
| `src/api/ingestion.ts` | real client for the endpoints the backend has today: `GET /api/health`, `POST /api/ingestion/jobs`, `GET /api/ingestion/jobs/{id}`; FIRMS product list, viewport-to-bbox conversion |
| `src/api/queries.ts` | React Query hooks: `useMeta`, `useAreas`, `useDetections`, `useDetection`, `useTimeseries`, `useGrid`, `useHotspots`, `useScopedHotspots`, `useApiMode`, `useCommonFilters`, `useFullMeta`, `useBackendHealth`, `useCreateIngestionJob`, `useIngestionJob` |
| `src/state/store.ts` | zustand store: filters, map viewport, selected place (`region`), selection, UI toggles |
| `src/i18n/index.ts` | `useT(messages)`, `useLang()`, `fmt()`, `plural()`; English only |
| `src/lib/` | `dates.ts` (UTC day maths), `format.ts`, `colors.ts`, `hotspots.ts` (clustering and severity rules) |
| `src/lib/geo/` | offline gazetteer: `searchPlaces`, `nearestPlace`, `loadCountryPolygon`, `pointInPolygon` |
| `public/geo/` | gazetteer data built from Natural Earth by `scripts/build-geo.mjs` (countries, regions, cities, country outlines) |
| `src/features/<name>/` | one feature = its components, CSS and strings |
| `src/index.css` | design tokens (CSS variables) and shared primitives (`.btn`, `.field`, `.label`, `.badge`, `.skeleton`, `.muted`, `.mono`, `.sr-only`) |

## Data flow

1. The map writes its viewport to `store.viewBbox` (debounced).
2. Filters write `processing/dateFrom/dateTo/sources/daynight/minConfidence` to the store.
3. Every query hook reads the store through `useCommonFilters()`, so map,
   summary, calendar and chart always describe the same slice of data.
4. Clicking a point sets `store.selectedId`; the drawer loads its details.
5. Picking a place in the search calls `setRegion(place)`. While a place is
   selected, every query uses its bbox instead of the viewport, the map fits it
   and draws its outline.

## Backend and demo data

On load `resolveApi()` asks `GET /api/meta`. If it answers, every panel reads
the backend; if not (backend down, local work without it), the page falls back
to generated demo data and says so in the header.

The backend keeps two kinds of FIRMS products apart and answers one kind per
request: `processing=NRT` (near real-time, recent weeks) or `processing=SP`
(standard processing, the archive; the backend's default). A `source` of the
other kind is a 422.

- `store.processing` holds the selected kind; `useCommonFilters()` adds it to
  every request. Switching it clears the sensor selection.
- `useMeta()` returns meta narrowed to that kind (its sensors and the days they
  cover), so filters, calendar and charts follow the switch without knowing
  about it. `useFullMeta()` is the unfiltered answer.
- `App` moves to a kind that has data when the selected one has none; the
  "Recent / Archive" switch in Filters appears only when both have data.
- Demo meta carries no kinds, so none of this applies to it.

`confidence` can be null (raw value not mappable) and `detection_type` is null
for NRT detections, which FIRMS ships without a type.

The "Data" tab (`src/features/ingestion/`) always talks to the real backend:

- it sends the selected place's bbox, or the map viewport, the chosen FIRMS
  product and a period of at most 31 days (`MAX_INGESTION_DAYS`; the backend has
  no limit of its own, and every 5 days is one call against the shared FIRMS
  key);
- the bbox is rounded to 0.01° and wrapped into [-180, 180] by
  `toIngestionBbox`; the backend matches already-loaded areas by exact
  coordinates;
- the backend cannot list jobs, so task ids are kept in `localStorage`
  (`mvh.ingestionJobs`, 10 newest) and each one is polled every 3 s until it is
  `SUCCESS`, `FAILURE` or `REVOKED`;
- when a job is seen finishing, all data queries are refetched;
- Celery forgets a result after a day and then reports the id as `PENDING`, so
  older jobs are shown as "No longer tracked" and not polled.

## Hotspots

A hotspot is a group of detections where each one is within 10 km of another
(single linkage), with at least 10 detections. Severity: `high` from 30
detections or 500 MW of summed FRP, `critical` from 100 detections or 2000 MW.
The rules live in `src/lib/hotspots.ts`.

`useHotspots` asks `GET /api/hotspots`; when the backend does not implement it,
the client clusters a sample of up to 20 000 detections itself and marks the
result `approximate` if the sample was truncated. `useScopedHotspots` also drops
hotspots outside the selected country's outline.

All dates are UTC. A day is a `YYYY-MM-DD` string; use `src/lib/dates.ts`,
never local-time `Date` getters.

## Conventions

- **Styling:** plain CSS file next to the component, imported by it. Class
  names are prefixed with the feature name (`map-…`, `filters-…`, `cal-…`,
  `charts-…`, `summary-…`, `details-…`, `header-…`, `ingest-…`). Use the tokens from
  `src/index.css`; no hard-coded greys, no CSS frameworks.
- **Strings:** no user-visible literals in JSX. Each feature has
  `messages.ts` exporting `{ en: {...} }`. No emoji; icons are inline SVG components.
- **Numbers and dates:** `formatNumber`, `formatCompact`, `formatDay`,
  `formatDateTimeUtc`, `formatFrp` from `src/lib/format.ts` with `useLang()`.
- **Colours for data:** `sourceColor`, `sourceLabel`, `CONFIDENCE_COLORS`,
  `SEVERITY_COLORS`, `frpColor`, `heatColor` from `src/lib/colors.ts`. Same sensor = same colour everywhere.
- **States:** every data-driven component handles loading (`.skeleton`),
  empty and error states.
- **TypeScript:** strict, `verbatimModuleSyntax` (use `import type`),
  `erasableSyntaxOnly` (no enums, no parameter properties), no `any`.
- **Accessibility:** real buttons/labels, `aria-pressed` on toggles, keyboard
  reachable, visible focus.

## Scripts

`npm run dev` · `npm run typecheck` · `npm run lint` (oxlint) · `npm test` (vitest) · `npm run build`
