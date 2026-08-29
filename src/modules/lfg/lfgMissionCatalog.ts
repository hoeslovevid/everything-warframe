/**
 * Static mission / farm suggestions for LFG Mission/node search.
 * Live fissures, sortie, and arbitration are merged on top in LfgPage.
 */

export type LfgActivityId = 'relic' | 'fissure' | 'farm' | 'boss' | 'custom'

export type LfgMissionCatalogEntry = {
  id: string
  label: string
  /** Written into missionHint on select. */
  value: string
  detail?: string
  /** Prefer when posting this activity (still searchable from all). */
  activities?: LfgActivityId[]
}

export const LFG_MISSION_CATALOG: LfgMissionCatalogEntry[] = [
  // Boss / heists
  {
    id: 'profit-taker',
    label: 'Profit Taker',
    value: 'Profit Taker · Orb Vallis',
    detail: 'Fortuna · Orb Heist',
    activities: ['boss', 'farm'],
  },
  {
    id: 'exploiter',
    label: 'Exploiter Orb',
    value: 'Exploiter Orb · Orb Vallis',
    detail: 'Fortuna · Thermia Fractures',
    activities: ['boss', 'farm'],
  },
  {
    id: 'eidolons',
    label: 'Eidolons',
    value: 'Eidolons · Plains of Eidolon',
    detail: 'Cetus · Teralyst / Gantulyst / Hydrolyst',
    activities: ['boss', 'farm'],
  },
  {
    id: 'archon-hunt',
    label: 'Archon Hunt',
    value: 'Archon Hunt',
    detail: 'Weekly · Steel Path',
    activities: ['boss'],
  },
  {
    id: 'assassination',
    label: 'Assassination',
    value: 'Assassination',
    detail: 'Planet boss nodes',
    activities: ['boss'],
  },
  {
    id: 'kuva-lich',
    label: 'Kuva Lich',
    value: 'Kuva Lich showdown',
    detail: 'Railjack / thrall farm',
    activities: ['boss', 'farm'],
  },
  {
    id: 'sisters',
    label: 'Sisters of Parvos',
    value: 'Sisters of Parvos showdown',
    detail: 'Corpus counterpart',
    activities: ['boss', 'farm'],
  },

  // Farms
  {
    id: 'index',
    label: 'The Index',
    value: 'The Index · Neptune',
    detail: 'Credit farm',
    activities: ['farm'],
  },
  {
    id: 'sanctuary',
    label: 'Sanctuary Onslaught',
    value: 'Sanctuary Onslaught',
    detail: 'SO / ESO',
    activities: ['farm'],
  },
  {
    id: 'eso',
    label: 'Elite Sanctuary Onslaught',
    value: 'Elite Sanctuary Onslaught',
    detail: 'ESO',
    activities: ['farm'],
  },
  {
    id: 'arbitration-any',
    label: 'Arbitration',
    value: 'Arbitration',
    detail: 'Any node · Vitus',
    activities: ['farm', 'boss'],
  },
  {
    id: 'circuit',
    label: 'The Circuit',
    value: 'The Circuit · Duviri',
    detail: 'Normal / Steel Path',
    activities: ['farm'],
  },
  {
    id: 'deep-archimedea',
    label: 'Deep Archimedea',
    value: 'Deep Archimedea · Albrecht',
    detail: 'Weekly',
    activities: ['farm', 'boss'],
  },
  {
    id: 'temporal-archimedea',
    label: 'Temporal Archimedea',
    value: 'Temporal Archimedea',
    detail: '1999 weekly',
    activities: ['farm', 'boss'],
  },
  {
    id: 'netracells',
    label: 'Netracells',
    value: 'Netracells · Albrecht',
    detail: 'Archon shards',
    activities: ['farm'],
  },
  {
    id: 'mirror-defense',
    label: 'Mirror Defense',
    value: 'Mirror Defense · Tyana Pass',
    detail: 'Mars · Cadus / Molts',
    activities: ['farm'],
  },
  {
    id: 'alchemy',
    label: 'Alchemy',
    value: 'Alchemy · Cambion Drift',
    detail: 'Entrati / mechs',
    activities: ['farm'],
  },
  {
    id: 'isolation-vault',
    label: 'Isolation Vault',
    value: 'Isolation Vault · Cambion Drift',
    detail: 'Necramech / Isolator bursas',
    activities: ['farm', 'boss'],
  },
  {
    id: 'free-roam-bounty',
    label: 'Open-world bounty',
    value: 'Open-world bounty',
    detail: 'Cetus / Fortuna / Necralisk / Höllvania',
    activities: ['farm'],
  },
  {
    id: 'survival',
    label: 'Survival',
    value: 'Survival',
    detail: 'Generic long run',
    activities: ['farm', 'fissure'],
  },
  {
    id: 'defense',
    label: 'Defense',
    value: 'Defense',
    detail: 'Generic',
    activities: ['farm', 'fissure'],
  },
  {
    id: 'excavation',
    label: 'Excavation',
    value: 'Excavation',
    detail: 'Generic',
    activities: ['farm', 'fissure'],
  },
  {
    id: 'disruption',
    label: 'Disruption',
    value: 'Disruption',
    detail: 'Generic',
    activities: ['farm', 'fissure'],
  },
  {
    id: 'spy',
    label: 'Spy',
    value: 'Spy',
    detail: 'Generic',
    activities: ['farm', 'fissure'],
  },
  {
    id: 'rescue',
    label: 'Rescue',
    value: 'Rescue',
    detail: 'Generic',
    activities: ['farm', 'fissure'],
  },
  {
    id: 'hijack',
    label: 'Hijack',
    value: 'Hijack',
    detail: 'Generic',
    activities: ['farm'],
  },
  {
    id: 'mobile-defense',
    label: 'Mobile Defense',
    value: 'Mobile Defense',
    detail: 'Generic',
    activities: ['farm', 'fissure'],
  },
  {
    id: 'interception',
    label: 'Interception',
    value: 'Interception',
    detail: 'Generic',
    activities: ['farm', 'fissure'],
  },
  {
    id: 'defection',
    label: 'Defection',
    value: 'Defection',
    detail: 'Generic',
    activities: ['farm'],
  },
  {
    id: 'infested-salvage',
    label: 'Infested Salvage',
    value: 'Infested Salvage',
    detail: 'Eris',
    activities: ['farm'],
  },
  {
    id: 'railjack',
    label: 'Railjack',
    value: 'Railjack mission',
    detail: 'Skirmish / Volatile / Orphix',
    activities: ['farm', 'custom'],
  },
  {
    id: 'void-cascade',
    label: 'Void Cascade',
    value: 'Void Cascade · Zariman',
    detail: 'Thrax / focus',
    activities: ['farm', 'fissure'],
  },
  {
    id: 'void-flood',
    label: 'Void Flood',
    value: 'Void Flood · Zariman',
    detail: 'Zariman',
    activities: ['farm', 'fissure'],
  },
  {
    id: 'void-armageddon',
    label: 'Void Armageddon',
    value: 'Void Armageddon · Zariman',
    detail: 'Zariman',
    activities: ['farm', 'fissure'],
  },
  {
    id: 'hell-scrub',
    label: 'Hell-Scrub',
    value: 'Hell-Scrub · 1999',
    detail: 'Höllvania',
    activities: ['farm'],
  },
  {
    id: 'legacyte',
    label: 'Legacyte Harvest',
    value: 'Legacyte Harvest · 1999',
    detail: 'Höllvania',
    activities: ['farm'],
  },

  // Relic / fissure helpers (mission type only — live nodes still preferred)
  {
    id: 'fissure-any',
    label: 'Void Fissure (any)',
    value: 'Void Fissure',
    detail: 'Pick a live node from the list when possible',
    activities: ['fissure', 'relic'],
  },
  {
    id: 'capture-fis',
    label: 'Capture (fissure)',
    value: 'Capture',
    detail: 'Fast fissure',
    activities: ['fissure', 'relic'],
  },
  {
    id: 'exterminate-fis',
    label: 'Exterminate (fissure)',
    value: 'Exterminate',
    detail: 'Fast fissure',
    activities: ['fissure', 'relic'],
  },
]

/** Convert catalog entries to search options; prefer activity matches first. */
export function catalogMissionOptions(
  activity?: LfgActivityId,
): Array<{
  id: string
  label: string
  value: string
  detail?: string
  meta?: Record<string, unknown>
}> {
  const scored = LFG_MISSION_CATALOG.map((e) => {
    const preferred = activity && e.activities?.includes(activity) ? 0 : 1
    return { e, preferred }
  }).sort((a, b) => a.preferred - b.preferred || a.e.label.localeCompare(b.e.label))

  return scored.map(({ e }) => ({
    id: `cat-${e.id}`,
    label: e.label,
    value: e.value,
    detail: e.detail
      ? activity && e.activities?.includes(activity)
        ? `${e.detail} · suggested`
        : e.detail
      : undefined,
    meta: { kind: 'catalog', catalogId: e.id },
  }))
}
