/**
 * Owned gear coaching (Forma / rank) — not live “currently equipped” loadout.
 */
import type {
  LoadoutCategory,
  LoadoutCoachTag,
  LoadoutItem,
  LoadoutSnapshot,
} from '../../shared/types'
import {
  getGearCategoryIndex,
  getMasteryIndex,
  getPlayerLevel,
  peekInventoryIndex,
} from './inventory'
import { findCatalogItemByUnique } from './item-catalog'

function displayName(uniqueName: string): string {
  const hit = findCatalogItemByUnique(uniqueName)
  if (hit?.name) return hit.name
  const leaf = uniqueName.split('/').pop() || uniqueName
  return leaf.replace(/([a-z])([A-Z])/g, '$1 $2')
}

function coach(
  category: LoadoutCategory,
  xpLevel: number | null,
  formaCount: number,
): { tags: LoadoutCoachTag[]; note: string } {
  const tags: LoadoutCoachTag[] = []
  if (xpLevel == null) {
    tags.push('unknown_rank')
    return {
      tags,
      note: formaCount
        ? `${formaCount} Forma applied · rank unknown from export`
        : 'Rank unknown from this inventory export',
    }
  }
  if (xpLevel >= 30) {
    tags.push('sp_ready')
  } else {
    tags.push('unranked')
  }

  const softTarget = category === 'warframe' ? 3 : 2
  if (xpLevel >= 30 && formaCount < softTarget) {
    tags.push('under_forma')
  } else if (formaCount >= softTarget) {
    tags.push('forma_ok')
  }

  if (xpLevel < 30) {
    return {
      tags,
      note: `Rank ${xpLevel}/30 — level before heavy Forma investment`,
    }
  }
  if (formaCount < softTarget) {
    return {
      tags,
      note: `Rank 30 · ${formaCount} Forma — light for a full SP build (aim ≥${softTarget})`,
    }
  }
  if (formaCount >= 5) {
    return {
      tags,
      note: `Rank 30 · ${formaCount} Forma — well polarized`,
    }
  }
  return {
    tags,
    note: `Rank 30 · ${formaCount} Forma`,
  }
}

const CAT_ORDER: LoadoutCategory[] = [
  'warframe',
  'primary',
  'secondary',
  'melee',
  'companion',
  'archwing',
  'other',
]

export function getLoadoutSnapshot(): LoadoutSnapshot {
  const mastery = getMasteryIndex()
  const cats = getGearCategoryIndex()
  const index = peekInventoryIndex()
  const loaded = Object.keys(index).length > 0
  const playerLevel = getPlayerLevel()

  const items: LoadoutItem[] = []
  const seen = new Set<string>()

  for (const [uniqueName, entry] of Object.entries(mastery)) {
    if (!uniqueName.includes('/')) continue
    if (seen.has(uniqueName)) continue
    if (entry.owned <= 0) continue
    const category = cats[uniqueName] || cats[uniqueName.split('/').pop() || ''] || 'other'
    if (category === 'other' && !/Powersuits|Weapons|Sentinels|Mech/i.test(uniqueName)) {
      continue
    }
    seen.add(uniqueName)
    const formaCount = entry.formaCount ?? 0
    const { tags, note } = coach(category, entry.xpLevel, formaCount)
    items.push({
      uniqueName,
      name: displayName(uniqueName),
      category,
      owned: entry.owned,
      xpLevel: entry.xpLevel,
      mastered: entry.mastered,
      formaCount,
      tags,
      note,
    })
  }

  items.sort((a, b) => {
    const ca = CAT_ORDER.indexOf(a.category)
    const cb = CAT_ORDER.indexOf(b.category)
    if (ca !== cb) return ca - cb
    const score = (t: LoadoutItem) =>
      (t.tags.includes('unranked') ? 0 : 2) + (t.tags.includes('under_forma') ? 0 : 1)
    const d = score(a) - score(b)
    if (d !== 0) return d
    return a.name.localeCompare(b.name)
  })

  const warframes = items.filter((i) => i.category === 'warframe').length
  const weapons = items.filter((i) =>
    i.category === 'primary' || i.category === 'secondary' || i.category === 'melee',
  ).length

  return {
    playerLevel,
    loaded,
    items: items.slice(0, 200),
    summary: {
      warframes,
      weapons,
      unranked: items.filter((i) => i.tags.includes('unranked')).length,
      underForma: items.filter((i) => i.tags.includes('under_forma')).length,
      spReady: items.filter((i) => i.tags.includes('sp_ready')).length,
    },
  }
}
