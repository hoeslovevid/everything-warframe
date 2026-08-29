import { useCallback, useEffect, useMemo, useState } from 'react'
import type {
  InventoryBrowseItem,
  InventoryBrowseKind,
  InventoryBrowseSort,
  InventoryDiff,
} from '../../../shared/types'
import { EmptyState } from '../../components/EmptyState'
import { InventoryDiffHistoryPanel } from '../../components/InventoryDiffHistoryPanel'
import { Panel } from '../../components/Panel'
import { useInventory } from '../../hooks/useInventory'
import { copyText, formatSellablesDump } from '../../lib/tradeClipboard'
import './inventory.css'

type Props = {
  onOpenSettings: () => void
  initialKind?: string
  initialSearch?: string
  onFiltersChange?: (kind: string, search: string) => void
}

type KindFilter = InventoryBrowseKind | 'all' | 'sellable' | 'ducats'

const KIND_FILTERS: Array<{ id: KindFilter; label: string }> = [
  { id: 'all', label: 'All' },
  { id: 'sellable', label: 'Sellables' },
  { id: 'ducats', label: 'Ducat dump' },
  { id: 'part', label: 'Parts / BPs' },
  { id: 'gear', label: 'Gear' },
  { id: 'relic', label: 'Relics' },
  { id: 'resource', label: 'Resources' },
  { id: 'currency', label: 'Currency' },
  { id: 'other', label: 'Other' },
]

const SEARCH_DEBOUNCE_MS = 220

function formatAge(ms: number | null): string {
  if (ms == null) return 'never'
  const m = Math.floor(ms / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

function kindLabel(kind: InventoryBrowseKind): string {
  switch (kind) {
    case 'part':
      return 'Part'
    case 'gear':
      return 'Gear'
    case 'relic':
      return 'Relic'
    case 'resource':
      return 'Resource'
    case 'currency':
      return 'Currency'
    default:
      return 'Other'
  }
}

export function InventoryPage({
  onOpenSettings,
  initialKind,
  initialSearch,
  onFiltersChange,
}: Props) {
  const { status, busy, message, syncFromGame, refresh } = useInventory()
  const [search, setSearch] = useState(initialSearch || '')
  const [debouncedSearch, setDebouncedSearch] = useState(initialSearch || '')
  const [kind, setKind] = useState<KindFilter>((initialKind as KindFilter) || 'all')
  const [rows, setRows] = useState<InventoryBrowseItem[]>([])
  const [loading, setLoading] = useState(false)
  const [listBusy, setListBusy] = useState<string | null>(null)
  const [listMsg, setListMsg] = useState<string | null>(null)
  const [diff, setDiff] = useState<InventoryDiff | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [search])

  useEffect(() => {
    onFiltersChange?.(kind, search)
  }, [kind, search, onFiltersChange])

  const load = useCallback(async () => {
    if (!window.voidlens?.browseInventory) return
    setLoading(true)
    try {
      const sellableOnly = kind === 'sellable' || kind === 'ducats'
      const sort: InventoryBrowseSort =
        kind === 'ducats' ? 'ducats' : kind === 'sellable' ? 'platinum' : 'count'
      const next = await window.voidlens.browseInventory({
        search: debouncedSearch,
        kind: sellableOnly ? 'all' : kind,
        sellableOnly,
        enrichPrices: sellableOnly,
        sort,
        limit: sellableOnly ? 200 : 400,
      })
      setRows(next)
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, kind])

  useEffect(() => {
    if (!status.loaded) {
      setRows([])
      setDiff(null)
      return
    }
    void load()
    void window.voidlens?.getInventoryDiff?.().then((d) => setDiff(d || null))
  }, [status.loaded, status.revision, load])

  const totals = useMemo(() => {
    let stacks = 0
    let units = 0
    let excess = 0
    let ducats = 0
    let plat = 0
    for (const r of rows) {
      stacks += 1
      units += r.count
      excess += r.excess || 0
      if (r.ducats != null) ducats += r.ducats * (r.excess || 0)
      if (r.platinum != null) plat += r.platinum * (r.excess || 0)
    }
    return { stacks, units, excess, ducats, plat }
  }, [rows])

  const listOnWfm = async (row: InventoryBrowseItem) => {
    if (!window.voidlens?.createWfmOrder) return
    let plat = row.platinum
    if (plat == null || plat < 1) {
      setListMsg('No platinum price for this item')
      return
    }
    if (window.voidlens.suggestMarketUndercut) {
      const tip = await window.voidlens.suggestMarketUndercut(row.displayName)
      if (tip?.suggest) plat = tip.suggest
    }
    const qty = Math.max(1, row.excess || 1)
    setListBusy(row.uniqueName)
    setListMsg(null)
    try {
      const res = await window.voidlens.createWfmOrder({
        itemSlugOrName: row.displayName,
        orderType: 'sell',
        platinum: Math.round(plat),
        quantity: qty,
        visible: true,
      })
      if (!res.ok) {
        setListMsg(res.error || 'List failed — sign in under Market')
        return
      }
      setListMsg(`Listed ${qty}× ${row.displayName} @ ${Math.round(plat)}p (undercut)`)
    } finally {
      setListBusy(null)
    }
  }

  const copyDump = async () => {
    const text = formatSellablesDump(rows)
    if (!(await copyText(text))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  if (!status.loaded) {
    return (
      <>
        <header className="page-header">
          <h2 className="page-title">Inventory</h2>
          <div className="page-title-rule" />
          <p className="page-desc">Browse synced item counts from Warframe.</p>
        </header>
        <Panel title="Inventory required">
          <EmptyState
            title="No inventory loaded"
            body="Sync from the running game (Settings → Inventory) to browse parts, gear, and relics with exact stack counts."
          />
          <div className="toolbar" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={onOpenSettings}>
              Open inventory settings
            </button>
          </div>
        </Panel>
      </>
    )
  }

  return (
    <div className="inventory-page">
      <header className="page-header">
        <h2 className="page-title">Inventory</h2>
        <div className="page-title-rule" />
        <p className="page-desc">
          {status.uniqueCount} unique · {status.itemCount} total · synced {formatAge(status.staleAgeMs)}
          {status.stale ? ' · stale' : ''}
        </p>
      </header>

      {status.stale ? (
        <p className="inventory-stale">
          Inventory looks stale ({formatAge(status.staleAgeMs)}). Sync again while Warframe is running
          for accurate Foundry / relic counts.
        </p>
      ) : null}

      {diff ? (
        <Panel
          title="Since last sync"
          subtitle={`${diff.summary.addedStacks} added · ${diff.summary.removedStacks} removed · ${diff.summary.changedStacks} changed · net ${diff.summary.netUnits >= 0 ? '+' : ''}${diff.summary.netUnits}`}
        >
          <ul className="inventory-list">
            {[...diff.added, ...diff.changed, ...diff.removed].slice(0, 12).map((e) => (
              <li key={`${e.uniqueName}-${e.delta}`}>
                <div>
                  <strong>{e.displayName}</strong>
                  <div className="muted inventory-tags">
                    <span className="inventory-tag">
                      {e.before} → {e.after}
                    </span>
                  </div>
                </div>
                <span className="inventory-count" style={{ color: e.delta >= 0 ? 'var(--vl-teal)' : 'var(--vl-warn)' }}>
                  {e.delta >= 0 ? '+' : ''}
                  {e.delta}
                </span>
              </li>
            ))}
          </ul>
        </Panel>
      ) : null}

      <Panel
        title="Browser"
        subtitle={
          kind === 'ducats'
            ? 'Extras ranked by ducat value — keep 1 of each, dump the rest at Baro'
            : kind === 'sellable'
              ? 'Duplicate parts with prices — one-click warframe.market sell'
              : 'Names from WFCD / recipe catalogs when available'
        }
        actions={
          <div className="market-actions">
            {kind === 'ducats' || kind === 'sellable' ? (
              <button className="btn ghost" type="button" onClick={() => void copyDump()}>
                {copied ? 'Copied!' : 'Copy WTS dump'}
              </button>
            ) : null}
            <button
              className="btn ghost"
              disabled={busy || !status.consent}
              onClick={() => void syncFromGame()}
            >
              {busy ? 'Syncing…' : 'Sync now'}
            </button>
            <button className="btn ghost" onClick={() => void refresh()}>
              Refresh
            </button>
          </div>
        }
      >
        <div className="inventory-toolbar">
          <input
            value={search}
            placeholder="Search (e.g. Ember Chassis, Forma…)"
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="inventory-kinds">
            {KIND_FILTERS.map((f) => (
              <button
                key={f.id}
                type="button"
                className={`btn ghost${kind === f.id ? ' is-active' : ''}`}
                onClick={() => setKind(f.id)}
              >
                {f.label}
              </button>
            ))}
          </div>
        </div>
        {message ? <p className="muted">{message}</p> : null}
        {listMsg ? <p className="muted">{listMsg}</p> : null}
        <p className="muted inventory-meta">
          Showing {totals.stacks} stacks ({totals.units} units)
          {kind === 'sellable' || kind === 'ducats' ? ` · ${totals.excess} excess` : ''}
          {kind === 'ducats' && totals.ducats > 0 ? ` · ~${totals.ducats.toLocaleString()}d dump` : ''}
          {kind === 'sellable' && totals.plat > 0 ? ` · ~${Math.round(totals.plat)}p excess` : ''}
          {loading || search.trim() !== debouncedSearch ? ' · loading…' : ''}
        </p>
        <ul className="inventory-list">
          {rows.length === 0 ? (
            <li className="muted">
              {kind === 'sellable' || kind === 'ducats'
                ? 'No duplicate parts with prices. Sync inventory and ensure catalogs loaded.'
                : 'No matching items.'}
            </li>
          ) : (
            rows.map((r) => (
              <li key={r.uniqueName}>
                <div>
                  <strong>{r.displayName}</strong>
                  <div className="muted inventory-tags">
                    <span className={`inventory-kind kind-${r.kind}`}>{kindLabel(r.kind)}</span>
                    {r.isBlueprint ? <span className="inventory-tag">Blueprint</span> : null}
                    {r.isComponent ? <span className="inventory-tag">Component</span> : null}
                    {r.platinum != null ? (
                      <span className="inventory-tag">~{Math.round(r.platinum)}p</span>
                    ) : null}
                    {r.ducats != null ? (
                      <span className="inventory-tag">
                        {r.ducats}d
                        {r.excess > 0 ? ` · ${r.ducats * r.excess}d dump` : ''}
                      </span>
                    ) : null}
                    {r.excess > 0 ? (
                      <span className="inventory-tag">+{r.excess} excess</span>
                    ) : null}
                  </div>
                </div>
                <div className="inventory-row-actions">
                  {(kind === 'sellable' || kind === 'ducats') && r.platinum != null ? (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={listBusy === r.uniqueName}
                      onClick={() => void listOnWfm(r)}
                      title="Create warframe.market sell order at undercut (floor − 1)"
                    >
                      {listBusy === r.uniqueName ? 'Listing…' : 'List WFM'}
                    </button>
                  ) : null}
                  <span className="inventory-count">×{r.count}</span>
                </div>
              </li>
            ))
          )}
        </ul>
      </Panel>

      <div style={{ marginTop: 16 }}>
        <InventoryDiffHistoryPanel />
      </div>
    </div>
  )
}
