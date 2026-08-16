import { useCallback, useEffect, useMemo, useState } from 'react'
import type { AppSettings, SessionGoal, SessionGoalKind, SessionHaulSnapshot } from '../../shared/types'
import { Panel } from './Panel'
import './session-goals.css'

type Props = {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
  onClearHaul?: () => void
}

function kindLabel(kind: SessionGoalKind) {
  if (kind === 'relic_scans') return 'Relic scans'
  if (kind === 'needed_parts') return 'Needed parts (OCR)'
  if (kind === 'plat_seen') return 'Plat seen (OCR)'
  return 'Inventory gain'
}

function progressFor(goal: SessionGoal, haul: SessionHaulSnapshot | null): number {
  if (!haul) return 0
  if (goal.kind === 'relic_scans') return haul.relicScans
  if (goal.kind === 'needed_parts') return haul.neededParts
  if (goal.kind === 'plat_seen') return Math.floor(haul.platEstimate || 0)
  const needle = (goal.matchName || '').trim().toLowerCase()
  if (!needle) return 0
  const rows = [...(haul.inventoryAdded || []), ...(haul.inventoryChanged || [])]
  return rows
    .filter((r) => r.displayName.toLowerCase().includes(needle) && r.delta > 0)
    .reduce((s, r) => s + r.delta, 0)
}

function newId() {
  return `goal-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`
}

export function SessionGoalsCard({ settings, onUpdate, onClearHaul }: Props) {
  const [haul, setHaul] = useState<SessionHaulSnapshot | null>(null)
  const goals = settings.sessionGoals || []

  const refresh = useCallback(async () => {
    if (!window.voidlens?.getSessionHaul) return
    try {
      setHaul(await window.voidlens.getSessionHaul())
    } catch {
      setHaul(null)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const offRelic = window.voidlens?.onRelicScanUpdated?.(() => void refresh())
    const offInv = window.voidlens?.onInventoryUpdated?.(() => void refresh())
    const id = window.setInterval(() => void refresh(), 20_000)
    return () => {
      offRelic?.()
      offInv?.()
      window.clearInterval(id)
    }
  }, [refresh])

  const rows = useMemo(
    () =>
      goals.map((g) => {
        const current = progressFor(g, haul)
        const target = Math.max(1, g.target || 1)
        const pct = Math.min(100, Math.round((current / target) * 100))
        return { goal: g, current, target, pct, done: current >= target }
      }),
    [goals, haul],
  )

  const setGoals = (next: SessionGoal[]) => onUpdate({ sessionGoals: next })

  const addGoal = (kind: SessionGoalKind) => {
    const base: SessionGoal = {
      id: newId(),
      kind,
      target: kind === 'plat_seen' ? 50 : kind === 'relic_scans' ? 10 : 3,
      label: kindLabel(kind),
      matchName: kind === 'inventory_item' ? 'Forma' : undefined,
    }
    setGoals([...goals, base])
  }

  const patchGoal = (id: string, partial: Partial<SessionGoal>) => {
    setGoals(goals.map((g) => (g.id === id ? { ...g, ...partial } : g)))
  }

  const removeGoal = (id: string) => setGoals(goals.filter((g) => g.id !== id))

  return (
    <Panel
      title="Session goals"
      subtitle={
        haul
          ? `Since ${new Date(haul.startedAt).toLocaleTimeString()} · ${haul.relicScans} scans`
          : 'Live OCR + inventory counters'
      }
      className="session-goals"
    >
      {!rows.length ? (
        <p className="muted" style={{ marginTop: 0 }}>
          Add a goal to track relic scans, needed parts, plat seen, or inventory gains this session.
        </p>
      ) : (
        <ul className="session-goals__list">
          {rows.map(({ goal, current, target, pct, done }) => (
            <li key={goal.id} className={`session-goals__row${done ? ' is-done' : ''}`}>
              <div className="session-goals__head">
                <strong>{goal.label || kindLabel(goal.kind)}</strong>
                <span className={done ? 'is-ok' : ''}>
                  {current}/{target}
                  {done ? ' · done' : ''}
                </span>
              </div>
              <div className="session-goals__bar" aria-hidden>
                <div className="session-goals__fill" style={{ width: `${pct}%` }} />
              </div>
              <div className="session-goals__edit">
                <label>
                  Target
                  <input
                    type="number"
                    min={1}
                    value={goal.target}
                    onChange={(e) =>
                      patchGoal(goal.id, { target: Math.max(1, Math.floor(Number(e.target.value) || 1)) })
                    }
                  />
                </label>
                {goal.kind === 'inventory_item' ? (
                  <label>
                    Name contains
                    <input
                      type="text"
                      value={goal.matchName || ''}
                      placeholder="Forma"
                      onChange={(e) => patchGoal(goal.id, { matchName: e.target.value })}
                    />
                  </label>
                ) : null}
                <button type="button" className="btn ghost" onClick={() => removeGoal(goal.id)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="session-goals__actions">
        <button type="button" className="btn ghost" onClick={() => addGoal('relic_scans')}>
          + Scans
        </button>
        <button type="button" className="btn ghost" onClick={() => addGoal('needed_parts')}>
          + Needed
        </button>
        <button type="button" className="btn ghost" onClick={() => addGoal('plat_seen')}>
          + Plat
        </button>
        <button type="button" className="btn ghost" onClick={() => addGoal('inventory_item')}>
          + Item
        </button>
        {onClearHaul ? (
          <button
            type="button"
            className="btn ghost"
            onClick={() => {
              onClearHaul()
              void refresh()
            }}
          >
            Reset haul
          </button>
        ) : null}
      </div>
    </Panel>
  )
}
