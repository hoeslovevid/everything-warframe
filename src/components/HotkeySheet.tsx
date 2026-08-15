import { HotkeyConfig, MODULE_META, MODULE_TOGGLE_HOTKEY_TO_ID } from '../../shared/types'
import { prettyHotkey } from '../lib/hotkey'
import './onboarding.css'

type Props = {
  open: boolean
  hotkeys: HotkeyConfig
  onClose: () => void
}

export function HotkeySheet({ open, hotkeys, onClose }: Props) {
  if (!open) return null

  const rows: Array<{ label: string; key: string }> = [
    { label: 'Toggle overlay', key: hotkeys.toggleOverlay },
    { label: 'Open companion', key: hotkeys.openCompanion },
    { label: 'Refresh worldstate', key: hotkeys.refreshWorldstate },
    { label: 'Hide / restore worldstate panels', key: hotkeys.toggleWorldstatePanels },
    { label: 'Quiet focus (fissures + OCR)', key: hotkeys.toggleQuietFocus },
    { label: 'Scan relic rewards', key: hotkeys.scanRelics },
    { label: 'Dismiss relic popup', key: hotkeys.dismissRelics },
    { label: 'Scan riven compare', key: hotkeys.scanRivens },
    { label: 'Dismiss riven popup', key: hotkeys.dismissRivens },
    { label: 'Move panels (unlock drag)', key: hotkeys.editLayout },
  ]

  for (const [hotkeyId, moduleId] of Object.entries(MODULE_TOGGLE_HOTKEY_TO_ID)) {
    const key = hotkeys[hotkeyId as keyof HotkeyConfig]
    if (!key?.trim()) continue
    rows.push({
      label: `Toggle ${MODULE_META[moduleId].label}`,
      key,
    })
  }

  return (
    <div className="hotkey-sheet-backdrop" onClick={onClose} role="presentation">
      <div
        className="hotkey-sheet"
        role="dialog"
        aria-label="Hotkeys"
        onClick={(e) => e.stopPropagation()}
      >
        <h3>Hotkeys</h3>
        <p className="muted" style={{ margin: 0 }}>
          Press <kbd>?</kbd> anytime in the companion to open this sheet. Esc to close.
        </p>
        <ul className="hotkey-sheet__list">
          {rows.map((row) => (
            <li key={row.label}>
              <span>{row.label}</span>
              <kbd>{row.key?.trim() ? prettyHotkey(row.key) : '—'}</kbd>
            </li>
          ))}
        </ul>
        <div style={{ marginTop: 14, textAlign: 'right' }}>
          <button className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  )
}
