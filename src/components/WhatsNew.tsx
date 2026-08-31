import { getWhatsNewBullets } from '../lib/whatsNew'
import './onboarding.css'

type Props = {
  version: string
  open: boolean
  onDismiss: () => void
  /** Prior version if this is an upgrade (not first launch). */
  previousVersion?: string
}

export function WhatsNew({ version, open, onDismiss, previousVersion }: Props) {
  if (!open) return null
  const bullets = getWhatsNewBullets(version)
  const upgraded = Boolean(previousVersion && previousVersion !== version)
  return (
    <div className="hotkey-sheet-backdrop" onClick={onDismiss} role="presentation">
      <div
        className="hotkey-sheet"
        role="dialog"
        aria-label="What's new"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>{upgraded ? `Updated to ${version}` : `What’s new in ${version}`}</h3>
        {upgraded ? (
          <p className="muted" style={{ margin: '0 0 10px', fontSize: '0.85rem' }}>
            You were on {previousVersion}. Here’s what changed:
          </p>
        ) : null}
        <ul className="hotkey-sheet__list">
          {bullets.map((b) => (
            <li key={b}>
              <span>{b}</span>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <button className="btn primary" onClick={onDismiss}>
            Got it
          </button>
        </div>
      </div>
    </div>
  )
}
