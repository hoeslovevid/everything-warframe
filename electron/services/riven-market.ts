/**
 * warframe.market riven auction estimates.
 * Prices are median buyouts for similar listings (weapon + matched stats), not a guaranteed sale.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type { RivenRoll, RivenStatLine } from '../../shared/types'
import { isCompleteRiven } from '../../shared/ocr-quality'
import { weaponBaseName } from './riven-preferences'

export type RivenMarketQuote = {
  platinum: number
  volume: number
  /** How tightly the auction query matched OCR stats. */
  match: 'exact' | 'stats' | 'loose'
  weaponSlug: string
  fetchedAt: number
}

type WeaponRow = { slug: string; name: string; key: string }

const ATTR_BY_CANON: Record<string, string> = {
  'critical chance': 'critical_chance',
  'critical damage': 'critical_damage',
  multishot: 'multishot',
  damage: 'base_damage_/_melee_damage',
  'fire rate': 'fire_rate_/_attack_speed',
  'status chance': 'status_chance',
  'status duration': 'status_duration',
  reload: 'reload_speed',
  'magazine capacity': 'magazine_capacity',
  'ammo maximum': 'ammo_maximum',
  'projectile speed': 'projectile_speed',
  punchthrough: 'punch_through',
  'toxin damage': 'toxin_damage',
  'heat damage': 'heat_damage',
  'cold damage': 'cold_damage',
  'electricity damage': 'electric_damage',
  'slash damage': 'slash_damage',
  'puncture damage': 'puncture_damage',
  'impact damage': 'impact_damage',
  zoom: 'zoom',
  recoil: 'recoil',
  'weapon recoil': 'recoil',
  'damage to corpus': 'damage_vs_corpus',
  'damage to grineer': 'damage_vs_grineer',
  'damage to infested': 'damage_vs_infested',
  range: 'range',
  'combo duration': 'combo_duration',
  'initial combo': 'channeling_damage',
  'finisher damage': 'finisher_damage',
  'heavy attack efficiency': 'channeling_efficiency',
  'combo chance': 'chance_to_gain_extra_combo_count',
  'slide critical chance': 'critical_chance_on_slide_attack',
}

const TTL_MS = 30 * 60_000
const WEAPON_TTL_MS = 24 * 60 * 60_000
const quoteCache = new Map<string, RivenMarketQuote>()
let weapons: WeaponRow[] | null = null
let weaponsFetchedAt = 0
let weaponsInflight: Promise<WeaponRow[]> | null = null

function cacheDir() {
  return path.join(app.getPath('userData'), 'cache')
}

function quoteCachePath() {
  return path.join(cacheDir(), 'riven-market-quotes.json')
}

function weaponsCachePath() {
  return path.join(cacheDir(), 'riven-weapons.json')
}

function normKey(s: string) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '')
}

function loadQuoteDisk() {
  try {
    if (!fs.existsSync(quoteCachePath())) return
    const raw = JSON.parse(fs.readFileSync(quoteCachePath(), 'utf8')) as Record<
      string,
      RivenMarketQuote
    >
    for (const [k, v] of Object.entries(raw)) {
      if (v?.platinum != null) quoteCache.set(k, v)
    }
  } catch {
    // ignore
  }
}

function saveQuoteDisk() {
  try {
    fs.mkdirSync(cacheDir(), { recursive: true })
    const obj: Record<string, RivenMarketQuote> = {}
    for (const [k, v] of quoteCache.entries()) obj[k] = v
    fs.writeFileSync(quoteCachePath(), JSON.stringify(obj), 'utf8')
  } catch {
    // ignore
  }
}

let quotesDiskLoaded = false

function headers(): Record<string, string> {
  return {
    Accept: 'application/json',
    Platform: 'pc',
    Language: 'en',
  }
}

async function ensureWeapons(): Promise<WeaponRow[]> {
  if (weapons && Date.now() - weaponsFetchedAt < WEAPON_TTL_MS) return weapons
  if (weaponsInflight) return weaponsInflight

  weaponsInflight = (async () => {
    try {
      if (fs.existsSync(weaponsCachePath())) {
        const disk = JSON.parse(fs.readFileSync(weaponsCachePath(), 'utf8')) as {
          fetchedAt: number
          items: WeaponRow[]
        }
        if (disk.items?.length && Date.now() - disk.fetchedAt < WEAPON_TTL_MS) {
          weapons = disk.items
          weaponsFetchedAt = disk.fetchedAt
          return weapons
        }
      }
    } catch {
      // fall through to network
    }

    try {
      const res = await fetch('https://api.warframe.market/v2/riven/weapons', {
        headers: headers(),
      })
      if (!res.ok) throw new Error(`weapons ${res.status}`)
      const json = (await res.json()) as {
        data?: Array<{ slug?: string; i18n?: { en?: { name?: string } } }>
      }
      const rows: WeaponRow[] = (json.data || [])
        .map((w) => {
          const slug = w.slug || ''
          const name = w.i18n?.en?.name || slug
          return { slug, name, key: normKey(name) }
        })
        .filter((w) => w.slug && w.key)

      weapons = rows
      weaponsFetchedAt = Date.now()
      try {
        fs.mkdirSync(cacheDir(), { recursive: true })
        fs.writeFileSync(
          weaponsCachePath(),
          JSON.stringify({ fetchedAt: weaponsFetchedAt, items: rows }),
          'utf8',
        )
      } catch {
        // ignore
      }
      return rows
    } catch (err) {
      console.warn('[Everything Warframe] Riven weapon list fetch failed', err)
      return weapons || []
    } finally {
      weaponsInflight = null
    }
  })()

  return weaponsInflight
}

/** Map OCR weapon title to a warframe.market riven weapon slug. */
export async function resolveRivenWeaponSlug(weaponName: string): Promise<string | null> {
  const list = await ensureWeapons()
  if (!list.length) return null
  const raw = weaponBaseName(weaponName)
  if (!raw || /^unknown/i.test(raw)) return null
  const key = normKey(raw)

  const exact = list.find((w) => w.key === key || w.slug.replace(/_/g, '') === key)
  if (exact) return exact.slug

  // Prefer longest name contained in OCR (or vice versa): "Kuva Bramma" over "Bramma"
  let best: WeaponRow | null = null
  for (const w of list) {
    if (key.includes(w.key) || w.key.includes(key)) {
      if (!best || w.key.length > best.key.length) best = w
    }
  }
  return best?.slug ?? null
}

function canonStatName(name: string): string {
  return name.trim().toLowerCase()
}

function attrSlugForStat(stat: RivenStatLine): string | null {
  const canon = canonStatName(stat.name)
  if (ATTR_BY_CANON[canon]) return ATTR_BY_CANON[canon]
  // UI may show title-cased names from OCR display
  for (const [k, slug] of Object.entries(ATTR_BY_CANON)) {
    if (canon === k || canon.replace(/\s+/g, ' ') === k) return slug
  }
  return null
}

function splitAttrs(stats: RivenStatLine[]): { positives: string[]; negatives: string[] } {
  const positives: string[] = []
  const negatives: string[] = []
  for (const s of stats) {
    const slug = attrSlugForStat(s)
    if (!slug) continue
    const isNeg = s.negative || s.value < 0
    if (isNeg) {
      if (!negatives.includes(slug)) negatives.push(slug)
    } else if (!positives.includes(slug)) {
      positives.push(slug)
    }
  }
  positives.sort()
  negatives.sort()
  return { positives, negatives }
}

type AuctionRow = {
  buyout_price?: number | null
  starting_price?: number | null
  is_direct_sell?: boolean
  closed?: boolean
  item?: {
    attributes?: Array<{ url_name?: string; positive?: boolean }>
  }
}

function auctionPrice(a: AuctionRow): number | null {
  const buy = a.buyout_price
  if (typeof buy === 'number' && buy > 0) return buy
  if (a.is_direct_sell && typeof a.starting_price === 'number' && a.starting_price > 0) {
    return a.starting_price
  }
  return null
}

function median(nums: number[]): number | null {
  if (!nums.length) return null
  const sorted = [...nums].sort((a, b) => a - b)
  return sorted[Math.floor(sorted.length / 2)]
}

function attrSets(a: AuctionRow): { pos: string[]; neg: string[] } {
  const pos: string[] = []
  const neg: string[] = []
  for (const attr of a.item?.attributes || []) {
    if (!attr.url_name) continue
    if (attr.positive === false) neg.push(attr.url_name)
    else pos.push(attr.url_name)
  }
  pos.sort()
  neg.sort()
  return { pos, neg }
}

function sameSet(a: string[], b: string[]) {
  return a.length === b.length && a.every((v, i) => v === b[i])
}

function includesAll(hay: string[], needles: string[]) {
  return needles.every((n) => hay.includes(n))
}

async function searchAuctions(params: {
  weaponSlug: string
  positives: string[]
  negatives: string[]
}): Promise<AuctionRow[]> {
  const qs = new URLSearchParams()
  qs.set('type', 'riven')
  qs.set('weapon_url_name', params.weaponSlug)
  qs.set('sort_by', 'price_asc')
  qs.set('operation', 'allOf')
  if (params.positives.length) qs.set('positive_stats', params.positives.join(','))
  if (params.negatives.length === 1) qs.set('negative_stats', params.negatives[0])

  const url = `https://api.warframe.market/v1/auctions/search?${qs.toString()}`
  const res = await fetch(url, { headers: headers() })
  if (!res.ok) return []
  const json = (await res.json()) as { payload?: { auctions?: AuctionRow[] } }
  return (json.payload?.auctions || []).filter((a) => !a.closed)
}

function scoreAuctions(
  auctions: AuctionRow[],
  positives: string[],
  negatives: string[],
): { prices: number[]; match: RivenMarketQuote['match'] } {
  const priced = auctions
    .map((a) => ({ a, price: auctionPrice(a), sets: attrSets(a) }))
    .filter((x): x is { a: AuctionRow; price: number; sets: { pos: string[]; neg: string[] } } =>
      x.price != null,
    )

  const exact = priced.filter(
    (x) => sameSet(x.sets.pos, positives) && (negatives.length ? sameSet(x.sets.neg, negatives) : true),
  )
  if (exact.length >= 2) {
    return { prices: exact.map((x) => x.price), match: 'exact' }
  }

  const tight = priced.filter(
    (x) =>
      includesAll(x.sets.pos, positives) &&
      x.sets.pos.length <= positives.length + 1 &&
      (negatives.length ? includesAll(x.sets.neg, negatives) : true),
  )
  if (tight.length >= 2) {
    return { prices: tight.map((x) => x.price), match: 'stats' }
  }

  const loose = priced.filter((x) => includesAll(x.sets.pos, positives))
  return { prices: loose.map((x) => x.price), match: 'loose' }
}

function cacheKey(weaponSlug: string, positives: string[], negatives: string[]) {
  return `${weaponSlug}|${positives.join(',')}|${negatives.join(',')}`
}

/**
 * Estimate median buyout platinum for a parsed riven roll.
 * Returns null when the weapon/stats can't be mapped or the market is empty.
 */
export async function lookupRivenMarketQuote(roll: RivenRoll): Promise<RivenMarketQuote | null> {
  if (!quotesDiskLoaded) {
    loadQuoteDisk()
    quotesDiskLoaded = true
  }

  const weaponSlug = await resolveRivenWeaponSlug(roll.weapon)
  if (!weaponSlug) return null

  const { positives, negatives } = splitAttrs(roll.stats)
  if (!positives.length) return null

  const key = cacheKey(weaponSlug, positives, negatives)
  const cached = quoteCache.get(key)
  if (cached && Date.now() - cached.fetchedAt < TTL_MS) return cached

  const attempts: Array<{ positives: string[]; negatives: string[] }> = [
    { positives, negatives: negatives.slice(0, 1) },
    { positives, negatives: [] },
  ]
  // If 3+ positives, also try top 2 by desirability/quality for liquidity.
  if (positives.length >= 3) {
    const ranked = [...roll.stats]
      .filter((s) => !s.negative && s.value >= 0)
      .sort((a, b) => b.quality - a.quality)
      .map((s) => attrSlugForStat(s))
      .filter((s): s is string => !!s)
    const top2 = [...new Set(ranked)].slice(0, 2).sort()
    if (top2.length === 2) attempts.push({ positives: top2, negatives: [] })
  }

  let best: RivenMarketQuote | null = null

  for (let i = 0; i < attempts.length; i++) {
    const attempt = attempts[i]
    try {
      const auctions = await searchAuctions({
        weaponSlug,
        positives: attempt.positives,
        negatives: attempt.negatives,
      })
      const { prices, match } = scoreAuctions(auctions, attempt.positives, attempt.negatives)
      const mid = median(prices)
      if (mid != null && prices.length >= 1) {
        const quote: RivenMarketQuote = {
          platinum: mid,
          volume: prices.length,
          match: attempt.positives.length < positives.length ? 'loose' : match,
          weaponSlug,
          fetchedAt: Date.now(),
        }
        // Prefer exact/stats with enough volume; accept first usable otherwise.
        if (!best || matchRank(quote) > matchRank(best)) best = quote
        if (quote.match === 'exact' && quote.volume >= 2) break
        if (quote.match === 'stats' && quote.volume >= 3) break
      }
    } catch (err) {
      console.warn('[Everything Warframe] Riven auction search failed', err)
    }
    if (i + 1 < attempts.length) {
      await new Promise((r) => setTimeout(r, 300))
    }
  }

  if (best) {
    quoteCache.set(key, best)
    saveQuoteDisk()
  }
  return best
}

function matchRank(q: RivenMarketQuote) {
  const m = q.match === 'exact' ? 3 : q.match === 'stats' ? 2 : 1
  return m * 1000 + Math.min(q.volume, 50)
}

/** Build a warframe.market auction search URL for a roll (best-effort). */
export function buildRivenMarketUrl(roll: RivenRoll, weaponSlug?: string | null): string | null {
  const slug = weaponSlug || null
  if (!slug && !roll.weapon) return null
  const { positives, negatives } = splitAttrs(roll.stats)
  const qs = new URLSearchParams()
  qs.set('type', 'riven')
  if (slug) qs.set('weapon_url_name', slug)
  if (positives.length) qs.set('positive_stats', positives.join(','))
  if (negatives.length === 1) qs.set('negative_stats', negatives[0])
  qs.set('polarity', 'any')
  qs.set('sort_by', 'price_asc')
  return `https://warframe.market/auctions/search?${qs.toString()}`
}

function withQuote(roll: RivenRoll, q: RivenMarketQuote | null): RivenRoll {
  const weaponSlug = q?.weaponSlug || null
  const marketUrl = buildRivenMarketUrl(roll, weaponSlug)
  if (!q) {
    return {
      ...roll,
      platinum: null,
      marketVolume: null,
      marketMatch: null,
      marketUrl,
    }
  }
  return {
    ...roll,
    platinum: q.platinum,
    marketVolume: q.volume,
    marketMatch: q.match,
    marketUrl: buildRivenMarketUrl(roll, q.weaponSlug),
  }
}

/** Attach market quotes to one or both rolls (parallel, best-effort). */
export async function enrichRivensWithMarket(
  current: RivenRoll | null,
  reroll: RivenRoll | null,
): Promise<{ current: RivenRoll | null; reroll: RivenRoll | null }> {
  const [cq, rq, cSlug, rSlug] = await Promise.all([
    current && isCompleteRiven(current) ? lookupRivenMarketQuote(current).catch(() => null) : Promise.resolve(null),
    reroll && isCompleteRiven(reroll) ? lookupRivenMarketQuote(reroll).catch(() => null) : Promise.resolve(null),
    current ? resolveRivenWeaponSlug(current.weapon).catch(() => null) : Promise.resolve(null),
    reroll ? resolveRivenWeaponSlug(reroll.weapon).catch(() => null) : Promise.resolve(null),
  ])
  const attach = (roll: RivenRoll, q: RivenMarketQuote | null, slug: string | null) => {
    const next = withQuote(roll, q)
    const marketUrl = buildRivenMarketUrl(next, q?.weaponSlug || slug)
    return { ...next, marketUrl }
  }
  return {
    current: current ? attach(current, cq, cSlug) : null,
    reroll: reroll ? attach(reroll, rq, rSlug) : null,
  }
}
