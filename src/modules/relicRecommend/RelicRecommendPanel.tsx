import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FissureInfo, RelicPlannerQuery, RelicPlannerRow } from '../../../shared/types'
import { InventoryStaleBanner } from '../../components/InventoryStaleBanner'
import { Panel } from '../../components/Panel'
import { useInventory } from '../../hooks/useInventory'
import { useSettings, useWorldstate } from '../../hooks/useVoidLens'
import { useNow } from '../../hooks/useNow'
import { formatCountdown, isExpired } from '../../lib/time'
import { copyText, formatRelicRecommendLine } from '../../lib/tradeClipboard'
import '../cycles/module.css'

type Props = {
  opacity?: number
  compact?: boolean
  onPostLfg?: (relicLabel: string, tier: string) => void
  onSyncInventory?: () => void
  onOpenSettings?: () => void
}

function openFissuresForTier(
  fissures: FissureInfo[],
  tier: string,
  now: number,
  pathMode: string,
  showStorms: boolean,
): FissureInfo[] {
  return fissures
    .filter((f) => f.tier.toLowerCase() === tier.toLowerCase())
    .filter((f) => !isExpired(f.expiry, now))
    .filter((f) => {
      if (pathMode === 'steel') return f.isHard
      if (pathMode === 'normal') return !f.isHard
      return true
    })
    .filter((f) => showStorms || !f.isStorm)
    .slice()
    .sort((a, b) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime())
    .slice(0, 2)
}

export function RelicRecommendPanel({
  opacity,
  compact,
  onPostLfg,
  onSyncInventory,
  onOpenSettings,
}: Props) {
  const rootRef = useRef<HTMLDivElement>(null)
  const { settings } = useSettings()
  const { data } = useWorldstate()
  const { status: inventory } = useInventory()
  const now = useNow()
  const [visible, setVisible] = useState(false)
  const [rows, setRows] = useState<RelicPlannerRow[]>([])
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)

  const q = settings.relicRecommend
  const favoritesKey = (settings.farmFavorites || []).join('\0')

  useEffect(() => {
    const el = rootRef.current
    if (!el) return
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) setVisible(true)
      },
      { root: null, threshold: 0.05, rootMargin: '40px' },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [])

  const refresh = useCallback(async () => {
    if (!window.voidlens?.getRelicPlanner) return
    setLoading(true)
    try {
      const query: RelicPlannerQuery = {
        ownedOnly: q?.ownedOnly !== false,
        sort: q?.sort || 'missing',
        tier: q?.tier || 'all',
        prime: q?.prime || 'any',
        favoritesFirst: q?.favoritesFirst !== false,
        limit: q?.limit || 8,
      }
      const next = await window.voidlens.getRelicPlanner(query)
      setRows(next.rows)
      setError(next.error)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load')
      setRows([])
    } finally {
      setLoading(false)
    }
  }, [q?.ownedOnly, q?.sort, q?.tier, q?.prime, q?.favoritesFirst, q?.limit, favoritesKey])

  useEffect(() => {
    if (!visible) return
    const t = window.setTimeout(() => void refresh(), 80)
    return () => window.clearTimeout(t)
  }, [visible, refresh, inventory.revision, inventory.loaded])

  const sortLabel =
    q?.sort === 'platinum'
      ? 'plat'
      : q?.sort === 'ducats'
        ? 'ducats'
        : q?.sort === 'upgradePlat'
          ? '↑plat'
          : q?.sort === 'upgradeDucats'
            ? '↑ducats'
            : q?.sort === 'owned'
              ? 'owned'
              : q?.sort === 'name'
                ? 'name'
                : 'missing'

  const fissureByTier = useMemo(() => {
    const map = new Map<string, FissureInfo[]>()
    for (const row of rows) {
      if (map.has(row.tier)) continue
      map.set(
        row.tier,
        openFissuresForTier(
          data.fissures || [],
          row.tier,
          now,
          settings.fissurePathMode || 'both',
          settings.fissureShowStorms !== false,
        ),
      )
    }
    return map
  }, [rows, data.fissures, now, settings.fissurePathMode, settings.fissureShowStorms])

  const copyLines = async () => {
    const text = formatRelicRecommendLine(rows)
    if (!(await copyText(text))) return
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1600)
  }

  return (
    <div ref={rootRef}>
      <Panel
        title="Relic Recommend"
        subtitle={
          compact
            ? `Top owned · ${sortLabel}`
            : `Best owned relics to run · sorted by ${sortLabel}`
        }
        opacity={opacity}
        actions={
          rows.length ? (
            <button type="button" className="btn ghost" onClick={() => void copyLines()}>
              {copied ? 'Copied' : 'Copy list'}
            </button>
          ) : undefined
        }
      >
        {visible && inventory.loaded ? (
          <InventoryStaleBanner
            inventory={inventory}
            fissureMode
            onSyncInventory={onSyncInventory}
            onOpenInventory={onOpenSettings}
          />
        ) : null}
        {!visible ? (
          <p className="mod-empty muted" style={{ opacity: 0.6 }}>
            —
          </p>
        ) : !inventory.loaded ? (
          <p className="mod-empty">Sync inventory to rank owned relics.</p>
        ) : loading && rows.length === 0 ? (
          <p className="mod-empty">Loading…</p>
        ) : rows.length === 0 ? (
          <p className="mod-empty">{error || 'No owned relics match these filters.'}</p>
        ) : (
          <ul className="mod-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
            {rows.map((row, i) => {
              const opens = fissureByTier.get(row.tier) || []
              return (
                <li
                  key={row.key}
                  className="mod-stat"
                  style={{ alignItems: 'flex-start', gap: 8, marginBottom: 4 }}
                >
                  <span className="mod-stat__label" style={{ minWidth: 18 }}>
                    {i + 1}
                  </span>
                  <span className="mod-stat__value" style={{ textAlign: 'left', flex: 1 }}>
                    {row.name}
                    {row.hasFavorite ? ' ★' : ''}
                    <span
                      className="muted"
                      style={{ display: 'block', fontSize: '0.72rem', fontWeight: 500 }}
                    >
                      ×{row.owned}
                      {row.missingCount > 0 ? ` · ${row.missingCount} needed` : ' · complete'}
                      {row.bestPlatinum != null ? ` · ~${Math.round(row.bestPlatinum)}p` : ''}
                      {row.bestDucats != null ? ` · ${row.bestDucats}d` : ''}
                    </span>
                    {opens.length ? (
                      <span
                        className="muted"
                        style={{ display: 'block', fontSize: '0.7rem', fontWeight: 500 }}
                      >
                        Open:{' '}
                        {opens
                          .map(
                            (f) =>
                              `${f.missionType}${f.isHard ? ' SP' : ''} · ${formatCountdown(f.expiry, now)}`,
                          )
                          .join(' · ')}
                      </span>
                    ) : (
                      <span
                        className="muted"
                        style={{ display: 'block', fontSize: '0.7rem', fontWeight: 500 }}
                      >
                        No open {row.tier} fissure
                      </span>
                    )}
                    {onPostLfg && !compact ? (
                      <button
                        type="button"
                        className="btn ghost"
                        style={{ marginTop: 4, fontSize: '0.7rem', padding: '2px 8px' }}
                        onClick={() => onPostLfg(row.name, row.tier)}
                      >
                        Post LFG
                      </button>
                    ) : null}
                  </span>
                </li>
              )
            })}
          </ul>
        )}
      </Panel>
    </div>
  )
}
