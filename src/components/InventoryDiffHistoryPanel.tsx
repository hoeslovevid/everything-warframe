import { useCallback, useEffect, useState } from 'react'
import type { InventoryDiffHistoryEntry, InventoryDiffHistoryResult } from '../../shared/types'
import { EmptyState } from './EmptyState'
import { Panel } from './Panel'

function formatWhen(iso: string) {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export function InventoryDiffHistoryPanel() {
  const [hist, setHist] = useState<InventoryDiffHistoryResult>({ entries: [] })
  const [openId, setOpenId] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!window.voidlens?.getInventoryDiffHistory) return
    setLoading(true)
    try {
      setHist(await window.voidlens.getInventoryDiffHistory())
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const renderRows = (entry: InventoryDiffHistoryEntry) => {
    const rows = [
      ...entry.added.map((r) => ({ ...r, kind: '+' as const })),
      ...entry.changed.filter((c) => c.delta !== 0).map((r) => ({ ...r, kind: '~' as const })),
      ...entry.removed.map((r) => ({ ...r, kind: '-' as const })),
    ].slice(0, 24)
    if (!rows.length) return <p className="muted">No item rows stored for this sync.</p>
    return (
      <ul className="mod-list" style={{ listStyle: 'none', margin: '8px 0 0', padding: 0 }}>
        {rows.map((r) => (
          <li key={`${entry.id}:${r.uniqueName}`} className="mod-stat" style={{ marginBottom: 4 }}>
            <span className="mod-stat__label">
              {r.kind} {r.displayName}
            </span>
            <span className="mod-stat__value">
              {r.before} → {r.after} ({r.delta >= 0 ? '+' : ''}
              {r.delta})
            </span>
          </li>
        ))}
      </ul>
    )
  }

  return (
    <Panel
      title="Inventory history"
      subtitle="What changed across syncs (kept locally)"
      actions={
        <>
          <button className="btn ghost" type="button" onClick={() => void refresh()} disabled={loading}>
            Refresh
          </button>
          <button
            className="btn ghost"
            type="button"
            onClick={() =>
              void window.voidlens?.clearInventoryDiffHistory?.().then((next) => setHist(next))
            }
          >
            Clear
          </button>
        </>
      }
    >
      {!hist.entries.length ? (
        <EmptyState
          title="No sync history yet"
          body="Sync inventory (or import a file) after you already have one loaded — deltas land here."
        />
      ) : (
        <ul className="mod-list" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
          {hist.entries.map((entry) => {
            const open = openId === entry.id
            return (
              <li key={entry.id} style={{ marginBottom: 10 }}>
                <button
                  type="button"
                  className="linkish"
                  onClick={() => setOpenId(open ? null : entry.id)}
                  style={{ textAlign: 'left' }}
                >
                  {formatWhen(entry.syncedAt)} · +{entry.summary.addedStacks} / ~
                  {entry.summary.changedStacks} / −{entry.summary.removedStacks} · net{' '}
                  {entry.summary.netUnits >= 0 ? '+' : ''}
                  {entry.summary.netUnits}
                </button>
                {open ? renderRows(entry) : null}
              </li>
            )
          })}
        </ul>
      )}
    </Panel>
  )
}
