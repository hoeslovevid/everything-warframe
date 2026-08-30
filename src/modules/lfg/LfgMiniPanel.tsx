import { useCallback, useEffect, useState } from 'react'
import type { LfgListing } from '../../../shared/types'
import { Panel } from '../../components/Panel'
import '../cycles/module.css'
import './lfg.css'

type Props = {
  opacity?: number
}

/**
 * Compact overlay LFG board: open seats + jump to companion.
 */
export function LfgMiniPanel({ opacity }: Props) {
  const [listings, setListings] = useState<LfgListing[]>([])
  const [error, setError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    if (!window.voidlens?.listLfg) return
    try {
      const res = await window.voidlens.listLfg({ activity: 'all' })
      const open = (res.listings || [])
        .filter((l) => (l.slotsOpen ?? 0) > 0)
        .slice(0, 5)
      setListings(open)
      setError(res.error || res.warning || null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'LFG unavailable')
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 60_000)
    const unsub = window.voidlens?.onLfgEvent?.(() => {
      void refresh()
    })
    return () => {
      window.clearInterval(id)
      unsub?.()
    }
  }, [refresh])

  const openCompanion = (tab: 'lfg') => {
    void window.voidlens?.navigateCompanion?.(tab)
  }

  return (
    <Panel title="LFG" subtitle="Open seats" opacity={opacity}>
      {error ? <p className="mod-empty">{error}</p> : null}
      {!error && listings.length === 0 ? (
        <p className="mod-empty">No open seats right now</p>
      ) : null}
      <ul className="mod-list">
        {listings.map((l) => (
          <li key={l.id} className="mod-row">
            <div>
              <div className="mod-row__title">{l.title}</div>
              <div className="mod-row__meta">
                {l.hostIgn}
                {l.relicKey ? ` · ${l.relicKey}` : ''}
                {l.intent === 'seek' ? ' · seeking host' : ''}
              </div>
            </div>
            <div className="mod-row__value">
              {l.slotsOpen}/{l.slotsTotal}
            </div>
          </li>
        ))}
      </ul>
      <div className="lfg-mini-actions">
        <button type="button" className="btn ghost" onClick={() => openCompanion('lfg')}>
          Open companion LFG
        </button>
        <button type="button" className="btn primary" onClick={() => openCompanion('lfg')}>
          Post LFG
        </button>
      </div>
    </Panel>
  )
}
