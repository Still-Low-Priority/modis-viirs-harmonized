import { TileLayer } from 'react-leaflet'
import type { Basemap } from '../../state/store'

export const MAX_ZOOM = 12

interface TileDef {
  url: string
  attribution: string
  subdomains?: string
  maxNativeZoom?: number
}

const OSM = '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
const CARTO_ATTRIBUTION = `${OSM} &copy; <a href="https://carto.com/attributions">CARTO</a>`
const ESRI_ATTRIBUTION = `Tiles &copy; <a href="https://www.esri.com">Esri</a> &mdash; Esri, HERE, Garmin, ${OSM}`
const GIBS_ATTRIBUTION = 'VIIRS NOAA-20 imagery &copy; <a href="https://earthdata.nasa.gov/gibs">NASA EOSDIS GIBS</a>'

const carto = (style: string): TileDef => ({
  url: `https://{s}.basemaps.cartocdn.com/${style}/{z}/{x}/{y}{r}.png`,
  subdomains: 'abcd',
  attribution: CARTO_ATTRIBUTION,
})
const esri = (service: string): TileDef => ({
  url: `https://server.arcgisonline.com/ArcGIS/rest/services/${service}/MapServer/tile/{z}/{y}/{x}`,
  attribution: ESRI_ATTRIBUTION,
  maxNativeZoom: 16,
})

/**
 * Vector-style basemaps. basemaps.cartocdn.com currently answers every tile with an
 * "API KEY REQUIRED" placeholder, so the default is Esri's keyless Canvas service;
 * set VITE_BASEMAP_PROVIDER=carto to switch back once CARTO tiles work again.
 */
const PROVIDERS: Record<'carto' | 'esri', { dark: TileDef[]; light: TileDef[]; labels: TileDef }> = {
  carto: {
    dark: [carto('dark_all')],
    light: [carto('light_all')],
    labels: carto('dark_only_labels'),
  },
  esri: {
    dark: [esri('Canvas/World_Dark_Gray_Base'), esri('Canvas/World_Dark_Gray_Reference')],
    light: [esri('Canvas/World_Light_Gray_Base'), esri('Canvas/World_Light_Gray_Reference')],
    labels: esri('Reference/World_Boundaries_and_Places'),
  },
}

const provider = PROVIDERS[import.meta.env.VITE_BASEMAP_PROVIDER === 'carto' ? 'carto' : 'esri']

/**
 * Daily true-colour mosaic from NASA GIBS. VIIRS swaths are about 3000 km wide
 * and overlap at the equator, so the mosaic has none of the black wedges that
 * MODIS Terra leaves between orbits. NOAA-20 rather than S-NPP: GIBS stopped
 * publishing VIIRS_SNPP_CorrectedReflectance_TrueColor after 2026-11-02
 * (404 for later days), while the NOAA-20 layer is current.
 */
const GIBS_LAYER = 'VIIRS_NOAA20_CorrectedReflectance_TrueColor'

const gibs = (day: string): TileDef => ({
  url: `https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/${GIBS_LAYER}/default/${day}/GoogleMapsCompatible_Level9/{z}/{y}/{x}.jpg`,
  attribution: GIBS_ATTRIBUTION,
  maxNativeZoom: 9,
})

function Tiles({ def, zIndex }: { def: TileDef; zIndex: number }) {
  return (
    <TileLayer
      url={def.url}
      attribution={def.attribution}
      subdomains={def.subdomains ?? 'abc'}
      maxNativeZoom={def.maxNativeZoom}
      maxZoom={MAX_ZOOM}
      zIndex={zIndex}
    />
  )
}

/** Base map selected by `store.basemap`; the satellite layer shows the day `day` (= dateTo). */
export function BaseLayers({ basemap, day }: { basemap: Basemap; day: string }) {
  // The URL changes with the day; TileLayer calls setUrl() and reloads the tiles.
  const stack = basemap === 'satellite' ? [gibs(day), provider.labels] : provider[basemap]
  return (
    <>
      {stack.map((def, i) => (
        <Tiles key={`${basemap}-${i}`} def={def} zIndex={i + 1} />
      ))}
    </>
  )
}
