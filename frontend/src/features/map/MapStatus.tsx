import { fmt, useLang, useT } from '../../i18n'
import { formatNumber } from '../../lib/format'
import { messages } from './messages'

interface Props {
  fetching: boolean
  error: boolean
  onRetry: () => void
  total: number | null
  shown: number
  truncated: boolean
  gridMode: boolean
  /** Name of the selected place; the counts then describe it, not the viewport. */
  placeName: string | null
}

/** Loading bar, truncation banner, counter chip, empty and error states. */
export function MapStatus({ fetching, error, onRetry, total, shown, truncated, gridMode, placeName }: Props) {
  const t = useT(messages)
  const lang = useLang()
  const n = (x: number) => formatNumber(x, lang)

  return (
    <>
      {fetching && (
        <div className="map-progress" role="progressbar" aria-label={t.loading}>
          <span className="map-progress__bar" />
        </div>
      )}

      {truncated && total != null && !error && (
        <div className="map-banner" role="status">
          {gridMode ? fmt(t.truncatedGrid, { total: n(total) }) : fmt(t.truncated, { n: n(shown), total: n(total) })}
        </div>
      )}

      {error ? (
        <div className="map-panel map-state" role="alert">
          <p className="map-state__title">{t.errorTitle}</p>
          <button type="button" className="btn" onClick={onRetry}>
            {t.retry}
          </button>
        </div>
      ) : (
        total === 0 &&
        !fetching && (
          <div className="map-panel map-state" role="status">
            <p className="map-state__title">{placeName ? fmt(t.emptyTitlePlace, { place: placeName }) : t.emptyTitle}</p>
            <p className="map-state__hint muted">{placeName ? t.emptyHintPlace : t.emptyHint}</p>
          </div>
        )
      )}

      {total != null && (
        <div className="map-chip" aria-live="polite">
          {placeName
            ? fmt(total === 1 ? t.inPlaceOne : t.inPlace, { n: n(total), place: placeName })
            : total === 1
              ? t.inViewOne
              : fmt(t.inView, { n: n(total) })}
        </div>
      )}
    </>
  )
}
