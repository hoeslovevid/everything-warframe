/**
 * In-memory “tonight’s haul” for the current app session.
 * Accumulates relic scan hits and inventory sync deltas.
 */
import type {
  InventoryDiff,
  InventoryDiffEntry,
  RewardEval,
  SessionHaulRelicHit,
  SessionHaulSnapshot,
} from '../../shared/types'

const startedAt = new Date().toISOString()
let relicScans = 0
const relicHits: SessionHaulRelicHit[] = []
let inventoryAdded: InventoryDiffEntry[] = []
let inventoryChanged: InventoryDiffEntry[] = []
let lastSyncAt: string | null = null

const MAX_HITS = 40
const MAX_INV = 30

export function recordRelicHaul(rewards: RewardEval[]) {
  relicScans += 1
  const at = new Date().toISOString()
  for (const r of rewards) {
    if (!r.name || r.matchScore < 0.45) continue
    relicHits.unshift({
      at,
      name: r.name,
      needed: Boolean(r.needed),
      platinum: r.platinum,
      setName: r.setName,
    })
  }
  while (relicHits.length > MAX_HITS) relicHits.pop()
}

export function recordInventoryHaul(diff: InventoryDiff | null | undefined) {
  if (!diff) return
  lastSyncAt = diff.syncedAt || new Date().toISOString()
  const merge = (into: InventoryDiffEntry[], rows: InventoryDiffEntry[]) => {
    for (const row of rows) {
      const i = into.findIndex((x) => x.uniqueName === row.uniqueName)
      if (i >= 0) {
        into[i] = {
          ...into[i],
          after: row.after,
          delta: into[i].delta + row.delta,
        }
      } else {
        into.unshift(row)
      }
    }
    into.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    if (into.length > MAX_INV) into.length = MAX_INV
  }
  merge(inventoryAdded, diff.added || [])
  merge(
    inventoryChanged,
    (diff.changed || []).filter((c) => c.delta > 0),
  )
}

export function getSessionHaul(): SessionHaulSnapshot {
  const platEstimate = relicHits.reduce((sum, h) => sum + (h.platinum || 0), 0)
  const neededParts = relicHits.filter((h) => h.needed).length
  return {
    startedAt,
    relicScans,
    relicHits: relicHits.slice(0, 12),
    neededParts,
    platEstimate,
    inventoryAdded: inventoryAdded.slice(0, 10),
    inventoryChanged: inventoryChanged.slice(0, 10),
    lastSyncAt,
  }
}

export function clearSessionHaul() {
  relicScans = 0
  relicHits.length = 0
  inventoryAdded = []
  inventoryChanged = []
  lastSyncAt = null
  return getSessionHaul()
}
