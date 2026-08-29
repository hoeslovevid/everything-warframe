import { useCallback, useEffect, useState } from 'react'
import { AppUpdateStatus } from '../../shared/types'
import { getWhatsNewBullets } from '../lib/whatsNew'
import { Panel } from './Panel'

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

/**
 * Hard-to-miss update banner for Dashboard when an update is available/downloaded.
 */
export function UpdateBanner() {
  const [status, setStatus] = useState<AppUpdateStatus>(empty)

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

  const install = useCallback(async () => {
    await window.voidlens?.installUpdate()
  }, [])

  const check = useCallback(async () => {
    if (!window.voidlens) return
    setStatus(await window.voidlens.checkForUpdates())
  }, [])

  if (!status.supported) return null
  if (!status.available && !status.downloaded && !status.downloading) return null

  const ver = status.latestVersion || 'update'
  const bullets = status.latestVersion ? getWhatsNewBullets(status.latestVersion) : []

  return (
    <Panel
      title={status.downloaded ? `Restart to install v${ver}` : `Update available · v${ver}`}
      subtitle={
        status.downloaded
          ? 'Download finished — restart to apply'
          : status.downloading
            ? `Downloading… ${status.progress}%`
            : status.message || 'A newer build is ready'
      }
      className="update-banner-panel"
      actions={
        status.downloaded ? (
          <button className="btn primary" type="button" onClick={() => void install()}>
            Restart & install
          </button>
        ) : status.downloading ? null : (
          <button className="btn primary" type="button" onClick={() => void check()}>
            Download / check
          </button>
        )
      }
    >
      {bullets.length ? (
        <ul style={{ margin: '0 0 8px', paddingLeft: 18 }}>
          {bullets.slice(0, 5).map((b) => (
            <li key={b} className="muted" style={{ fontSize: '0.85rem' }}>
              {b}
            </li>
          ))}
        </ul>
      ) : (
        <p className="muted" style={{ margin: 0 }}>
          See What’s new after restart for full notes.
        </p>
      )}
      {status.error ? <p className="muted">Error: {status.error}</p> : null}
    </Panel>
  )
}
