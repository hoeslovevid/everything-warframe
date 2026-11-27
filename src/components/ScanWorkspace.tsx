import { useEffect, useRef, useState } from 'react'
import type { AppSettings, DisplayChoice, OcrWarmupStatus, RelicScanState, RivenScanState } from '../../shared/types'
import { WF_THEME_OPTIONS } from '../../shared/types'
import { RelicsPanel } from '../modules/relics/RelicsPanel'
import { RivenPanel } from '../modules/rivens/RivenPanel'
import { prettyHotkey } from '../lib/hotkey'
import { pushToast } from '../lib/toast'
import './scan-workspace.css'

type Props = {
  settings: AppSettings
  displays: DisplayChoice[]
  warmup: OcrWarmupStatus
  relic: RelicScanState
  riven: RivenScanState
  onUpdate: (partial: Partial<AppSettings>) => Promise<void>
  onLayout: () => void
  onSettings: () => void
  onScanRelics: () => Promise<unknown>
  onScanRivens: () => Promise<unknown>
  onRelicLink: (target: 'sets' | 'foundry' | 'market' | 'lfg', query: string) => void
}

export function ScanWorkspace({ settings, displays, warmup, relic, riven, onUpdate, onLayout,
  onSettings, onScanRelics, onScanRivens, onRelicLink }: Props) {
  const [mode, setMode] = useState<'relics' | 'rivens'>('relics')
  const [countdown, setCountdown] = useState<number | null>(null)
  const timer = useRef<ReturnType<typeof setInterval> | null>(null)
  const mounted = useRef(true)
  const busy = relic.scanning || riven.scanning
  const available = Boolean(window.voidlens)
  const duration = mode === 'relics' ? relic.scanMeta?.durationMs : riven.durationMs
  const scannedAt = mode === 'relics' ? relic.scannedAt : riven.scannedAt
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; if (timer.current) clearInterval(timer.current) }
  }, [])

  const cancel = () => {
    if (timer.current) clearInterval(timer.current)
    timer.current = null
    setCountdown(null)
  }

  const scan = async () => {
    if (busy || countdown !== null || !available) return
    try {
      if (!settings.modules[mode]) await onUpdate({ modules: { ...settings.modules, [mode]: true } })
      if (!mounted.current) return
      setCountdown(3)
      let remaining = 3
      timer.current = setInterval(() => {
        remaining--
        if (remaining > 0) { setCountdown(remaining); return }
        cancel()
        void (mode === 'relics' ? onScanRelics() : onScanRivens()).catch((err) => {
          pushToast(err instanceof Error ? err.message : 'Scan failed. Try again.', 'error')
        })
      }, 1000)
    } catch (err) {
      pushToast(err instanceof Error ? err.message : 'Could not prepare scan', 'error')
    }
  }

  const engineLabel = busy ? 'Reading screen' : warmup.phase === 'ready' ? 'Engine ready'
    : warmup.phase === 'warming' ? 'Preparing engine' : warmup.phase === 'failed' ? 'Setup needs attention' : 'Starts on first scan'

  return (
    <div className="scan-workspace">
      <header className="scan-heading">
        <div><div className="workspace-eyebrow">SCREEN RECOGNITION</div>
          <h2>Read the reward. Make the call.</h2>
          <p>Relic values and riven comparisons, right when you need them.</p>
        </div>
        <button className="btn" onClick={onLayout}>Adjust capture areas <span aria-hidden>↗</span></button>
      </header>

      <div className="scan-mode-picker" role="tablist" aria-label="Scan type">
        {(['relics', 'rivens'] as const).map((id) => (
          <button key={id} role="tab" id={`scan-tab-${id}`} aria-controls={`scan-panel-${id}`}
            aria-selected={mode === id} tabIndex={mode === id ? 0 : -1} disabled={countdown !== null || busy}
            onKeyDown={(e) => {
              if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return
              e.preventDefault()
              const next = e.key === 'Home' ? 'relics' : e.key === 'End' ? 'rivens' : mode === 'relics' ? 'rivens' : 'relics'
              setMode(next)
              document.getElementById(`scan-tab-${next}`)?.focus()
            }}
            className={`scan-mode ${mode === id ? 'is-selected' : ''}`} onClick={() => setMode(id)}>
            <span className={`scan-mode-symbol is-${id}`} aria-hidden>{id === 'relics' ? '◈' : '◇'}</span>
            <span><strong>{id === 'relics' ? 'Relic rewards' : 'Riven comparison'}</strong>
              <small>{id === 'relics' ? 'Platinum · ducats · missing parts' : 'Current roll · reroll · stat grades'}</small></span>
            <kbd>{prettyHotkey(settings.hotkeys[id === 'relics' ? 'scanRelics' : 'scanRivens'])}</kbd>
          </button>
        ))}
      </div>

      <div className="scan-console" role="tabpanel" id={`scan-panel-${mode}`} aria-labelledby={`scan-tab-${mode}`}>
        <div className={`scan-viewfinder ${busy ? 'is-reading' : ''}`} aria-hidden>
          <span className="scan-viewfinder__corner" /><span className="scan-viewfinder__cross">+</span>
          <div className="scan-viewfinder__cards">
            {Array.from({ length: mode === 'relics' ? 4 : 2 }, (_, i) => <div key={i} className="scan-viewfinder__card"><i /><b /><b /><b /></div>)}
          </div>
          <span className="scan-viewfinder__caption">{mode === 'relics' ? 'REWARD SELECTION' : 'KUVA CYCLE / COMPARE'}</span>
        </div>
        <div className="scan-console__body">
          <span className={`scan-engine-state ${warmup.phase === 'ready' ? 'is-ready' : ''}`}><i />{engineLabel}</span>
          <h3>{mode === 'relics' ? 'Every reward, in perspective.' : 'Know what changed.'}</h3>
          <p>{mode === 'relics' ? 'Open the fissure reward selection in Warframe. Keep item labels visible and scan before choosing your reward.'
            : 'Open the Kuva Cycle comparison with both cards visible. Read the detected stats before accepting a new roll.'}</p>
          <div className="scan-console__actions">
            <button className="btn primary" disabled={!available || busy || countdown !== null} onClick={() => void scan()}>
              {busy ? 'Reading screen…' : countdown !== null ? `Scanning in ${countdown}…` : mode === 'relics' ? 'Scan rewards' : 'Compare rivens'}
              <span aria-hidden>↗</span>
            </button>
            {countdown !== null ? <button className="btn ghost" onClick={cancel}>Cancel</button> : <button className="btn ghost" onClick={onLayout}>Calibrate</button>}
          </div>
          <p className="scan-console__hint" role="status" aria-live="polite">{countdown !== null ? `Switch to Warframe. Capture starts in ${countdown} seconds.`
            : !available ? 'Open the desktop app to capture your game.' : 'The companion minimizes for capture. Or scan by hotkey in Warframe.'}</p>
        </div>
      </div>

      <div className="scan-facts">
        <div><span>Capture display</span><strong>{displays.find((d) => d.id === settings.ocrDisplayId)?.label || 'Automatic / primary'}</strong></div>
        <div><span>Last recognition</span><strong>{duration != null ? `${(duration / 1000).toFixed(2)} s` : 'No scan yet'}</strong></div>
        <div><span>Reading strategy</span><strong>Progressive · targeted retries</strong></div>
        <div><span>Game resources</span><strong>{settings.gamePerformanceMode ? 'Performance mode' : 'Balanced'}</strong></div>
      </div>

      <section className="scan-results" aria-label="Scan results">
        <div className="workspace-section-heading"><h3>Latest reading</h3><span>{busy ? 'Updating as results arrive' : scannedAt ? new Date(scannedAt).toLocaleTimeString() : 'Your next scan appears here'}</span></div>
        {mode === 'relics' ? <RelicsPanel scanHotkey={prettyHotkey(settings.hotkeys.scanRelics)} dismissHotkey={prettyHotkey(settings.hotkeys.dismissRelics)} onDeepLink={onRelicLink} />
          : <RivenPanel scanHotkey={prettyHotkey(settings.hotkeys.scanRivens)} dismissHotkey={prettyHotkey(settings.hotkeys.dismissRivens)} />}
      </section>

      <details className="scan-tuning">
        <summary>Recognition setup <span>Theme, monitor & performance</span></summary>
        <div className="scan-tuning__grid">
          <label>Game / OCR monitor<select value={settings.ocrDisplayId ?? ''} onChange={(e) => void onUpdate({ ocrDisplayId: e.target.value ? Number(e.target.value) : null })}>
            <option value="">Automatic / primary</option>{displays.map((d) => <option value={d.id} key={d.id}>{d.label}</option>)}
          </select></label>
          <label>Warframe UI theme<select value={settings.wfThemeOverride ?? ''} onChange={(e) => void onUpdate({ wfThemeOverride: (e.target.value || null) as AppSettings['wfThemeOverride'] })}>
            <option value="">Auto detect</option>{WF_THEME_OPTIONS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select></label>
          <label>Resource preference<select value={settings.gamePerformanceMode ? 'performance' : 'balanced'} onChange={(e) => void onUpdate({ gamePerformanceMode: e.target.value === 'performance' })}>
            <option value="balanced">Balanced</option><option value="performance">Prioritize game performance</option>
          </select></label>
        </div>
        <p>Use Borderless Windowed and select the display running Warframe. If a reading misses text, adjust its capture area to match your UI scale.</p>
        <button className="btn ghost" onClick={onSettings}>All recognition settings →</button>
      </details>
    </div>
  )
}
