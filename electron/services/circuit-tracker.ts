/**
 * Steel Path Circuit rotation vs local inventory / mastery ownership.
 * Rewards from warframestat are free-form names (often Incarnon weapon names).
 */
import type { CircuitInfo, CircuitRewardRow, CircuitTrackerSnapshot } from '../../shared/types'
import { ensureItemCatalog, findCatalogItemByName, findCatalogItemByUnique } from './item-catalog'
import {
  getMasteryIndex,
  ownedCountFor,
  peekInventoryIndex,
} from './inventory'

function displayLeaf(uniqueName: string): string {
  const hit = findCatalogItemByUnique(uniqueName)
  if (hit?.name) return hit.name
  const leaf = uniqueName.split('/').pop() || uniqueName
  return leaf.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function masteryOwns(uniqueName: string): boolean {
  const mastery = getMasteryIndex()
  const direct = mastery[uniqueName]
  if (direct && direct.owned > 0) return true
  for (const [k, v] of Object.entries(mastery)) {
    if (v.owned <= 0) continue
    if (k === uniqueName || k.endsWith(uniqueName) || uniqueName.endsWith(k)) return true
  }
  return false
}

function fuzzyOwned(rewardName: string): { owned: boolean; ownedCount: number; uniqueName: string | null; note: string } {
  const needle = rewardName.trim()
  if (!needle) {
    return { owned: false, ownedCount: 0, uniqueName: null, note: 'Unknown reward' }
  }

  const variants = [
    needle,
    `${needle} Incarnon Genesis`,
    `${needle} Incarnon Adapter`,
    `${needle} Incarnon`,
  ]

  for (const v of variants) {
    const hit = findCatalogItemByName(v)
    if (!hit) continue
    const count = ownedCountFor(hit.uniqueName)
    const mastered = masteryOwns(hit.uniqueName)
    const owned = count > 0 || mastered
    return {
      owned,
      ownedCount: Math.max(count, mastered ? 1 : 0),
      uniqueName: hit.uniqueName,
      note: owned
        ? count > 0
          ? `Owned ×${count}`
          : 'Owned (mastery / inventory)'
        : hit.name.toLowerCase().includes('incarnon')
          ? 'Missing Incarnon adapter'
          : 'Not in inventory',
    }
  }

  const lower = needle.toLowerCase()
  const mastery = getMasteryIndex()
  for (const [un, entry] of Object.entries(mastery)) {
    if (entry.owned <= 0) continue
    const dn = displayLeaf(un).toLowerCase()
    if (dn === lower || dn.includes(lower) || lower.includes(dn)) {
      return {
        owned: true,
        ownedCount: entry.owned,
        uniqueName: un,
        note: `Matched owned gear · ${displayLeaf(un)}`,
      }
    }
  }

  const index = peekInventoryIndex()
  for (const [un, count] of Object.entries(index)) {
    if (count <= 0) continue
    const dn = displayLeaf(un).toLowerCase()
    if (dn.includes(lower) || (lower.length >= 4 && dn.includes(`${lower} incarnon`))) {
      return {
        owned: true,
        ownedCount: count,
        uniqueName: un,
        note: `Matched inventory · ${displayLeaf(un)}`,
      }
    }
  }

  return {
    owned: false,
    ownedCount: 0,
    uniqueName: null,
    note: 'No inventory match — farm this week if you want it',
  }
}

export async function getCircuitTracker(
  circuit: CircuitInfo | null | undefined,
): Promise<CircuitTrackerSnapshot> {
  try {
    await ensureItemCatalog()
  } catch {
    /* best-effort */
  }
  return buildCircuitTracker(circuit)
}

function buildCircuitTracker(circuit: CircuitInfo | null | undefined): CircuitTrackerSnapshot {
  if (!circuit) {
    return {
      expiry: '',
      eta: '',
      isActive: false,
      currentReward: null,
      rewards: [],
      ownedCount: 0,
      missingCount: 0,
      inventoryLoaded: Object.keys(peekInventoryIndex()).length > 0,
    }
  }

  const names = circuit.rotation.length
    ? circuit.rotation
    : circuit.currentReward
      ? [circuit.currentReward]
      : []

  const rewards: CircuitRewardRow[] = names.map((name) => {
    const own = fuzzyOwned(name)
    return {
      name,
      isCurrent: Boolean(circuit.currentReward && name === circuit.currentReward),
      owned: own.owned,
      ownedCount: own.ownedCount,
      uniqueName: own.uniqueName,
      note: own.note,
    }
  })

  const ownedCount = rewards.filter((r) => r.owned).length
  return {
    expiry: circuit.expiry || '',
    eta: circuit.eta || '',
    isActive: circuit.isActive !== false,
    currentReward: circuit.currentReward,
    rewards,
    ownedCount,
    missingCount: Math.max(0, rewards.length - ownedCount),
    inventoryLoaded: Object.keys(peekInventoryIndex()).length > 0,
  }
}
