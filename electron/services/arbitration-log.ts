/**
 * Arbitration haul log + multi-day analytics (persisted).
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type {
  ArbitrationAnalytics,
  ArbitrationLogSnapshot,
  ArbitrationRunEntry,
  InventoryDiff,
} from '../../shared/types'

const sessionStartedAt = new Date().toISOString()
const MAX_RUNS = 200
const MAX_RETURN = 40

/** Best-effort rare / currency names associated with Arbitration farming. */
const RARE_RE =
  /vitus|arbitrat|galvaplasm|ayatan|forma|adaptat|rolling\s*guard|aura\s*forma|crusade|vigorous\s*swap|sharpened\s*bullets|brief\s*respite|galvanized/i

let runs: ArbitrationRunEntry[] = []
let lastArbitrationNode: string | null = null
let arbitrationSeenAt = 0
let loaded = false

function storePath() {
  return path.join(app.getPath('userData'), 'arbitration-log.json')
}

function loadRuns() {
  if (loaded) return
  loaded = true
  try {
    const file = storePath()
    if (!fs.existsSync(file)) return
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { runs?: ArbitrationRunEntry[] }
    if (Array.isArray(raw.runs)) runs = raw.runs.slice(0, MAX_RUNS)
  } catch {
    runs = []
  }
}

function saveRuns() {
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true })
    fs.writeFileSync(storePath(), JSON.stringify({ runs }, null, 0), 'utf8')
  } catch {
    // ignore
  }
}

function vitusFromRun(run: ArbitrationRunEntry): number {
  let n = 0
  for (const d of run.drops) {
    if (/vitus/i.test(d.displayName) || /vitus/i.test(d.uniqueName)) n += Math.max(0, d.delta)
  }
  return n
}

export function noteActiveArbitration(node: string | null) {
  if (!node) return
  lastArbitrationNode = node
  arbitrationSeenAt = Date.now()
}

export function noteMissionComplete() {
  arbitrationSeenAt = Date.now()
}

function isRare(name: string, uniqueName: string): boolean {
  return RARE_RE.test(name) || RARE_RE.test(uniqueName)
}

export function noteInventoryDiffForArbitration(diff: InventoryDiff | null | undefined) {
  loadRuns()
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
  saveRuns()
}

export function getArbitrationLog(): ArbitrationLogSnapshot {
  loadRuns()
  return {
    sessionStartedAt,
    runs: runs.slice(0, 20),
  }
}

export function getArbitrationAnalytics(): ArbitrationAnalytics {
  loadRuns()
  const list = runs.slice(0, MAX_RETURN)
  let vitusEssence = 0
  let rareDrops = 0
  let totalDropStacks = 0
  const nodeMap = new Map<string, { runs: number; vitus: number; rareDrops: number }>()
  const dayMap = new Map<string, { runs: number; vitus: number }>()

  let oldest = Date.now()
  let newest = 0

  for (const run of list) {
    const t = new Date(run.at).getTime()
    if (!Number.isNaN(t)) {
      oldest = Math.min(oldest, t)
      newest = Math.max(newest, t)
    }
    const vitus = vitusFromRun(run)
    vitusEssence += vitus
    const rare = run.drops.filter((d) => d.rare).length
    rareDrops += rare
    totalDropStacks += run.drops.length

    const node = run.node || 'Unknown'
    const n = nodeMap.get(node) || { runs: 0, vitus: 0, rareDrops: 0 }
    n.runs += 1
    n.vitus += vitus
    n.rareDrops += rare
    nodeMap.set(node, n)

    const day = run.at.slice(0, 10)
    const d = dayMap.get(day) || { runs: 0, vitus: 0 }
    d.runs += 1
    d.vitus += vitus
    dayMap.set(day, d)
  }

  const hours =
    list.length >= 2 && newest > oldest ? Math.max(1 / 60, (newest - oldest) / 3_600_000) : null
  const historyDays =
    list.length >= 1 && newest > oldest
      ? Math.max(1, Math.ceil((newest - oldest) / 86_400_000))
      : list.length ? 1 : 0

  return {
    sessionStartedAt,
    runs: list,
    totals: {
      runs: list.length,
      vitusEssence,
      rareDrops,
      totalDropStacks,
    },
    byNode: [...nodeMap.entries()]
      .map(([node, v]) => ({ node, ...v }))
      .sort((a, b) => b.vitus - a.vitus || b.runs - a.runs),
    byDay: [...dayMap.entries()]
      .map(([day, v]) => ({ day, ...v }))
      .sort((a, b) => b.day.localeCompare(a.day)),
    vitusPerHour: hours != null && hours > 0 ? Math.round((vitusEssence / hours) * 10) / 10 : null,
    historyDays,
  }
}

export function clearArbitrationLog(): ArbitrationLogSnapshot {
  loadRuns()
  runs = []
  saveRuns()
  return getArbitrationLog()
}
