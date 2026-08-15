/**
 * Session log of Arbitration-ish rare gains (inventory sync / mission complete).
 */
import type {
  ArbitrationLogSnapshot,
  ArbitrationRunEntry,
  InventoryDiff,
} from '../../shared/types'

const sessionStartedAt = new Date().toISOString()
const runs: ArbitrationRunEntry[] = []
const MAX_RUNS = 30

/** Best-effort rare / currency names associated with Arbitration farming. */
const RARE_RE =
  /vitus|arbitrat|galvaplasm|ayatan|forma|adaptat|rolling\s*guard|aura\s*forma|crusade|vigorous\s*swap|sharpened\s*bullets|brief\s*respite/i

let lastArbitrationNode: string | null = null
let arbitrationSeenAt = 0

export function noteActiveArbitration(node: string | null) {
  if (!node) return
  lastArbitrationNode = node
  arbitrationSeenAt = Date.now()
}

export function noteMissionComplete() {
  // Soft arm: next inventory sync within 15m can be tagged mission_complete.
  arbitrationSeenAt = Date.now()
}

function isRare(name: string, uniqueName: string): boolean {
  return RARE_RE.test(name) || RARE_RE.test(uniqueName)
}

export function noteInventoryDiffForArbitration(diff: InventoryDiff | null | undefined) {
  if (!diff) return
  const gains = [...(diff.added || []), ...(diff.changed || []).filter((c) => c.delta > 0)]
  if (!gains.length) return

  const recentArb = Date.now() - arbitrationSeenAt < 20 * 60_000
  const drops = gains
    .filter((g) => recentArb || isRare(g.displayName, g.uniqueName))
    .map((g) => ({
      displayName: g.displayName,
      uniqueName: g.uniqueName,
      delta: g.delta,
      rare: isRare(g.displayName, g.uniqueName),
    }))
    .filter((d) => d.rare || recentArb)

  // Prefer rare-only noise reduction when not recently in/near Arbitration.
  const filtered = recentArb ? drops.slice(0, 24) : drops.filter((d) => d.rare).slice(0, 16)
  if (!filtered.length) return

  const source: ArbitrationRunEntry['source'] =
    recentArb && Date.now() - arbitrationSeenAt < 15 * 60_000
      ? 'mission_complete'
      : 'inventory_sync'

  runs.unshift({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: diff.syncedAt || new Date().toISOString(),
    source,
    node: recentArb ? lastArbitrationNode : null,
    drops: filtered,
  })
  while (runs.length > MAX_RUNS) runs.pop()
}

export function getArbitrationLog(): ArbitrationLogSnapshot {
  return {
    sessionStartedAt,
    runs: runs.slice(0, 20),
  }
}

export function clearArbitrationLog(): ArbitrationLogSnapshot {
  runs.length = 0
  return getArbitrationLog()
}
