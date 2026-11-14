# MODIS × VIIRS Harmonized: frontend

A map of active fires from NASA FIRMS (MODIS and VIIRS). On top of the usual
"dots on a map" it ranks **fire hotspots**: places where detections crowd
together, for the current map view or for a selected country, region or city.

React 19, TypeScript, Vite, Leaflet. Version 1.0.0.

## Detections and hotspots

A **detection** is one satellite pixel where a sensor saw fire. Each dot on the
map is one detection, coloured by sensor (MODIS, VIIRS S-NPP, VIIRS NOAA-20),
by confidence or by fire radiative power (FRP, in megawatts).

A **hotspot** is a group of detections that belong to the same burning area:

1. Two detections are linked when they are closer than **10 km**.
2. Links chain: A–B and B–C put A, B and C in one group, so a long fire front
   becomes one hotspot instead of several.
3. A group is listed once it has at least **10 detections** in the selected
   period. Smaller groups stay as plain dots.

Each hotspot gets a severity level. The higher level wins as soon as **either**
threshold is reached:

| Level | Detections | or total FRP | Colour | Reading |
|---|---|---|---|---|
| Critical | 100 or more | 2000 MW or more | red | a large or very intense fire complex |
| High | 30 or more | 500 MW or more | orange | a sustained fire, clearly more than a single burn |
| Elevated | 10 or more | below 500 MW | yellow | a dense group worth watching |

The FRP threshold matters for short, violent fires: 20 detections with 2500 MW
in total are critical although the count alone would only make them elevated.

The list is ordered by severity, then by number of detections, then by total
FRP. The number on a map ring is that rank. The ring covers the real extent of
the group, so "about 56 km across" means the detections spread that far.

The numbers come from `src/lib/hotspots.ts` (`DEFAULT_RADIUS_KM`,
`DEFAULT_MIN_COUNT`, `SEVERITY_RULES`). If the backend implements
`GET /api/hotspots`, its answer is used. Otherwise the browser groups a sample
of up to 20 000 detections itself; when the sample was cut off, the panel says
the counts are lower bounds.

## Screen layout

```
┌──── Header: logo · search · data badge · View menu ───────────────────┐
├───────────────┬───────────────────────────────────────────────────────┤
│ Sidebar       │ Summary bar                                           │
│  Hotspots tab ├───────────────────────────────────────────────────────┤
│  Filters tab  │ Map                              [detection drawer]   │
│               ├──────────────────────────────┬────────────────────────┤
│               │ Activity calendar            │ History chart          │
└───────────────┴──────────────────────────────┴────────────────────────┘
```

Everything on screen describes the same slice of data: the selected period and
filters, inside the selected place or, when no place is selected, inside the
current map view.

## Components

Each one lives in `src/features/<name>/`.

| Component | What it does |
|---|---|
| **Header** (`header/`) | Logo, search box, "Demo data" badge when no backend answers, time of the last data update. The **View** menu shows or hides the Hotspots panel, the Filters panel, the charts and the hotspot rings, and opens **About the data** (sources and NASA acknowledgement). |
| **Search** (`search/`) | Finds countries, regions/states and cities (for example Ukraine, Rivne, Texas, Toronto, Beijing) in an offline gazetteer, so it works without any geocoding service. Picking a place flies the map there, draws its outline and locks every panel to it. The × next to the place name returns to "current map view". |
| **Hotspots panel** (`hotspots/`) | The ranked hotspot list for the place or the map view: severity badge, nearest city, detections, total FRP, extent, active days, sensor mix. Sorts by severity, detections, FRP or most recent. Clicking a row zooms the map to that hotspot. For a country, hotspots outside its border are dropped. When a short period has no hotspots it offers to search the last 90 days. |
| **Filters panel** (`filters/`) | Period (presets or exact dates), sensors, day/night, minimum confidence. Reset restores the defaults and keeps the selected place. |
| **Summary bar** (`summary/`) | Scope and period, a bar chart of detections per day (click a bar to zoom into that day, then step back), total FRP, and the share of each sensor. |
| **Map** (`map/`) | Leaflet map. Zoomed in it draws every detection on a canvas; zoomed out it switches to a density grid so the browser does not choke. Hotspot rings sit on top. The **Layers** control switches basemap (dark, light, daily NASA satellite imagery) and point colouring; the legend explains colours. Clicking a dot opens the detection drawer. |
| **Detection drawer** (`details/`) | Everything known about one detection: time (UTC), coordinates, sensor and satellite, confidence, FRP, brightness temperature, and the hotspot it belongs to, if any. |
| **Activity calendar** (`calendar/`) | One cell per day of a year, brighter means more detections. Click a day, or drag across several, to set the period. Arrows change the year. |
| **History chart** (`charts/`) | "By year": detections or FRP per year, stacked by sensor, which shows when VIIRS joined MODIS. "Seasonality": the same months compared across years. Loaded on demand to keep the first paint light. |

Shared code:

| Path | What |
|---|---|
| `src/api/types.ts` | API contract shared with the backend |
| `src/api/http.ts` | real client for `/api/...` |
| `src/api/mock/` | deterministic demo data behind the same interface |
| `src/api/queries.ts` | React Query hooks used by all components |
| `src/state/store.ts` | one zustand store: filters, selected place, map view, selection, panel toggles |
| `src/lib/hotspots.ts` | grouping and severity rules |
| `src/lib/geo/` | gazetteer search, nearest city, country outlines |
| `public/geo/` | gazetteer data built from Natural Earth by `scripts/build-geo.mjs` |

Conventions for contributors are in [ARCHITECTURE.md](ARCHITECTURE.md).

## Running

```sh
npm install
npm run dev        # http://localhost:5173
```

| Script | What |
|---|---|
| `npm run dev` | dev server with hot reload |
| `npm run build` | type check and production build into `dist/` |
| `npm run typecheck` | TypeScript only |
| `npm run lint` | oxlint |
| `npm test` | vitest |
| `npm run preview` | serve the production build locally |

## Configuration

| Variable | Values | Meaning |
|---|---|---|
| `VITE_API_MODE` | `auto` (default), `real`, `mock` | `auto` asks `/api/meta`; if the backend does not answer, the app runs on demo data and shows a "Demo data" badge |
| `VITE_BASEMAP_PROVIDER` | `esri` (default), `carto` | tile provider for the dark basemap |

## Data and credits

Fire detections: NASA FIRMS (MODIS on Terra and Aqua, about 1 km
pixels; VIIRS on Suomi NPP and NOAA-20, 375 m pixels). A detection is a thermal
anomaly seen by a satellite, not a confirmed fire. Daily satellite imagery: NASA GIBS. Basemap tiles: Esri. Place names
and outlines: Natural Earth (public domain). This project is not affiliated
with or endorsed by NASA.
