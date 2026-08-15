import dns from 'node:dns'
import {
  AlertInfo,
  ArbitrationInfo,
  ArchonHuntInfo,
  BaroInfo,
  CircuitInfo,
  CycleInfo,
  DeepArchimedeaInfo,
  FissureInfo,
  InvasionInfo,
  NightwaveChallenge,
  NightwaveInfo,
  SortieInfo,
  WorldstateSnapshot,
} from '../../shared/types'

const BASE = 'https://api.warframestat.us/pc'

// Windows / some networks hang on broken IPv6 → Cloudflare before falling back.
try {
  dns.setDefaultResultOrder('ipv4first')
} catch {
  // older Node
}

const FETCH_TIMEOUT_MS = 12_000
const FETCH_RETRIES = 3

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms))
}

async function getJson<T>(path: string): Promise<T> {
  let lastErr: unknown
  for (let attempt = 0; attempt < FETCH_RETRIES; attempt++) {
    try {
      const res = await fetch(`${BASE}${path}`, {
        headers: {
          Accept: 'application/json',
          'Accept-Language': 'en',
          'User-Agent': 'EverythingWarframe/worldstate',
        },
        signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
      })
      if (!res.ok) {
        throw new Error(`Worldstate request failed: ${res.status} ${path}`)
      }
      return (await res.json()) as T
    } catch (err) {
      lastErr = err
      const retryable =
        attempt < FETCH_RETRIES - 1 &&
        (err instanceof Error
          ? /timeout|fetch failed|ECONN|ENOTFOUND|UND_ERR|aborted/i.test(
              `${err.message} ${(err as { cause?: { code?: string } }).cause?.code || ''}`,
            )
          : false)
      if (!retryable) break
      await sleep(400 * 2 ** attempt)
    }
  }
  throw lastErr instanceof Error
    ? lastErr
    : new Error(`Worldstate request failed: ${path}`)
}

function etaFromExpiry(expiry?: string): string {
  if (!expiry) return '—'
  const ms = new Date(expiry).getTime() - Date.now()
  if (Number.isNaN(ms)) return '—'
  if (ms <= 0) return 'expired'
  const totalSec = Math.floor(ms / 1000)
  const h = Math.floor(totalSec / 3600)
  const m = Math.floor((totalSec % 3600) / 60)
  const s = totalSec % 60
  if (h > 0) return `${h}h ${m}m`
  if (m > 0) return `${m}m ${s}s`
  return `${s}s`
}

type CyclePayload = {
  id?: string
  state?: string
  timeLeft?: string
  expiry?: string
  isDay?: boolean
  isWarm?: boolean
  isVome?: boolean
  active?: string
  stateLabel?: string
}

type VoidTraderPayload = {
  active?: boolean
  location?: string
  activation?: string
  expiry?: string
  endString?: string
  startString?: string
  inventory?: Array<{
    uniqueName?: string
    item?: string
    ducats?: number
    credits?: number
  }>
}

function cleanBaroItemName(name: string): string {
  return name
    .replace(/^Avatar Image\s+/i, '')
    .replace(/\s+Login Song Item$/i, ' Login Music')
    .trim()
}

function mapBaro(voidTrader: VoidTraderPayload | null | undefined): BaroInfo | null {
  if (!voidTrader) return null

  const arrival = voidTrader.activation || ''
  const departure = voidTrader.expiry || ''
  const now = Date.now()
  const startMs = arrival ? new Date(arrival).getTime() : NaN
  const endMs = departure ? new Date(departure).getTime() : NaN

  let active = Boolean(voidTrader.active)
  if (!Number.isNaN(startMs) && !Number.isNaN(endMs)) {
    active = now >= startMs && now < endMs
  } else if (!Number.isNaN(startMs) && Number.isNaN(endMs)) {
    active = now >= startMs
  } else if (voidTrader.active === undefined) {
    active = false
  }

  const inventory = (voidTrader.inventory || [])
    .map((entry) => ({
      uniqueName: entry.uniqueName || entry.item || '',
      item: cleanBaroItemName(entry.item || 'Unknown item'),
      ducats: Number(entry.ducats) || 0,
      credits: Number(entry.credits) || 0,
    }))
    .filter((entry) => entry.item)
    .sort((a, b) => a.item.localeCompare(b.item))

  return {
    active,
    location: voidTrader.location || 'Unknown',
    arrival,
    departure,
    eta: active
      ? voidTrader.endString || etaFromExpiry(departure)
      : voidTrader.startString || etaFromExpiry(arrival),
    inventory,
  }
}

function mapCycle(id: string, name: string, data: CyclePayload): CycleInfo {
  let state = data.state || data.active || data.stateLabel || 'Unknown'
  if (!data.state && data.isDay !== undefined) state = data.isDay ? 'Day' : 'Night'
  if (!data.state && data.isWarm !== undefined) state = data.isWarm ? 'Warm' : 'Cold'
  if (!data.state && data.isVome !== undefined) state = data.isVome ? 'Vome' : 'Fass'

  return {
    id,
    name,
    state: String(state),
    timeLeft: data.timeLeft || etaFromExpiry(data.expiry),
    expiry: data.expiry || '',
  }
}

/** warframestat returns machine tags like "Radio Legion Intermission15 Syndicate". */
function formatNightwaveTag(tag: string | undefined, season: number): string {
  if (!tag) return season > 0 ? `Season ${season}` : 'Nightwave'
  const cleaned = tag
    .replace(/\s*Syndicate$/i, '')
    .replace(/^Radio Legion\s+/i, '')
    .replace(/Intermission(\d+)/i, 'Intermission $1')
    .replace(/\s+/g, ' ')
    .trim()
  if (/^Intermission\s*\d+/i.test(cleaned)) {
    return season > 0 ? `Nightwave Intermission · S${season}` : `Nightwave ${cleaned}`
  }
  return season > 0 ? `${cleaned} · S${season}` : cleaned
}

function isUsableExpiry(expiry?: string): boolean {
  if (!expiry) return false
  const ms = new Date(expiry).getTime()
  if (Number.isNaN(ms)) return false
  // Reject epoch / far-future API sentinels
  if (ms < Date.UTC(2000, 0, 1)) return false
  if (ms > Date.now() + 1000 * 60 * 60 * 24 * 365 * 5) return false
  return true
}

function mapNightwave(payload: {
  active?: boolean
  season?: number
  tag?: string
  expiry?: string
  activation?: string
  phase?: number
  activeChallenges?: Array<{
    id?: string
    title?: string
    desc?: string
    reputation?: number
    isDaily?: boolean
    isElite?: boolean
    expiry?: string
  }>
} | null): NightwaveInfo | null {
  if (!payload) return null

  const season = payload.season ?? 0
  const expiry = payload.expiry || ''
  const expiryMs = expiry ? new Date(expiry).getTime() : NaN
  const activationMs = payload.activation ? new Date(payload.activation).getTime() : NaN
  const now = Date.now()

  let active = Boolean(payload.active ?? true)
  if (!Number.isNaN(expiryMs) && now >= expiryMs) active = false
  if (!Number.isNaN(activationMs) && now < activationMs) active = false

  const challenges: NightwaveChallenge[] = (payload.activeChallenges || [])
    .map((c) => ({
      id: c.id || `${c.title || 'challenge'}-${c.expiry || ''}`,
      title: c.title || 'Challenge',
      description: c.desc || '',
      reputation: Number(c.reputation) || 0,
      isDaily: Boolean(c.isDaily),
      isElite: Boolean(c.isElite),
      expiry: c.expiry || '',
    }))
    .filter((c) => c.title)
    .sort((a, b) => {
      // Dailies first, then elite, then by expiry
      if (a.isDaily !== b.isDaily) return a.isDaily ? -1 : 1
      if (a.isElite !== b.isElite) return a.isElite ? -1 : 1
      return (a.expiry || '').localeCompare(b.expiry || '')
    })

  return {
    active,
    season,
    tag: formatNightwaveTag(payload.tag, season),
    expiry,
    phase: payload.phase ?? 0,
    challenges,
  }
}

function mapArbitration(payload: {
  node?: string
  nodeKey?: string
  type?: string
  enemy?: string
  expiry?: string
  eta?: string
  activation?: string
  expired?: boolean
} | null): ArbitrationInfo | null {
  if (!payload?.node) return null
  if (payload.expired) return null
  // warframestat placeholder when no arbitration is scheduled
  if (payload.node === 'SolNode000' || payload.nodeKey === 'SolNode000') return null
  if (payload.type === 'Unknown' && payload.enemy === 'Tenno') return null
  if (!isUsableExpiry(payload.expiry)) return null

  return {
    node: payload.node,
    nodeKey: payload.nodeKey || payload.node,
    type: payload.type || 'Unknown',
    enemy: payload.enemy || 'Unknown',
    activation: payload.activation || '',
    expiry: payload.expiry || '',
    eta: payload.eta || etaFromExpiry(payload.expiry),
    upcoming: [],
  }
}

function mapInvasions(
  list: Array<{
    id?: string
    node?: string
    desc?: string
    attacker?: { faction?: string } | string
    defender?: { faction?: string } | string
    completion?: number
    eta?: string
    expiry?: string
  }> | null,
): InvasionInfo[] {
  return (list || [])
    .map((inv) => {
      const attacker =
        typeof inv.attacker === 'string' ? inv.attacker : inv.attacker?.faction || 'Attacker'
      const defender =
        typeof inv.defender === 'string' ? inv.defender : inv.defender?.faction || 'Defender'
      return {
        id: inv.id || `${inv.node}-${inv.expiry}`,
        node: inv.node || 'Unknown',
        desc: inv.desc || '',
        attacker,
        defender,
        completion: Number(inv.completion) || 0,
        eta: inv.eta || etaFromExpiry(inv.expiry),
        expiry: inv.expiry || '',
      }
    })
    .filter((inv) => inv.node !== 'Unknown')
    .slice(0, 12)
}

function mapArchonHunt(payload: {
  boss?: string
  faction?: string
  expiry?: string
  eta?: string
  missions?: Array<{ node?: string; type?: string }>
} | null): ArchonHuntInfo | null {
  if (!payload?.boss && !payload?.missions?.length) return null
  return {
    boss: payload.boss || 'Archon',
    faction: payload.faction || 'Narmer',
    expiry: payload.expiry || '',
    eta: payload.eta || etaFromExpiry(payload.expiry),
    missions: (payload.missions || []).map((m) => ({
      node: m.node || 'Unknown',
      type: m.type || 'Mission',
    })),
  }
}

function mapDeepArchimedea(
  list: Array<{
    id?: string
    type?: string
    typeKey?: string
    expiry?: string
    missions?: Array<{
      missionType?: string
      deviation?: { name?: string }
      risks?: Array<{ name?: string }>
    }>
  }> | null,
): DeepArchimedeaInfo | null {
  if (!list?.length) return null
  const pick =
    list.find((a) => /deep|ct_?lab|lab/i.test(`${a.type || ''} ${a.typeKey || ''}`)) || list[0]
  if (!pick) return null
  const risks = (pick.missions || []).flatMap((m) => [
    m.deviation?.name,
    ...(m.risks || []).map((r) => r.name),
  ]).filter(Boolean) as string[]

  return {
    id: pick.id || 'archimedea',
    expiry: pick.expiry || '',
    eta: etaFromExpiry(pick.expiry),
    missions: (pick.missions || []).map((m, i) => ({
      node: `Mission ${i + 1}`,
      type: m.missionType || 'Mission',
    })),
    riskVariables: [...new Set(risks)].slice(0, 8),
  }
}

function mapSortie(payload: {
  id?: string
  boss?: string
  faction?: string
  rewardPool?: string
  expiry?: string
  eta?: string
  variants?: Array<{
    node?: string
    missionType?: string
    modifier?: string
  }>
} | null): SortieInfo | null {
  if (!payload?.boss && !payload?.variants?.length) return null
  return {
    id: payload.id || 'sortie',
    boss: payload.boss || 'Sortie',
    faction: payload.faction || '',
    rewardPool: payload.rewardPool || '',
    expiry: payload.expiry || '',
    eta: payload.eta || etaFromExpiry(payload.expiry),
    missions: (payload.variants || []).map((v) => ({
      node: v.node || 'Unknown',
      missionType: v.missionType || 'Mission',
      modifier: v.modifier || '',
    })),
  }
}

function mapAlerts(
  list: Array<{
    id?: string
    expiry?: string
    eta?: string
    mission?: {
      node?: string
      type?: string
      faction?: string
      reward?: {
        itemString?: string
        asString?: string
        items?: string[]
        countedItems?: Array<{ count?: number; type?: string }>
        credits?: number
      }
    }
  }> | null,
): AlertInfo[] {
  if (!list?.length) return []
  return list
    .map((a) => {
      const reward = a.mission?.reward
      const parts: string[] = []
      if (reward?.itemString) parts.push(reward.itemString)
      else if (reward?.asString) parts.push(reward.asString)
      else {
        for (const it of reward?.items || []) parts.push(it)
        for (const c of reward?.countedItems || []) {
          if (c.type) parts.push(`${c.count || 1}× ${c.type}`)
        }
        if (reward?.credits) parts.push(`${reward.credits.toLocaleString()} credits`)
      }
      return {
        id: a.id || `${a.mission?.node || 'alert'}-${a.expiry || ''}`,
        node: a.mission?.node || 'Unknown',
        missionType: a.mission?.type || 'Mission',
        faction: a.mission?.faction || '',
        reward: parts.join(' · ') || 'Reward',
        expiry: a.expiry || '',
        eta: a.eta || etaFromExpiry(a.expiry),
      }
    })
    .filter((a) => a.node !== 'Unknown')
    .slice(0, 8)
}

function mapCircuit(
  payload: {
    expiry?: string
    activation?: string
    currentReward?: { name?: string; cost?: number }
    rotation?: Array<{ name?: string; cost?: number } | string>
    isActive?: boolean
    remaining?: string
    eta?: string
  } | null,
): CircuitInfo | null {
  if (!payload) return null
  const rotation = (payload.rotation || [])
    .map((r) => (typeof r === 'string' ? r : r.name || ''))
    .filter(Boolean)
  const current =
    payload.currentReward?.name ||
    (rotation.length ? rotation[0] : null)
  return {
    expiry: payload.expiry || '',
    eta: payload.eta || payload.remaining || '',
    currentReward: current,
    rotation: rotation.slice(0, 8),
    isActive: payload.isActive !== false,
  }
}

export async function fetchWorldstate(): Promise<WorldstateSnapshot> {
  const arbitrationCommunityP = import('./arbitration')
    .then((m) => m.getArbitrationInfo(8))
    .catch(() => null)

  const [
    cetus,
    vallis,
    cambion,
    duviri,
    zariman,
    albrecht,
    fissures,
    voidTrader,
    nightwave,
    arbitration,
    invasions,
    archonHunt,
    archimedeas,
    arbCommunity,
    sortieRaw,
    alertsRaw,
    steelPathRaw,
  ] = await Promise.all([
    getJson<CyclePayload>('/cetusCycle').catch(() => ({}) as CyclePayload),
    getJson<CyclePayload>('/vallisCycle').catch(() => ({}) as CyclePayload),
    getJson<CyclePayload>('/cambionCycle').catch(() => ({}) as CyclePayload),
    getJson<CyclePayload>('/duviriCycle').catch(() => ({}) as CyclePayload),
    getJson<CyclePayload>('/zarimanCycle').catch(() => ({}) as CyclePayload),
    getJson<CyclePayload>('/entratiLabCycle').catch(() =>
      getJson<CyclePayload>('/albrechtCycle').catch(() => ({}) as CyclePayload),
    ),
    getJson<
      Array<{
        id: string
        node: string
        missionType: string
        enemy: string
        tier: string
        eta: string
        isHard: boolean
        isStorm?: boolean
        expiry: string
      }>
    >('/fissures').catch(() => []),
    getJson<VoidTraderPayload>('/voidTrader').catch(() => ({}) as VoidTraderPayload),
    getJson<{
      active?: boolean
      season?: number
      tag?: string
      expiry?: string
      activation?: string
      phase?: number
      activeChallenges?: Array<{
        id?: string
        title?: string
        desc?: string
        reputation?: number
        isDaily?: boolean
        isElite?: boolean
        expiry?: string
      }>
    } | null>('/nightwave').catch(() => null),
    getJson<{
      node?: string
      nodeKey?: string
      type?: string
      enemy?: string
      expiry?: string
      eta?: string
      expired?: boolean
    } | null>('/arbitration').catch(() => null),
    getJson<
      Array<{
        id?: string
        node?: string
        desc?: string
        attacker?: { faction?: string } | string
        defender?: { faction?: string } | string
        completion?: number
        eta?: string
        expiry?: string
      }>
    >('/invasions').catch(() => []),
    getJson<{
      boss?: string
      faction?: string
      expiry?: string
      eta?: string
      missions?: Array<{ node?: string; type?: string }>
    } | null>('/archonHunt').catch(() => null),
    getJson<
      Array<{
        id?: string
        type?: string
        typeKey?: string
        expiry?: string
        missions?: Array<{
          missionType?: string
          deviation?: { name?: string }
          risks?: Array<{ name?: string }>
        }>
      }>
    >('/archimedeas').catch(() => []),
    arbitrationCommunityP,
    getJson<{
      id?: string
      boss?: string
      faction?: string
      rewardPool?: string
      expiry?: string
      eta?: string
      variants?: Array<{
        node?: string
        missionType?: string
        modifier?: string
      }>
    } | null>('/sortie').catch(() => null),
    getJson<
      Array<{
        id?: string
        expiry?: string
        eta?: string
        mission?: {
          node?: string
          type?: string
          faction?: string
          reward?: {
            itemString?: string
            asString?: string
            items?: string[]
            countedItems?: Array<{ count?: number; type?: string }>
            credits?: number
          }
        }
      }>
    >('/alerts').catch(() => []),
    getJson<{
      expiry?: string
      activation?: string
      currentReward?: { name?: string; cost?: number }
      rotation?: Array<{ name?: string; cost?: number } | string>
      isActive?: boolean
      remaining?: string
      eta?: string
    } | null>('/steelPath').catch(() => null),
  ])

  const cycles: CycleInfo[] = [
    mapCycle('cetus', 'Cetus / Earth', cetus),
    mapCycle('vallis', 'Orb Vallis', vallis),
    mapCycle('cambion', 'Cambion Drift', cambion),
  ]

  if (duviri && (duviri.state || duviri.expiry || duviri.timeLeft)) {
    cycles.push(mapCycle('duviri', 'Duviri', duviri))
  }
  if (zariman && (zariman.state || zariman.expiry || zariman.timeLeft)) {
    cycles.push(mapCycle('zariman', 'Zariman', zariman))
  }
  if (albrecht && (albrecht.state || albrecht.expiry || albrecht.timeLeft)) {
    cycles.push(mapCycle('albrecht', "Albrecht's Laboratories", albrecht))
  }

  const fissureList: FissureInfo[] = (fissures || []).map((f) => ({
    id: f.id,
    node: f.node,
    missionType: f.missionType,
    enemy: f.enemy,
    tier: f.tier,
    eta: f.eta || etaFromExpiry(f.expiry),
    isHard: Boolean(f.isHard),
    isStorm: Boolean(f.isStorm),
    expiry: f.expiry,
  }))

  const baro = mapBaro(voidTrader)
  const nw = mapNightwave(nightwave)
  // Prefer community hour schedule — official /arbitration is often a dead placeholder.
  const arb = arbCommunity || mapArbitration(arbitration)

  return {
    fetchedAt: new Date().toISOString(),
    error: null,
    stale: false,
    cycles,
    fissures: fissureList,
    baro,
    nightwave: nw,
    arbitration: arb,
    invasions: mapInvasions(invasions),
    archonHunt: mapArchonHunt(archonHunt),
    deepArchimedea: mapDeepArchimedea(archimedeas),
    sortie: mapSortie(sortieRaw),
    alerts: mapAlerts(alertsRaw),
    circuit: mapCircuit(steelPathRaw),
  }
}

/** Soonest future expiry timestamp, or null if none usable. */
export function nextWorldstateExpiryMs(data: WorldstateSnapshot, now = Date.now()): number | null {
  const expiries: string[] = []
  for (const c of data.cycles) if (c.expiry) expiries.push(c.expiry)
  for (const f of data.fissures) if (f.expiry) expiries.push(f.expiry)
  if (data.baro) {
    if (data.baro.active && data.baro.departure) expiries.push(data.baro.departure)
    else if (!data.baro.active && data.baro.arrival) expiries.push(data.baro.arrival)
  }
  if (data.arbitration?.expiry) expiries.push(data.arbitration.expiry)
  if (data.nightwave?.expiry) expiries.push(data.nightwave.expiry)
  for (const c of data.nightwave?.challenges || []) {
    if (c.expiry) expiries.push(c.expiry)
  }
  if (data.archonHunt?.expiry) expiries.push(data.archonHunt.expiry)
  if (data.deepArchimedea?.expiry) expiries.push(data.deepArchimedea.expiry)
  if (data.sortie?.expiry) expiries.push(data.sortie.expiry)
  if (data.circuit?.expiry) expiries.push(data.circuit.expiry)
  for (const a of data.alerts || []) if (a.expiry) expiries.push(a.expiry)
  for (const inv of data.invasions || []) if (inv.expiry) expiries.push(inv.expiry)

  let soonest: number | null = null
  for (const e of expiries) {
    const end = new Date(e).getTime()
    if (!Number.isFinite(end) || end > now + 1000 * 60 * 60 * 24 * 365 * 5) continue
    if (end <= now) continue
    if (soonest == null || end < soonest) soonest = end
  }
  return soonest
}

/** True when any cached countdown boundary has passed (main-process rollover). */
export function hasExpiredWorldstate(data: WorldstateSnapshot, now = Date.now()): boolean {
  const expiries: string[] = []
  for (const c of data.cycles) if (c.expiry) expiries.push(c.expiry)
  for (const f of data.fissures) if (f.expiry) expiries.push(f.expiry)
  if (data.baro) {
    if (data.baro.active && data.baro.departure) expiries.push(data.baro.departure)
    else if (!data.baro.active && data.baro.arrival) expiries.push(data.baro.arrival)
  }
  if (data.arbitration?.expiry) expiries.push(data.arbitration.expiry)
  if (data.nightwave?.expiry) expiries.push(data.nightwave.expiry)
  for (const c of data.nightwave?.challenges || []) {
    if (c.expiry) expiries.push(c.expiry)
  }
  if (data.archonHunt?.expiry) expiries.push(data.archonHunt.expiry)
  if (data.deepArchimedea?.expiry) expiries.push(data.deepArchimedea.expiry)
  if (data.sortie?.expiry) expiries.push(data.sortie.expiry)
  if (data.circuit?.expiry) expiries.push(data.circuit.expiry)
  for (const a of data.alerts || []) if (a.expiry) expiries.push(a.expiry)
  for (const inv of data.invasions || []) if (inv.expiry) expiries.push(inv.expiry)

  return expiries.some((e) => {
    const end = new Date(e).getTime()
    // Ignore absurd far-future API sentinels
    if (!Number.isFinite(end) || end > now + 1000 * 60 * 60 * 24 * 365 * 5) return false
    return end <= now
  })
}
