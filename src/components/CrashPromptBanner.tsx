import { useEffect, useState } from 'react'
import { Panel } from './Panel'

type Pending = { at: string; label: string; preview: string }

/**
 * Styled crash → GitHub issue prompt (replaces window.confirm).
 * Only shows when Settings → Opt-in crash log is enabled and a pending crash exists.
 */
export function CrashPromptBanner() {
  const [pending, setPending] = useState<Pending | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void (async () => {
      const p = await window.voidlens?.getPendingCrash?.()
      if (!cancelled && p) setPending(p)
    })()
    return () => {
      cancelled = true
    }
  }, [])

  if (!pending) return null

  const dismiss = async () => {
    await window.voidlens?.clearPendingCrash?.()
    setPending(null)
  }

  const report = async () => {
    setBusy(true)
    try {
      const tail = (await window.voidlens?.readCrashLogTail?.()) || pending.preview
      await window.voidlens?.openBugReport?.({
        title: `[crash] ${pending.label}`,
        description: `Automatic crash prompt from opt-in crash log.\n\n\`\`\`\n${tail.slice(0, 3500)}\n\`\`\``,
        category: 'other',
        includeDiagnostics: true,
      })
      await dismiss()
    } finally {
      setBusy(false)
    }
  }

  return (
    <Panel title="Crash report ready" subtitle="Opt-in crash log · nothing is sent until you submit">
      <p className="muted" style={{ marginTop: 0 }}>
        Logged <strong>{pending.label}</strong> at{' '}
        {new Date(pending.at).toLocaleString()}. Open a prefilled GitHub issue, or dismiss.
      </p>
      <div className="toolbar">
        <button className="btn primary" type="button" disabled={busy} onClick={() => void report()}>
          {busy ? 'Opening…' : 'Open GitHub issue'}
        </button>
        <button className="btn ghost" type="button" disabled={busy} onClick={() => void dismiss()}>
          Dismiss
        </button>
      </div>
      <p className="muted" style={{ fontSize: '0.75rem' }}>
        Path: Settings → Diagnostics → Opt-in crash log. See Help → Crash reports.
      </p>
    </Panel>
  )
}
