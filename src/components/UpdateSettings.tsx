import { useCallback, useEffect, useState } from 'react'
import { AppUpdateStatus } from '../../shared/types'
import { Panel } from './Panel'
import '../modules/cycles/module.css'
import '../modules/baro/baro.css'

const empty: AppUpdateStatus = {
  supported: false,
  checking: false,
  available: false,
  downloading: false,
  downloaded: false,
  currentVersion: '0.0.0',
  latestVersion: null,
  progress: 0,
  error: null,
  message: '',
}

export function UpdateSettings() {
  const [status, setStatus] = useState<AppUpdateStatus>(empty)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let unsub = () => {}
    const boot = async () => {
      if (!window.voidlens) return
      setStatus(await window.voidlens.getUpdateStatus())
      unsub = window.voidlens.onUpdateStatus(setStatus)
    }
    void boot()
    return () => unsub()
  }, [])

  const check = useCallback(async () => {
    if (!window.voidlens) return
    setBusy(true)
    try {
      setStatus(await window.voidlens.checkForUpdates())
    } finally {
      setBusy(false)
    }
  }, [])

  const install = useCallback(async () => {
    if (!window.voidlens) return
    await window.voidlens.installUpdate()
  }, [])

  return (
    <Panel title="Updates" subtitle="GitHub Releases auto-update" className="baro-panel--wide">
      <div className="mod-stack">
        <div className="mod-stat">
          <span className="mod-stat__label">Installed</span>
          <span className="mod-stat__value">v{status.currentVersion}</span>
        </div>
        {status.latestVersion ? (
          <div className="mod-stat">
            <span className="mod-stat__label">Latest checked</span>
            <span className="mod-stat__value">v{status.latestVersion}</span>
          </div>
        ) : null}
        <p className="muted" style={{ margin: 0 }}>
          {status.message}
        </p>
        {status.error ? <p className="muted">Error: {status.error}</p> : null}
        {status.downloading ? (
          <p className="muted">Progress: {status.progress}%</p>
        ) : null}

        <div className="toolbar">
          <button
            className="btn primary"
            disabled={busy || status.checking || status.downloading}
            onClick={() => void check()}
          >
            {status.checking ? 'Checking…' : 'Check for updates'}
          </button>
          <button
            className="btn"
            disabled={!status.downloaded}
            onClick={() => void install()}
          >
            Restart &amp; install
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() => {
              window.dispatchEvent(
                new CustomEvent('voidlens:show-whats-new', {
                  detail: { version: status.currentVersion },
                }),
              )
            }}
          >
            What’s new
          </button>
          <a
            className="btn ghost"
            href="https://github.com/hoeslovevid/everything-warframe/releases"
            target="_blank"
            rel="noreferrer"
            style={{ textDecoration: 'none', display: 'inline-flex', alignItems: 'center' }}
          >
            Open releases
          </a>
        </div>

        {!status.supported ? (
          <p className="muted">
            Auto-update works after you install a release build. Dev mode (`npm start`) will not
            self-update.
          </p>
        ) : null}
      </div>
    </Panel>
  )
}
