import type { AppSettings, WorldstateSnapshot } from '../../shared/types'
import { useNow } from '../hooks/useNow'
import { formatCountdown, isExpired } from '../lib/time'
import { Panel } from './Panel'
import './weekly-reset.css'

type Props = {
  data: WorldstateSnapshot
  settings: AppSettings
  onNavigate?: (tab: string) => void
  onToggleNightwaveDone?: (id: string) => void
}

/** Companion Dashboard: weekly / bi-weekly planning card. */
export function WeeklyResetCard({ data, settings, onNavigate, onToggleNightwaveDone }: Props) {
  const now = useNow()
  const done = new Set(settings.nightwaveDoneIds || [])
  const weeklies = (data.nightwave?.challenges || []).filter(
    (c) => !c.isDaily && (!c.expiry || !isExpired(c.expiry, now)),
  )
  const openWeeklies = weeklies.filter((c) => !done.has(c.id))

  return (
    <Panel title="Weekly reset" subtitle="Sortie · Archon · Nightwave · Circuit · Baro" className="weekly-reset">
      <div className="weekly-reset__grid">
        <div className="weekly-reset__cell">
          <div className="weekly-reset__label">Sortie</div>
          {data.sortie ? (
            <>
              <div className="weekly-reset__value">{data.sortie.boss}</div>
              <div className="weekly-reset__meta">
                {data.sortie.faction}
                {data.sortie.expiry ? ` · ${formatCountdown(data.sortie.expiry, now)}` : ''}
              </div>
              <ul className="weekly-reset__missions">
                {data.sortie.missions.slice(0, 3).map((m, i) => (
                  <li key={`${m.node}-${i}`}>
                    {m.missionType}
                    {m.modifier ? ` · ${m.modifier}` : ''}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="weekly-reset__value muted">Unavailable</div>
          )}
        </div>

        <div className="weekly-reset__cell">
          <div className="weekly-reset__label">Archon Hunt</div>
          {data.archonHunt ? (
            <>
              <div className="weekly-reset__value">{data.archonHunt.boss || 'Active'}</div>
              <div className="weekly-reset__meta">
                {data.archonHunt.faction}
                {data.archonHunt.expiry ? ` · ${formatCountdown(data.archonHunt.expiry, now)}` : ''}
              </div>
              <ul className="weekly-reset__missions">
                {(data.archonHunt.missions || []).slice(0, 3).map((m, i) => (
                  <li key={`${m.node}-${i}`}>
                    {m.type || m.node}
                  </li>
                ))}
              </ul>
            </>
          ) : (
            <div className="weekly-reset__value muted">Unavailable</div>
          )}
        </div>

        <div className="weekly-reset__cell">
          <div className="weekly-reset__label">Nightwave weeklies</div>
          <div className="weekly-reset__value">
            {openWeeklies.length}/{weeklies.length || '—'} open
          </div>
          <ul className="weekly-reset__missions">
            {openWeeklies.slice(0, 4).map((c) => (
              <li key={c.id}>
                <button
                  type="button"
                  className="weekly-reset__nw"
                  onClick={() => onToggleNightwaveDone?.(c.id)}
                  title="Mark done"
                >
                  {c.title}
                  {c.isElite ? ' · Elite' : ''}
                </button>
              </li>
            ))}
            {!weeklies.length ? <li className="muted">No weeklies listed</li> : null}
          </ul>
        </div>

        <div className="weekly-reset__cell">
          <div className="weekly-reset__label">Circuit / Steel Path</div>
          {data.circuit?.currentReward || data.circuit?.rotation?.length ? (
            <>
              <div className="weekly-reset__value">
                {data.circuit.currentReward || data.circuit.rotation[0]}
              </div>
              <div className="weekly-reset__meta">
                {data.circuit.expiry
                  ? formatCountdown(data.circuit.expiry, now)
                  : data.circuit.eta || 'This week'}
              </div>
              {data.circuit.rotation.length > 1 ? (
                <div className="weekly-reset__meta">
                  Rotation: {data.circuit.rotation.slice(0, 4).join(' · ')}
                </div>
              ) : null}
            </>
          ) : (
            <div className="weekly-reset__value muted">No Circuit data</div>
          )}
          <div className="weekly-reset__label" style={{ marginTop: 10 }}>
            Baro
          </div>
          {data.baro ? (
            <div className="weekly-reset__meta">
              {data.baro.active
                ? `${data.baro.location || 'In relay'} · leaves ${formatCountdown(data.baro.departure, now)}`
                : `Arrives ${formatCountdown(data.baro.arrival || data.baro.eta, now)}`}
            </div>
          ) : (
            <div className="weekly-reset__meta muted">No schedule</div>
          )}
          {onNavigate ? (
            <div className="weekly-reset__actions">
              <button type="button" className="btn ghost" onClick={() => onNavigate('loadout')}>
                Loadout
              </button>
              <button type="button" className="btn ghost" onClick={() => onNavigate('arbitrationLog')}>
                Arb haul
              </button>
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  )
}
