import { DeepArchimedeaInfo } from '../../../shared/types'
import { Panel } from '../../components/Panel'
import { useNow } from '../../hooks/useNow'
import { formatCountdown } from '../../lib/time'
import '../cycles/module.css'

type Props = {
  deepArchimedea: DeepArchimedeaInfo | null
  opacity?: number
  compact?: boolean
  onPostLfg?: (missionHint: string, title: string) => void
}

export function DeepArchimedeaPanel({ deepArchimedea, opacity, compact, onPostLfg }: Props) {
  const now = useNow()
  return (
    <Panel
      title="Deep Archimedea"
      subtitle={deepArchimedea ? 'This week' : 'Weekly lab'}
      opacity={opacity}
    >
      {!deepArchimedea ? (
        <p className="mod-empty">No Archimedea data</p>
      ) : (
        <div className="mod-stack">
          <div className="mod-stat">
            <span className="mod-stat__label">Resets</span>
            <span className="mod-stat__value">{formatCountdown(deepArchimedea.expiry, now)}</span>
          </div>
          {onPostLfg && !compact ? (
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 8 }}
              onClick={() =>
                onPostLfg(
                  deepArchimedea.missions[0]
                    ? `${deepArchimedea.missions[0].type} · ${deepArchimedea.missions[0].node}`
                    : 'Deep Archimedea',
                  'Deep Archimedea',
                )
              }
            >
              Post LFG
            </button>
          ) : null}
          <ul className="mod-list">
            {deepArchimedea.missions.slice(0, compact ? 3 : 5).map((m) => (
              <li key={`${m.node}-${m.type}`} className="mod-row">
                <div>
                  <div className="mod-row__title">{m.type}</div>
                  <div className="mod-row__meta">{m.node}</div>
                </div>
              </li>
            ))}
          </ul>
          {!compact && deepArchimedea.riskVariables.length ? (
            <p className="mod-empty" style={{ marginTop: 8 }}>
              {deepArchimedea.riskVariables.join(' · ')}
            </p>
          ) : null}
        </div>
      )}
    </Panel>
  )
}