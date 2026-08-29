import { ReactNode } from 'react'

export type ErrorFixKind = 'sync' | 'layout' | 'linux' | 'bug' | 'settings' | 'relic' | 'riven'

type Props = {
  message: string
  /** Optional short hint under the message. */
  hint?: string
  className?: string
  actions?: Array<{
    id: ErrorFixKind | string
    label: string
    onClick: () => void
    primary?: boolean
  }>
  children?: ReactNode
}

/**
 * Red/error banner that always ends with concrete fix actions.
 */
export function ErrorFixBar({ message, hint, className = '', actions, children }: Props) {
  if (!message && !children) return null
  return (
    <div className={`error-fix-bar ${className}`.trim()} role="alert">
      <p className="error-fix-bar__msg">{message}</p>
      {hint ? <p className="error-fix-bar__hint muted">{hint}</p> : null}
      {children}
      {actions?.length ? (
        <div className="error-fix-bar__actions toolbar">
          {actions.map((a) => (
            <button
              key={a.id}
              type="button"
              className={a.primary ? 'btn primary' : 'btn ghost'}
              onClick={a.onClick}
            >
              {a.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

/** Heuristic fix actions from a free-form error string. */
export function suggestErrorFixes(
  message: string,
  handlers: {
    onSync?: () => void
    onLayout?: () => void
    onLinux?: () => void
    onBug?: () => void
    onSettings?: () => void
    onRetryRelic?: () => void
    onRetryRiven?: () => void
  },
): Array<{ id: string; label: string; onClick: () => void; primary?: boolean }> {
  const m = (message || '').toLowerCase()
  const out: Array<{ id: string; label: string; onClick: () => void; primary?: boolean }> = []
  if (/gruzzle|inventory|stale|owned|helper|ptrace|memory/i.test(m) && handlers.onSync) {
    out.push({ id: 'sync', label: 'Sync inventory', onClick: handlers.onSync, primary: true })
  }
  if (/ocr|crop|capture|theme|reward|screen|read/i.test(m) && handlers.onLayout) {
    out.push({ id: 'layout', label: 'Adjust OCR / Layout', onClick: handlers.onLayout })
  }
  if (/linux|proton|ptrace|wayland|wine/i.test(m) && handlers.onLinux) {
    out.push({ id: 'linux', label: 'Linux health', onClick: handlers.onLinux })
  }
  if (/relic/i.test(m) && handlers.onRetryRelic) {
    out.push({ id: 'relic', label: 'Retry relic scan', onClick: handlers.onRetryRelic })
  }
  if (/riven/i.test(m) && handlers.onRetryRiven) {
    out.push({ id: 'riven', label: 'Retry riven scan', onClick: handlers.onRetryRiven })
  }
  if (handlers.onSettings && out.length < 2) {
    out.push({ id: 'settings', label: 'Open Settings', onClick: handlers.onSettings })
  }
  if (handlers.onBug) {
    out.push({ id: 'bug', label: 'Bug report', onClick: handlers.onBug })
  }
  return out.slice(0, 4)
}
