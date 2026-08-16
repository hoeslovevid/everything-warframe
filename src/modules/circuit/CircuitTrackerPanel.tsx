import { useCallback, useEffect, useState } from 'react'
import type { CircuitTrackerSnapshot } from '../../../shared/types'
import { Panel } from '../../components/Panel'
import { useInventory } from '../../hooks/useInventory'
import { useNow } from '../../hooks/useNow'
import { formatCountdown } from '../../lib/time'
import './circuit-tracker.css'

type Props = {
  /** Bump when worldstate refreshes. */
  worldstateKey?: string
  onSyncInventory?: () => void
}

export function CircuitTrackerPanel({ worldstateKey, onSyncInventory }: Props) {
  const { status: inventory } = useInventory()
  const now = useNow()
  const [snap, setSnap] = useState<CircuitTrackerSnapshot | null>(null)

  const refresh = useCallback(async () => {
    if (!window.voidlens?.getCircuitTracker) return
    try {
      setSnap(await window.voidlens.getCircuitTracker())
    } catch {
      setSnap(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, worldstateKey, inventory.revision, inventory.loaded])

  return (
    <Panel
      title="Circuit / Incarnon"
      subtitle={
        snap?.rewards.length
          ? `${snap.ownedCount}/${snap.rewards.length} owned · ${snap.missingCount} to farm`
          : 'Steel Path weekly rotation'
      }
      className="circuit-tracker"
    >
      {!snap?.rewards.length ? (
        <p className="muted" style={{ margin: 0 }}>
          No Circuit rotation from worldstate yet. Refresh Dashboard or check warframestat.
        </p>
      ) : (
        <>
          <div className="circuit-tracker__meta">
            {snap.currentReward ? (
              <span>
                This week: <strong>{snap.currentReward}</strong>
              </span>
            ) : null}
            {snap.expiry ? (
              <span className="muted">{formatCountdown(snap.expiry, now)}</span>
            ) : snap.eta ? (
              <span className="muted">{snap.eta}</span>
            ) : null}
          </div>
          {!snap.inventoryLoaded ? (
            <p className="muted" style={{ margin: '8px 0 0' }}>
              Sync inventory to mark owned vs missing.
              {onSyncInventory ? (
                <>
                  {' '}
                  <button type="button" className="btn ghost" onClick={onSyncInventory}>
                    Sync now
                  </button>
                </>
              ) : null}
            </p>
          ) : null}
          <ul className="circuit-tracker__list">
            {snap.rewards.map((r) => (
              <li
                key={r.name}
                className={`circuit-tracker__row${r.isCurrent ? ' is-current' : ''}${
                  r.owned ? ' is-owned' : ' is-missing'
                }`}
              >
                <div className="circuit-tracker__name">
                  {r.name}
                  {r.isCurrent ? <span className="vl-pill">Now</span> : null}
                </div>
                <div className="circuit-tracker__note">{r.note}</div>
                <div className="circuit-tracker__status">{r.owned ? 'Owned' : 'Farm'}</div>
              </li>
            ))}
          </ul>
        </>
      )}
    </Panel>
  )
}
