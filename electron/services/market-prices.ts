import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'

type PriceHit = { platinum: number; lowest: number; volume: number; fetchedAt: number }

const cache = new Map<string, PriceHit>()
const TTL_MS = 30 * 60_000
const MAX_CONCURRENT = 2

function cachePath() {
  return path.join(app.getPath('userData'), 'cache', 'market-prices.json')
}

function slugifyItemName(name: string): string {
  return name
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
}

function loadDiskCache() {
  try {
    const file = cachePath()
    if (!fs.existsSync(file)) return
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, PriceHit>
    for (const [k, v] of Object.entries(raw)) {
      if (v?.platinum != null) {
        cache.set(k, {
          platinum: v.platinum,
          lowest: typeof v.lowest === 'number' ? v.lowest : v.platinum,
          volume: v.volume || 0,
          fetchedAt: v.fetchedAt || 0,
        })
      }
    }
  } catch {
    // ignore
  }
}

function saveDiskCache() {
  try {
    fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
    const obj: Record<string, PriceHit> = {}
    for (const [k, v] of cache.entries()) obj[k] = v
    fs.writeFileSync(cachePath(), JSON.stringify(obj), 'utf8')
  } catch {
    // ignore
  }
}

let diskLoaded = false

async function fetchOne(name: string): Promise<PriceHit | null> {
  const slug = slugifyItemName(name)
  if (!slug || slug.includes('forma') || slug.includes('relic')) return null

  try {
    const res = await fetch(`https://api.warframe.market/v2/orders/item/${slug}`, {
      headers: {
        Accept: 'application/json',
        Platform: 'pc',
        Language: 'en',
        'User-Agent': 'EverythingWarframe/market',
      },
    })
    if (!res.ok) return null
    const json = (await res.json()) as {
      data?: Array<{ type?: string; platinum?: number; visible?: boolean }>
    }
    const sells = (json.data || [])
      .filter((o) => o.type === 'sell' && o.visible !== false && typeof o.platinum === 'number')
      .map((o) => o.platinum as number)
      .sort((a, b) => a - b)
    if (!sells.length) return null
    const mid = sells[Math.floor(sells.length / 2)]
    return { platinum: mid, lowest: sells[0], volume: sells.length, fetchedAt: Date.now() }
  } catch {
    return null
  }
}

/** Lookup median sell platinum for item display names (rate-limited + cached). */
export async function lookupMarketPrices(
  names: string[],
): Promise<Map<string, { platinum: number; volume: number; lowest: number }>> {
  if (!diskLoaded) {
    loadDiskCache()
    diskLoaded = true
  }

  const out = new Map<string, { platinum: number; volume: number; lowest: number }>()
  const unique = [...new Set(names.map((n) => n.trim()).filter(Boolean))]
  const missing: string[] = []

  for (const name of unique) {
    const hit = cache.get(slugifyItemName(name))
    if (hit && Date.now() - hit.fetchedAt < TTL_MS) {
      out.set(name, { platinum: hit.platinum, volume: hit.volume, lowest: hit.lowest })
    } else {
      missing.push(name)
    }
  }

  for (let i = 0; i < missing.length; i += MAX_CONCURRENT) {
    const batch = missing.slice(i, i + MAX_CONCURRENT)
    const results = await Promise.all(
      batch.map(async (name) => {
        const hit = await fetchOne(name)
        return { name, hit }
      }),
    )
    for (const { name, hit } of results) {
      if (!hit) continue
      cache.set(slugifyItemName(name), hit)
      out.set(name, { platinum: hit.platinum, volume: hit.volume, lowest: hit.lowest })
    }
    if (i + MAX_CONCURRENT < missing.length) {
      await new Promise((r) => setTimeout(r, 350))
    }
  }

  if (missing.length) saveDiskCache()
  return out
}

/** Suggest sell platinum: live floor − 1 (min 1). */
export async function suggestUndercutPrice(
  name: string,
): Promise<{ name: string; floor: number; median: number; suggest: number; volume: number } | null> {
  const trimmed = String(name || '').trim()
  if (!trimmed) return null
  const map = await lookupMarketPrices([trimmed])
  const hit = map.get(trimmed)
  if (!hit) return null
  const floor = hit.lowest || hit.platinum
  return {
    name: trimmed,
    floor,
    median: hit.platinum,
    suggest: Math.max(1, floor - 1),
    volume: hit.volume,
  }
}

type StatsPayload = {
  payload?: {
    statistics_closed?: {
      '48hours'?: Array<{
        datetime?: string
        avg_price?: number
        min_price?: number
        max_price?: number
        volume?: number
      }>
      '90days'?: Array<{
        datetime?: string
        avg_price?: number
        min_price?: number
        max_price?: number
        volume?: number
      }>
    }
  }
}

function mapStatsPoints(
  rows:
    | Array<{
        datetime?: string
        avg_price?: number
        min_price?: number
        max_price?: number
        volume?: number
      }>
    | undefined,
) {
  if (!rows?.length) return []
  return rows
    .map((r) => {
      const at = r.datetime ? Date.parse(r.datetime) : NaN
      if (Number.isNaN(at)) return null
      return {
        at,
        avg: Number(r.avg_price) || 0,
        min: Number(r.min_price) || 0,
        max: Number(r.max_price) || 0,
        volume: Number(r.volume) || 0,
      }
    })
    .filter((p): p is NonNullable<typeof p> => Boolean(p))
    .sort((a, b) => a.at - b.at)
}

/** Fetch warframe.market 48h / 90d closed-order statistics for charts. */
export async function getMarketPriceHistory(name: string): Promise<{
  name: string
  slug: string
  points48h: Array<{ at: number; avg: number; min: number; max: number; volume: number }>
  points90d: Array<{ at: number; avg: number; min: number; max: number; volume: number }>
  error: string | null
}> {
  const trimmed = String(name || '').trim()
  const slug = slugifyItemName(trimmed)
  if (!trimmed || !slug) {
    return { name: trimmed, slug: '', points48h: [], points90d: [], error: 'Missing item name' }
  }
  try {
    const res = await fetch(`https://api.warframe.market/v1/items/${slug}/statistics`, {
      headers: {
        Accept: 'application/json',
        Platform: 'pc',
        Language: 'en',
        'User-Agent': 'EverythingWarframe/market',
      },
    })
    if (!res.ok) {
      return {
        name: trimmed,
        slug,
        points48h: [],
        points90d: [],
        error: `Market stats HTTP ${res.status}`,
      }
    }
    const json = (await res.json()) as StatsPayload
    const closed = json.payload?.statistics_closed
    return {
      name: trimmed,
      slug,
      points48h: mapStatsPoints(closed?.['48hours']),
      points90d: mapStatsPoints(closed?.['90days']),
      error: null,
    }
  } catch (err) {
    return {
      name: trimmed,
      slug,
      points48h: [],
      points90d: [],
      error: err instanceof Error ? err.message : 'Market stats failed',
    }
  }
}
