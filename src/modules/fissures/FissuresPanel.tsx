import { FissureInfo, FissurePathMode, FissureSort } from '../../../shared/types'
import { Copyable } from '../../components/Copyable'
import { Panel } from '../../components/Panel'
import { useNow } from '../../hooks/useNow'
import { formatCountdown, isExpired } from '../../lib/time'
import '../cycles/module.css'

const TIER_ORDER = ['Lith', 'Meso', 'Neo', 'Axi', 'Requiem']

type Props = {
  fissures: FissureInfo[]
  tiers: string[]
  pathMode?: FissurePathMode
  showStorms?: boolean
  sort?: FissureSort
  opacity?: number
  compact?: boolean
  onPostLfg?: (missionHint: string, title: string) => void
}

function matchesPathMode(f: FissureInfo, pathMode: FissurePathMode): boolean {
  if (pathMode === 'both') return true
  if (pathMode === 'steel') return f.isHard
  return !f.isHard
}

export function FissuresPanel({
  fissures,
  tiers,
  pathMode = 'both',
  showStorms = true,
  sort = 'eta',
  opacity,
  compact,
  onPostLfg,
}: Props) {
  const now = useNow()
  const filtered = fissures
    .filter((f) => tiers.includes(f.tier))
    .filter((f) => matchesPathMode(f, pathMode))
    .filter((f) => showStorms || !f.isStorm)
    .filter((f) => !isExpired(f.expiry, now))
    .slice()
    .sort((a, b) => {
      if (sort === 'tier') {
        const ta = TIER_ORDER.indexOf(a.tier)
        const tb = TIER_ORDER.indexOf(b.tier)
        if (ta !== tb) return ta - tb
      }
      return new Date(a.expiry).getTime() - new Date(b.expiry).getTime()
    })

  return (
    <Panel
      title="Fissures"
      subtitle={compact ? undefined : `${filtered.length} active`}
      opacity={opacity}
    >
      <ul className="mod-list">
        {filtered.slice(0, compact ? 8 : 20).map((f) => (
          <li key={f.id} className="mod-row">
            <div>
              <div className="mod-row__title">
                {f.tier}
                {f.isHard ? ' Steel Path' : ''}
                {f.isStorm ? ' Storm' : ''} · {f.missionType}
              </div>
              <div className="mod-row__meta">
                <Copyable
                  text={f.node}
                  className="copyable--inline"
                  toastOk={`Copied ${f.node}`}
                  title={`Copy node: ${f.node}`}
                >
                  {f.node}
                </Copyable>
                {' · '}
                {f.enemy}
              </div>
            </div>
            <div className="mod-row__value">
              {formatCountdown(f.expiry, now)}
              {onPostLfg && !compact ? (
                <button
                  type="button"
                  className="btn ghost"
                  style={{ marginLeft: 8 }}
                  onClick={() =>
                    onPostLfg(
                      `${f.missionType} · ${f.node}`,
                      `${f.tier}${f.isHard ? ' SP' : ''} Fissure`,
                    )
                  }
                >
                  Post LFG
                </button>
              ) : null}
            </div>
          </li>
        ))}
        {filtered.length === 0 ? (
          <li className="mod-empty">
            {tiers.length === 0
              ? 'No tiers selected. Enable Lith / Meso / Neo / Axi under Modules → Fissure filters.'
              : 'No fissures for your filters. Adjust tiers / path / storms under Modules, then refresh.'}
          </li>
        ) : null}
      </ul>
    </Panel>
  )
}
