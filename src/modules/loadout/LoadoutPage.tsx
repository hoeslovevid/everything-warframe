import { useCallback, useEffect, useMemo, useState } from 'react'
import type { LoadoutCategory, LoadoutItem, LoadoutSnapshot } from '../../../shared/types'
import { EmptyState } from '../../components/EmptyState'
import { InventoryStaleBanner } from '../../components/InventoryStaleBanner'
import { Panel } from '../../components/Panel'
import { useInventory } from '../../hooks/useInventory'
import '../foundry/foundry.css'
import './loadout.css'

type Props = {
  onOpenSettings: () => void
  onSyncInventory?: () => void
}

const CATS: Array<{ id: LoadoutCategory | 'all'; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'warframe', label: 'Warframes' },
  { id: 'primary', label: 'Primary' },
  { id: 'secondary', label: 'Secondary' },
  { id: 'melee', label: 'Melee' },
  { id: 'companion', label: 'Companions' },
]

function tagLabel(tag: string) {
  if (tag === 'sp_ready') return 'SP ready'
  if (tag === 'unranked') return 'Needs rank'
  if (tag === 'under_forma') return 'Light Forma'
  if (tag === 'forma_ok') return 'Forma OK'
  return 'Rank ?'
}

export function LoadoutPage({ onOpenSettings, onSyncInventory }: Props) {
  const { status: inventory } = useInventory()
  const [snap, setSnap] = useState<LoadoutSnapshot | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [cat, setCat] = useState<LoadoutCategory | 'all'>('all')
  const [focus, setFocus] = useState<'coach' | 'all'>('coach')

  const refresh = useCallback(async () => {
    if (!window.voidlens?.getLoadoutSnapshot) return
    setLoading(true)
    setError(null)
    try {
      setSnap(await window.voidlens.getLoadoutSnapshot())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load loadout coaching')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh, inventory.revision, inventory.loaded])

  const rows = useMemo(() => {
    const items = snap?.items || []
    const byCat = cat === 'all' ? items : items.filter((i) => i.category === cat)
    if (focus === 'all') return byCat
    return byCat.filter(
      (i) => i.tags.includes('unranked') || i.tags.includes('under_forma') || i.tags.includes('unknown_rank'),
    )
  }, [snap, cat, focus])

  return (
    <>
      <header className="page-header">
        <h2 className="page-title">Loadout coaching</h2>
        <div className="page-title-rule" />
        <p className="page-desc">
          Owned Warframes and weapons from inventory — rank and Forma coaching for Steel Path. This
          is not a live “currently equipped” readout.
        </p>
      </header>

      <InventoryStaleBanner
        inventory={inventory}
        onOpenInventory={onOpenSettings}
        onSyncInventory={onSyncInventory}
      />

      {!inventory.loaded ? (
        <Panel title="Inventory required">
          <EmptyState
            title="No inventory loaded"
            body="Sync inventory so we can read gear ranks and Forma polarity counts."
            actions={
              <button className="btn primary" onClick={onOpenSettings}>
                Open inventory settings
              </button>
            }
          />
        </Panel>
      ) : (
        <Panel
          title="Gear overview"
          subtitle={
            snap
              ? `MR ${snap.playerLevel ?? '—'} · ${snap.summary.warframes} frames · ${snap.summary.weapons} weapons · ${snap.summary.unranked} need rank · ${snap.summary.underForma} light Forma`
              : loading
                ? 'Loading…'
                : '—'
          }
          actions={
            <button className="btn ghost" onClick={() => void refresh()} disabled={loading}>
              Refresh
            </button>
          }
        >
          {error ? <p className="mod-empty">{error}</p> : null}
          <div className="foundry-sidebar__filters" style={{ marginBottom: 10 }}>
            <div className="vl-segment vl-segment--wrap" role="group" aria-label="Category">
              {CATS.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  className={`vl-segment__btn ${cat === c.id ? 'is-on' : ''}`}
                  onClick={() => setCat(c.id)}
                >
                  {c.label}
                </button>
              ))}
            </div>
            <div className="vl-segment" role="group" aria-label="Focus">
              <button
                type="button"
                className={`vl-segment__btn ${focus === 'coach' ? 'is-on' : ''}`}
                onClick={() => setFocus('coach')}
              >
                Needs attention
              </button>
              <button
                type="button"
                className={`vl-segment__btn ${focus === 'all' ? 'is-on' : ''}`}
                onClick={() => setFocus('all')}
              >
                All owned
              </button>
            </div>
          </div>

          {!rows.length ? (
            <EmptyState
              title={focus === 'coach' ? 'Nothing urgent' : 'No gear in this filter'}
              body={
                focus === 'coach'
                  ? 'No unranked or lightly-Forma’d items in this category.'
                  : 'Try another category or sync inventory again.'
              }
            />
          ) : (
            <ul className="loadout-list">
              {rows.map((item) => (
                <LoadoutRow key={item.uniqueName} item={item} />
              ))}
            </ul>
          )}
        </Panel>
      )}
    </>
  )
}

function LoadoutRow({ item }: { item: LoadoutItem }) {
  return (
    <li className="loadout-row">
      <div className="loadout-row__main">
        <div className="loadout-row__name">{item.name}</div>
        <div className="loadout-row__meta">
          {item.category} · rank {item.xpLevel ?? '—'}
          {item.formaCount != null ? ` · ${item.formaCount} Forma` : ''}
        </div>
        <div className="loadout-row__note">{item.note}</div>
      </div>
      <div className="loadout-row__tags">
        {item.tags.map((t) => (
          <span key={t} className={`vl-pill loadout-tag is-${t}`}>
            {tagLabel(t)}
          </span>
        ))}
      </div>
    </li>
  )
}
