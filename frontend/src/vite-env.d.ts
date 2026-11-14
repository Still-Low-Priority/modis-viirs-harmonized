/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_MODE?: 'auto' | 'real' | 'mock'
  /** Base map tiles: 'esri' (default, no key) or 'carto' (needs a CARTO key). */
  readonly VITE_BASEMAP_PROVIDER?: 'esri' | 'carto'
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
