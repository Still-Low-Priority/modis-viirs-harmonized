import { forwardRef } from 'react'
import { useApiMode } from '../../api/queries'
import { useT } from '../../i18n'
import { messages } from './messages'

const FIRMS_URL = 'https://firms.modaps.eosdis.nasa.gov/'
const GIBS_URL = 'https://www.earthdata.nasa.gov/engage/open-data-services-software/earthdata-developer-portal/gibs-api'

/** Native modal dialog. The parent calls `ref.current.showModal()`. */
export const AboutDialog = forwardRef<HTMLDialogElement>(function AboutDialog(_props, ref) {
  const t = useT(messages)
  const mode = useApiMode()

  return (
    <dialog
      ref={ref}
      className="header-dialog"
      aria-labelledby="header-about-title"
      onClick={(e) => {
        // A click on the backdrop lands on the dialog element itself.
        if (e.target === e.currentTarget) e.currentTarget.close()
      }}
    >
      <div className="header-dialog__body">
        <h2 id="header-about-title" className="header-dialog__title">
          {t.aboutTitle}
        </h2>
        {mode === 'mock' && (
          <p className="header-dialog__demo" role="note">
            {t.aboutDemo}
          </p>
        )}
        <p>{t.aboutWhat}</p>
        <p>
          {t.aboutFirms}{' '}
          <a href={FIRMS_URL} target="_blank" rel="noopener noreferrer">
            {t.aboutFirmsLink}
          </a>
        </p>
        <p>
          {t.aboutGibs}{' '}
          <a href={GIBS_URL} target="_blank" rel="noopener noreferrer">
            {t.aboutGibsLink}
          </a>
        </p>
        <p>{t.aboutBase}</p>
        <p className="header-dialog__ack">{t.aboutAck}</p>
        <p className="muted">{t.aboutDisclaimer}</p>
        <form method="dialog" className="header-dialog__actions">
          <button type="submit" className="btn">
            {t.close}
          </button>
        </form>
      </div>
    </dialog>
  )
})
