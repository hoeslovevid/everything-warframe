import { useCallback, useEffect, useState } from 'react'
import type { ArbitrationAnalytics, ArbitrationLogSnapshot } from '../../../shared/types'
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
  const [analytics, setAnalytics] = useState<ArbitrationAnalytics | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!window.voidlens?.getArbitrationLog) return
    setLoading(true)
    try {
      const [nextLog, nextAnalytics] = await Promise.all([
        window.voidlens.getArbitrationLog(),
        window.voidlens.getArbitrationAnalytics?.() ?? Promise.resolve(null),
      ])
      setLog(nextLog)
      setAnalytics(nextAnalytics)
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
          Session + multi-day analytics of rare-ish inventory gains after mission complete or sync
          while Arbitration is active. Sync after extract to capture drops.
        </p>
      </header>

      {analytics ? (
        <Panel
          title="Analytics"
          subtitle={
            analytics.historyDays
              ? `${analytics.historyDays} day${analytics.historyDays === 1 ? '' : 's'} · persisted locally`
              : 'No history yet'
          }
        >
          <div className="economy-grid">
            <div>
              <div className="muted" style={{ fontSize: '0.72rem' }}>
                Runs
              </div>
              <strong>{analytics.totals.runs}</strong>
            </div>
            <div>
              <div className="muted" style={{ fontSize: '0.72rem' }}>
                Vitus
              </div>
              <strong>{analytics.totals.vitusEssence}</strong>
              {analytics.vitusPerHour != null ? (
                <div className="muted">{analytics.vitusPerHour}/hr</div>
              ) : null}
            </div>
            <div>
              <div className="muted" style={{ fontSize: '0.72rem' }}>
                Rare drops
              </div>
              <strong>{analytics.totals.rareDrops}</strong>
            </div>
          </div>
          {analytics.byNode.length ? (
            <ul className="mod-list" style={{ listStyle: 'none', margin: '12px 0 0', padding: 0 }}>
              {analytics.byNode.slice(0, 6).map((n) => (
                <li key={n.node} className="mod-stat" style={{ marginBottom: 4 }}>
                  <span className="mod-stat__label">{n.node}</span>
                  <span className="mod-stat__value">
                    {n.runs} run{n.runs === 1 ? '' : 's'} · {n.vitus} Vitus · {n.rareDrops} rare
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
          {analytics.byDay.length > 1 ? (
            <div className="economy-spark" aria-hidden style={{ marginTop: 12 }}>
              {analytics.byDay
                .slice(0, 14)
                .reverse()
                .map((d) => {
                  const maxV = Math.max(1, ...analytics.byDay.map((x) => x.vitus))
                  return (
                    <span
                      key={d.day}
                      title={`${d.day}: ${d.vitus} Vitus`}
                      style={{
                        height: `${Math.max(8, Math.round((d.vitus / maxV) * 100))}%`,
                      }}
                    />
                  )
                })}
            </div>
          ) : null}
        </Panel>
      ) : null}

      <Panel
        title="Recent runs"
        subtitle={
          log
            ? `${log.runs.length} run${log.runs.length === 1 ? '' : 's'} · session from ${new Date(log.sessionStartedAt).toLocaleTimeString()}`
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
                void window.voidlens?.clearArbitrationLog?.().then((next) => {
                  setLog(next)
                  void refresh()
                })
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
            body="Play Arbitration, extract, then Sync inventory. Rare gains (Vitus, Adaptation, Aura Forma…) land here and persist across app restarts."
          />
        ) : (
          <ul className="mod-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {log.runs.map((run) => (
              <li key={run.id} className="mod-stat" style={{ alignItems: 'flex-start', marginBottom: 10 }}>
                <div style={{ flex: 1 }}>
                  <div className="mod-row__title">
                    {run.node || 'Unknown node'} · {run.source.replace('_', ' ')}
                  </div>
                  <div className="mod-row__meta">{new Date(run.at).toLocaleString()}</div>
                  <ul style={{ margin: '6px 0 0', paddingLeft: 16 }}>
                    {run.drops.map((d) => (
                      <li key={`${run.id}:${d.uniqueName}`}>
                        {d.displayName} {d.delta >= 0 ? '+' : ''}
                        {d.delta}
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
