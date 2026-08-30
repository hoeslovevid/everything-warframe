import { ArbitrationInfo } from '../../../shared/types'
import { Panel } from '../../components/Panel'
import { useNow } from '../../hooks/useNow'
import { formatCountdown } from '../../lib/time'
import '../cycles/module.css'

type Props = {
  arbitration: ArbitrationInfo | null
  opacity?: number
  onPostLfg?: (missionHint: string, title: string) => void
}

export function ArbitrationPanel({ arbitration, opacity, onPostLfg }: Props) {
  const now = useNow()
  const upcoming = arbitration?.upcoming?.slice(0, 6) || []

  return (
    <Panel title="Arbitration" subtitle="Current + upcoming rotation" opacity={opacity}>
      {!arbitration ? (
        <p className="mod-empty">
          No arbitration schedule loaded yet. Check your connection — the rotation table updates
          automatically.
        </p>
      ) : (
        <div className="mod-stack">
          <div className="mod-stat">
            <span className="mod-stat__label">Now</span>
            <span className="mod-stat__value">{arbitration.node}</span>
          </div>
          <div className="mod-stat">
            <span className="mod-stat__label">Mission</span>
            <span className="mod-stat__value">
              {arbitration.type} · {arbitration.enemy}
            </span>
          </div>
          <div className="mod-stat">
            <span className="mod-stat__label">Ends in</span>
            <span className="mod-stat__value">{formatCountdown(arbitration.expiry, now)}</span>
          </div>
          {onPostLfg ? (
            <button
              type="button"
              className="btn ghost"
              style={{ marginTop: 8 }}
              onClick={() =>
                onPostLfg(
                  `${arbitration.type} · ${arbitration.node}`,
                  'Arbitration',
                )
              }
            >
              Post LFG
            </button>
          ) : null}

          {upcoming.length ? (
            <>
              <div className="mod-stat" style={{ marginTop: 4 }}>
                <span className="mod-stat__label">Up next</span>
              </div>
              <ul className="mod-list" style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                {upcoming.map((slot) => (
                  <li
                    key={`${slot.activation}-${slot.nodeKey}`}
                    className="mod-stat"
                    style={{ alignItems: 'flex-start', gap: 8 }}
                  >
                    <span className="mod-stat__label" style={{ minWidth: 52 }}>
                      {formatCountdown(slot.activation, now)}
                    </span>
                    <span className="mod-stat__value" style={{ textAlign: 'left' }}>
                      {slot.node}
                      <span
                        className="muted"
                        style={{ display: 'block', fontSize: '0.75rem', fontWeight: 500 }}
                      >
                        {slot.type} · {slot.enemy}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
        </div>
      )}
    </Panel>
  )
}
