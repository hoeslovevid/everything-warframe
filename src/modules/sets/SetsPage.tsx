import { useCallback, useEffect, useMemo, useState } from 'react'
import type { SetFissureMatch, SetProgressRow } from '../../../shared/types'
import { EmptyState } from '../../components/EmptyState'
import { InventoryStaleBanner } from '../../components/InventoryStaleBanner'
import { Panel } from '../../components/Panel'
import { useInventory } from '../../hooks/useInventory'
import { useSettings } from '../../hooks/useVoidLens'
import '../foundry/foundry.css'

type Props = {
  enabled: boolean
  onOpenSettings: () => void
  onOpenFoundry?: (uniqueName: string) => void
  searchPrefill?: string | null
  onSearchPrefillConsumed?: () => void
}

type CompletionFilter = 'incomplete' | 'complete' | 'all'

const SEARCH_DEBOUNCE_MS = 220

function normalizeFavorite(s: string): string {
  return s
    .toUpperCase()
    .replace(/['’]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

export function SetsPage({
  enabled,
  onOpenSettings,
  onOpenFoundry,
  searchPrefill,
  onSearchPrefillConsumed,
}: Props) {
  const { status: inventory } = useInventory()
  const { settings, updateSettings } = useSettings()
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')

  useEffect(() => {
    if (!searchPrefill?.trim()) return
    setSearch(searchPrefill.trim())
    onSearchPrefillConsumed?.()
  }, [searchPrefill, onSearchPrefillConsumed])
  const [completion, setCompletion] = useState<CompletionFilter>('incomplete')
  const [rows, setRows] = useState<SetProgressRow[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [fissureMatches, setFissureMatches] = useState<SetFissureMatch[]>([])
  const [fissureLoading, setFissureLoading] = useState(false)

  const favorites = settings.farmFavorites || []
  const favoriteNorms = useMemo(
    () => new Set(favorites.map(normalizeFavorite).filter(Boolean)),
    [favorites],
  )

  useEffect(() => {
    const t = window.setTimeout(() => setDebouncedSearch(search.trim()), SEARCH_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [search])

  const refresh = useCallback(async () => {
    if (!window.voidlens?.getSetProgress) return
    setLoading(true)
    setError(null)
    try {
      const next = await window.voidlens.getSetProgress({
        search: debouncedSearch,
        completion,
        limit: 250,
      })
      setRows(next.rows)
      if (next.error) setError(next.error)
      setSelected((prev) => {
        if (prev && next.rows.some((r) => r.uniqueName === prev)) return prev
        return next.rows[0]?.uniqueName || null
      })
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load sets')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [debouncedSearch, completion])

  useEffect(() => {
    if (!enabled) return
    const t = window.setTimeout(() => void refresh(), 100)
    return () => window.clearTimeout(t)
  }, [enabled, refresh, inventory.revision, inventory.loaded])

  useEffect(() => {
    if (!selected || !window.voidlens?.getSetFissurePath) {
      setFissureMatches([])
      return
    }
    let cancelled = false
    setFissureLoading(true)
    void window.voidlens.getSetFissurePath(selected).then((res) => {
      if (cancelled) return
      setFissureMatches(res.matches || [])
      setFissureLoading(false)
    })
    return () => {
      cancelled = true
    }
  }, [selected, inventory.revision])

  const detail = rows.find((r) => r.uniqueName === selected) || null
  const completeCount = useMemo(() => rows.filter((r) => r.complete).length, [rows])

  const toggleFavorite = (name: string) => {
    const n = normalizeFavorite(name)
    const existing = favorites.find((f) => normalizeFavorite(f) === n)
    const next = existing ? favorites.filter((f) => f !== existing) : [...favorites, name]
    void updateSettings({ farmFavorites: next })
  }

  if (!inventory.loaded) {
    return (
      <>
        <header className="page-header">
          <h2 className="page-title">Sets</h2>
          <div className="page-title-rule" />
          <p className="page-desc">Prime set completion across your inventory.</p>
        </header>
        <Panel title="Inventory required">
          <EmptyState
            title="No inventory loaded"
            body="Sync inventory to see every Prime set percent complete and missing parts."
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

  const emptyBody =
    completion === 'incomplete'
      ? 'All tracked Prime sets look complete — try Complete or All.'
      : completion === 'complete'
        ? 'No complete Prime sets yet — keep farming, or switch to Incomplete.'
        : 'No Prime sets matched your search.'

  return (
    <>
      <header className="page-header">
        <h2 className="page-title">Sets</h2>
        <div className="page-title-rule" />
        <p className="page-desc">
          {loading ? 'Updating…' : `${rows.length} sets`}
          {completion === 'all' ? ` · ${completeCount} complete` : ''}
          {completion === 'complete' ? ' · completed' : ''}
          {error ? ` · ${error}` : ''}
        </p>
      </header>

      <InventoryStaleBanner
        inventory={inventory}
        fissureMode
        onOpenInventory={onOpenSettings}
      />

      <div className="foundry-layout">
        <aside className="foundry-sidebar">
          <div className="foundry-sidebar__filters">
            <input
              className="foundry-search"
              placeholder="Search Prime set…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
            <div className="vl-segment vl-segment--wrap" role="group" aria-label="Completion">
              {(
                [
                  ['incomplete', 'Incomplete'],
                  ['complete', 'Complete'],
                  ['all', 'All'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`vl-segment__btn ${completion === id ? 'is-on' : ''}`}
                  onClick={() => setCompletion(id)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <ul className="foundry-list vl-stagger">
            {rows.map((row) => (
              <li key={row.uniqueName}>
                <button
                  type="button"
                  className={selected === row.uniqueName ? 'is-selected' : ''}
                  onClick={() => setSelected(row.uniqueName)}
                >
                  <span className="foundry-list__name">{row.name}</span>
                  <span className="foundry-list__meta">
                    <span className={`vl-pill ${row.complete ? 'is-ok' : 'is-warn'}`}>
                      {row.ownedParts}/{row.totalParts}
                    </span>
                    <span className="vl-pill">{row.percent}%</span>
                    {row.complete ? <span className="vl-pill is-ok">Done</span> : null}
                    {row.vaulted ? <span className="vl-pill is-warn">Vaulted</span> : null}
                  </span>
                </button>
              </li>
            ))}
            {!loading && rows.length === 0 ? (
              <li style={{ padding: '8px 12px' }}>
                <EmptyState title="No sets" body={emptyBody} />
              </li>
            ) : null}
          </ul>
        </aside>

        <section className="foundry-detail">
          {!detail ? (
            <EmptyState title="Pick a set" body="Select a Prime set to see missing parts." />
          ) : (
            <div key={detail.uniqueName} className="vl-expand-in">
              <h3>{detail.name}</h3>
              <div className="foundry-list__meta" style={{ marginBottom: 8 }}>
                <span className="vl-pill">{detail.category}</span>
                <span className={`vl-pill ${detail.complete ? 'is-ok' : 'is-warn'}`}>
                  {detail.percent}% · {detail.ownedParts}/{detail.totalParts}
                </span>
                {detail.complete ? <span className="vl-pill is-ok">Complete</span> : null}
                {detail.vaulted ? <span className="vl-pill is-warn">Vaulted</span> : null}
              </div>
              <div className="foundry-section-title">Parts</div>
              <ul className="foundry-tree">
                {detail.parts.map((p) => {
                  const fav = favoriteNorms.has(normalizeFavorite(p.name))
                  return (
                    <li key={p.uniqueName}>
                      <div style={{ flex: 1 }}>
                        <span>
                          {p.name}
                          {fav ? ' ★' : ''}
                        </span>
                      </div>
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ padding: '4px 8px', fontSize: '0.75rem' }}
                        title={fav ? 'Remove farm favorite' : 'Star as farm favorite'}
                        onClick={() => toggleFavorite(p.name)}
                      >
                        {fav ? '★' : '☆'}
                      </button>
                      <span className={p.needed ? 'is-missing' : 'is-ok'}>
                        {p.needed ? 'Missing' : `Owned ×${p.owned}`}
                      </span>
                    </li>
                  )
                })}
              </ul>
              {onOpenFoundry ? (
                <div className="toolbar" style={{ marginTop: 12 }}>
                  <button className="btn ghost" onClick={() => onOpenFoundry(detail.uniqueName)}>
                    Open in Foundry
                  </button>
                </div>
              ) : null}
              {!detail.complete ? (
                <>
                  <div className="foundry-section-title" style={{ marginTop: 16 }}>
                    Live fissures for missing parts
                  </div>
                  {fissureLoading ? (
                    <p className="muted">Matching open fissures…</p>
                  ) : fissureMatches.length === 0 ? (
                    <p className="muted">No open fissures match drop tiers for missing parts.</p>
                  ) : (
                    <ul className="foundry-tree">
                      {fissureMatches.map((m) => (
                        <li key={m.fissureId}>
                          <div style={{ flex: 1 }}>
                            <strong>
                              {m.tier} · {m.node}
                            </strong>
                            <div className="muted" style={{ fontSize: '0.78rem' }}>
                              {m.missionType}
                              {m.isHard ? ' · Steel Path' : ''}
                              {m.isStorm ? ' · Storm' : ''} · {m.eta}
                            </div>
                            <div className="muted" style={{ fontSize: '0.75rem' }}>
                              Helps: {m.missingParts.slice(0, 3).join(', ')}
                              {m.missingParts.length > 3 ? '…' : ''}
                            </div>
                          </div>
                          <span className="vl-pill">{m.relicKeys[0] || m.tier}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              ) : null}
            </div>
          )}
        </section>
      </div>
    </>
  )
}
