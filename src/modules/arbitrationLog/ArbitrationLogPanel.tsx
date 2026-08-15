import { useCallback, useEffect, useState } from 'react'
import type { ArbitrationLogSnapshot } from '../../../shared/types'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { useInventory } from '../../hooks/useInventory'
import '../foundry/foundry.css'

type Props = {
  onSyncInventory?: () => void
}

export function ArbitrationLogPanel({ onSyncInventory }: Props) {
  const { status: inventory } = useInventory()
  const [log, setLog] = useState<ArbitrationLogSnapshot | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!window.voidlens?.getArbitrationLog) return
    setLoading(true)
    try {
      setLog(await window.voidlens.getArbitrationLog())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, inventory.revision])

  return (
    <>
      <header className="page-header">
        <h2 className="page-title">Arbitration haul</h2>
        <div className="page-title-rule" />
        <p className="page-desc">
          Session log of rare-ish inventory gains after mission complete or sync while Arbitration is
          active. Sync after extract to capture drops.
        </p>
      </header>

      <Panel
        title="This session"
        subtitle={
          log
            ? `${log.runs.length} run${log.runs.length === 1 ? '' : 's'} since ${new Date(log.sessionStartedAt).toLocaleTimeString()}`
            : loading
              ? 'Loading…'
              : '—'
        }
        actions={
          <>
            {onSyncInventory ? (
              <button className="btn primary" onClick={onSyncInventory}>
                Sync inventory
              </button>
            ) : null}
            <button className="btn ghost" onClick={() => void refresh()} disabled={loading}>
              Refresh
            </button>
            <button
              className="btn ghost"
              onClick={() =>
                void window.voidlens?.clearArbitrationLog?.().then((next) => setLog(next))
              }
            >
              Clear
            </button>
          </>
        }
      >
        {!log?.runs.length ? (
          <EmptyState
            title="No Arbitration hauls yet"
            body="Play Arbitration, extract, then Sync inventory. Rare gains (Vitus, Adaptation, Aura Forma…) land here for this app session."
          />
        ) : (
          <ul className="mod-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {log.runs.map((run) => (
              <li key={run.id} className="mod-stat" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="mod-row__title">
                    {new Date(run.at).toLocaleTimeString()}
                    {run.node ? ` · ${run.node}` : ''}
                    <span className="muted"> · {run.source === 'mission_complete' ? 'after extract' : 'on sync'}</span>
                  </div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                    {run.drops.map((d) => (
                      <li key={`${run.id}-${d.uniqueName}`}>
                        +{d.delta} {d.displayName}
                        {d.rare ? ' · rare' : ''}
                      </li>
                    ))}
                  </ul>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  )
}
