import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSettings, InventoryStatus } from '../../shared/types'
import { copyText } from '../lib/tradeClipboard'
import { pushToast } from '../lib/toast'
import './linux-health.css'

type Props = {
  settings: AppSettings
  inventory: InventoryStatus | null
  onDetectEeLog: () => void
  onSyncInventory: () => void
  onOpenCaptureWizard?: () => void
}

type PtraceInfo = {
  scope: number | null
  permissive: boolean
  label: string
  detail: string
  fixCommand: string
  tip: string
}

type Row = {
  label: string
  state: 'ok' | 'warn' | 'off'
  detail: string
  fix?: () => void
  fixLabel?: string
}

export function LinuxHealthCard({
  settings,
  inventory,
  onDetectEeLog,
  onSyncInventory,
  onOpenCaptureWizard,
}: Props) {
  const [captureMsg, setCaptureMsg] = useState<string | null>(null)
  const [health, setHealth] = useState<{
    ptrace: PtraceInfo
    steamRunning: boolean
    wineLauncherFound: boolean
    protonPrefix: string | null
  } | null>(null)
  const ptrace = health?.ptrace ?? null
  const isLinux =
    inventory?.platform === 'linux' ||
    (typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent))

  const refreshPtrace = useCallback(async () => {
    if (!window.voidlens?.getLinuxHealth) return
    try {
      const snap = await window.voidlens.getLinuxHealth()
      if (snap.platform !== 'linux') {
        setHealth(null)
        return
      }
      setHealth({
        ptrace: snap.ptrace,
        steamRunning: Boolean(snap.steamRunning),
        wineLauncherFound: Boolean(snap.wineLauncherFound),
        protonPrefix: snap.protonPrefix ?? null,
      })
    } catch {
      setHealth(null)
    }
  }, [])

  useEffect(() => {
    if (!isLinux) return
    void refreshPtrace()
  }, [isLinux, refreshPtrace, inventory?.revision, inventory?.error])

  const copyFix = useCallback(async () => {
    const cmd = ptrace?.fixCommand || 'sudo sysctl -w kernel.yama.ptrace_scope=0'
    const ok = await copyText(cmd)
    if (ok) pushToast('ptrace fix command copied', 'ok')
    else pushToast('Could not copy — select the command manually', 'warn')
  }, [ptrace?.fixCommand])

  const rows = useMemo((): Row[] => {
    if (!isLinux) return []
    const list: Row[] = [
      {
        label: 'EE.log',
        state: settings.eeLogPath ? 'ok' : 'warn',
        detail: settings.eeLogPath ? 'bound' : 'not found',
        fix: onDetectEeLog,
        fixLabel: 'Detect',
      },
      {
        label: 'Steam',
        state: health?.steamRunning ? 'ok' : 'warn',
        detail: health?.steamRunning ? 'running' : 'not detected',
      },
      {
        label: 'Proton / Wine',
        state: health?.wineLauncherFound || health?.protonPrefix ? 'ok' : 'warn',
        detail: health?.protonPrefix
          ? 'Warframe prefix found'
          : health?.wineLauncherFound
            ? 'Wine launcher found'
            : 'launch Warframe via Steam once',
      },
      {
        label: 'Proton prefix',
        state: inventory?.protonPlay || health?.protonPrefix ? 'ok' : 'warn',
        detail:
          inventory?.protonPlay || health?.protonPrefix
            ? 'Warframe compatdata found'
            : 'launch Warframe via Steam once',
      },
      {
        label: 'Memory access',
        state: !ptrace
          ? 'off'
          : ptrace.permissive
            ? 'ok'
            : 'warn',
        detail: ptrace?.detail || 'checking ptrace_scope…',
        fix: ptrace && !ptrace.permissive ? () => void copyFix() : () => void refreshPtrace(),
        fixLabel: ptrace && !ptrace.permissive ? 'Copy fix' : 'Recheck',
      },
      {
        label: 'Inventory',
        state: inventory?.loaded ? (inventory.stale ? 'warn' : 'ok') : 'off',
        detail: inventory?.loaded
          ? inventory.stale
            ? `stale${inventory.helperVersion ? ` · helper v${inventory.helperVersion}` : ''}`
            : `synced${inventory.helperVersion ? ` · helper v${inventory.helperVersion}` : ''}`
          : inventory?.consent
            ? inventory?.error
              ? inventory.error.slice(0, 80)
              : 'not synced — or import AlecaFrame'
            : 'consent needed',
        fix: inventory?.consent ? onSyncInventory : undefined,
        fixLabel: 'Sync',
      },
      {
        label: 'Screen capture',
        state: settings.onboarding.linuxCaptureAck ? 'ok' : 'warn',
        detail: settings.onboarding.linuxCaptureAck
          ? captureMsg || 'wizard acknowledged'
          : 'PipeWire share not set up',
        fix: onOpenCaptureWizard,
        fixLabel: 'Wizard',
      },
    ]
    return list
  }, [
    isLinux,
    settings.eeLogPath,
    settings.onboarding.linuxCaptureAck,
    inventory,
    captureMsg,
    ptrace,
    health,
    onDetectEeLog,
    onSyncInventory,
    onOpenCaptureWizard,
    copyFix,
    refreshPtrace,
  ])

  if (!isLinux || !rows.length) return null

  const testCapture = async () => {
    const res = await window.voidlens?.testScreenCapture?.()
    const msg = res?.message || (res?.ok ? 'Capture OK' : 'Capture failed')
    setCaptureMsg(msg)
    pushToast(msg, res?.ok ? 'ok' : 'warn')
  }

  const showPtraceTip = ptrace && !ptrace.permissive

  return (
    <section className="linux-health" aria-label="Linux health">
      <div className="linux-health__head">
        <h3 className="linux-health__title">Linux health</h3>
        <div className="linux-health__head-actions">
          <button type="button" className="btn ghost" onClick={() => void refreshPtrace()}>
            Refresh
          </button>
          <button type="button" className="btn ghost" onClick={() => void testCapture()}>
            Test capture
          </button>
        </div>
      </div>
      <ul className="linux-health__list">
        {rows.map((r) => (
          <li key={r.label} className={`linux-health__row is-${r.state}`}>
            <span className="linux-health__dot" data-state={r.state} />
            <span className="linux-health__label">{r.label}</span>
            <span className="linux-health__detail" title={r.detail}>
              {r.detail}
            </span>
            {r.fix ? (
              <button type="button" className="btn ghost linux-health__fix" onClick={r.fix}>
                {r.fixLabel || 'Fix'}
              </button>
            ) : null}
          </li>
        ))}
      </ul>
      {showPtraceTip ? (
        <div className="linux-health__tip" role="note">
          <p className="linux-health__tip-text">
            Restricted ptrace often causes <strong>gruzzle failed</strong> during inventory sync.
            In a terminal run the command below (resets on reboot unless you make it permanent in{' '}
            <code>/etc/sysctl.d/</code>), stay on the Orbiter, then Sync. Do not run the AppImage as
            root.
          </p>
          <code className="linux-health__cmd">{ptrace.fixCommand}</code>
          <div className="linux-health__tip-actions">
            <button type="button" className="btn ghost" onClick={() => void copyFix()}>
              Copy command
            </button>
            <button
              type="button"
              className="btn primary"
              disabled={!inventory?.consent}
              onClick={() => {
                void refreshPtrace().then(() => onSyncInventory())
              }}
            >
              Sync after fix
            </button>
          </div>
        </div>
      ) : ptrace?.permissive ? (
        <p className="linux-health__hint muted">
          Memory access looks open. Sync while fully logged into Warframe (Orbiter), not the
          launcher. AppImage builds enable PipeWire capture flags automatically — no manual
          --no-sandbox launch needed unless capture still fails (then set EW_NO_SANDBOX=1).
        </p>
      ) : null}
      <p className="linux-health__hint muted" style={{ marginTop: 10 }}>
        OCR tip (Proton): Borderless Windowed, Settings → Game/OCR monitor = Warframe’s screen,
        leave the PipeWire share on that same monitor. Force Relic UI theme / 3-player slots if
        names look wrong.
      </p>
    </section>
  )
}
