import { rankCatalogMatch } from './catalog-match'
import fs from 'node:fs'
import https from 'node:https'
import path from 'node:path'
import { app } from 'electron'

export type CatalogItem = {
  name: string
  uniqueName: string
  setName: string | null
  partName: string | null
  ducats: number | null
  vaulted: boolean | null
  normalized: string
}

type CatalogCache = {
  version?: number
  fetchedAt: string
  items: CatalogItem[]
}

/** Bump when component display-name composition changes. */
const ITEM_CACHE_VERSION = 3

const WFCD_JSON = (file: string) =>
  `https://cdn.jsdelivr.net/gh/WFCD/warframe-items@master/data/json/${file}`

let catalog: CatalogItem[] = []
let bySet = new Map<string, CatalogItem[]>()
let byNormalized = new Map<string, CatalogItem>()
let byUnique = new Map<string, CatalogItem>()
let ready: Promise<void> | null = null

const PART_SUFFIXES = [
  'Neuroptics',
  'Chassis',
  'Systems',
  'Blueprint',
  'Barrel',
  'Receiver',
  'Stock',
  'Blade',
  'Handle',
  'Hilt',
  'Link',
  'Head',
  'Grip',
  'String',
  'Lower Limb',
  'Upper Limb',
  'Boot',
  'Gauntlet',
  'Ornament',
  'Cerebrum',
  'Carapace',
  'Pouch',
  'Stars',
  'Harness',
  'Wings',
  'Band',
  'Buckle',
  'Chain',
]

const SHORT_PART_NAMES = new Set(PART_SUFFIXES.map((s) => s.toUpperCase()))

function cachePath() {
  return path.join(app.getPath('userData'), 'cache', 'item-catalog.json')
}

export function normalizeItemName(name: string): string {
  return name
    .toUpperCase()
    // Common Warframe OCR / UI glitches before stripping punctuation
    .replace(/@/g, 'BL')
    .replace(/\bTEUROPTICS\b/g, 'NEUROPTICS')
    .replace(/\bNEUROPTICS?\b/g, 'NEUROPTICS')
    .replace(/\bCHASS[I1]S\b/g, 'CHASSIS')
    .replace(/\bSYSTE[MN]S\b/g, 'SYSTEMS')
    .replace(/\bBLUEPR[I1]NT\b/g, 'BLUEPRINT')
    .replace(/\bPR[I1]ME\b/g, 'PRIME')
    .replace(/['’]/g, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function parseSetAndPart(name: string): { setName: string | null; partName: string | null } {
  const trimmed = name.trim()
  if (!/prime/i.test(trimmed)) return { setName: null, partName: null }

  for (const suffix of PART_SUFFIXES) {
    const re = new RegExp(`^(.*\\bPrime)\\s+${suffix}$`, 'i')
    const m = trimmed.match(re)
    if (m) return { setName: m[1].trim(), partName: suffix }
  }

  // Full set item / blueprint-less prime weapon name
  if (/\bPrime$/i.test(trimmed)) {
    return { setName: trimmed, partName: 'Item' }
  }

  const primeIdx = trimmed.toLowerCase().indexOf('prime')
  if (primeIdx >= 0) {
    const setName = trimmed.slice(0, primeIdx + 5).trim()
    const partName = trimmed.slice(primeIdx + 5).trim() || 'Item'
    return { setName, partName }
  }

  return { setName: null, partName: null }
}

function httpsGetJson(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const get = (target: string, redirects = 0) => {
      https
        .get(target, { headers: { Accept: 'application/json', 'User-Agent': 'EverythingWarframe' } }, (res) => {
          if (
            res.statusCode &&
            res.statusCode >= 300 &&
            res.statusCode < 400 &&
            res.headers.location &&
            redirects < 5
          ) {
            res.resume()
            get(res.headers.location, redirects + 1)
            return
          }
          if (res.statusCode !== 200) {
            reject(new Error(`Catalog fetch failed (${res.statusCode})`))
            res.resume()
            return
          }
          const chunks: Buffer[] = []
          res.on('data', (c) => chunks.push(c))
          res.on('end', () => {
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')))
            } catch (err) {
              reject(err)
            }
          })
        })
        .on('error', reject)
    }
    get(url)
  })
}

function rebuildIndexes(items: CatalogItem[]) {
  catalog = items
  matchCache.clear()
  bySet = new Map()
  byNormalized = new Map()
  byUnique = new Map()
  for (const item of items) {
    byNormalized.set(item.normalized, item)
    if (item.uniqueName) {
      const prev = byUnique.get(item.uniqueName)
      // Prefer longer / more specific display names when several share a uniqueName.
      if (!prev || item.name.length > prev.name.length) {
        byUnique.set(item.uniqueName, item)
      }
      const leaf = item.uniqueName.split('/').pop()
      if (leaf && leaf !== item.uniqueName) {
        const prevLeaf = byUnique.get(leaf)
        if (!prevLeaf || item.name.length > prevLeaf.name.length) {
          byUnique.set(leaf, item)
        }
      }
    }
    if (!item.setName) continue
    const list = bySet.get(item.setName) || []
    list.push(item)
    bySet.set(item.setName, list)
  }
}

function loadCache(opts?: { ignoreVersion?: boolean }): boolean {
  try {
    const file = cachePath()
    if (!fs.existsSync(file)) return false
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as CatalogCache
    const age = Date.now() - new Date(parsed.fetchedAt).getTime()
    if (!parsed.items?.length) return false
    const versionOk = parsed.version === ITEM_CACHE_VERSION
    if (!opts?.ignoreVersion && !versionOk) return false
    // Migrate older caches missing vaulted
    for (const item of parsed.items) {
      if (item.vaulted === undefined) (item as CatalogItem).vaulted = null
    }
    rebuildIndexes(parsed.items)
    // Refresh in background when stale or still on an older schema
    if (!versionOk || age > 7 * 24 * 60 * 60 * 1000) {
      void fetchAndCache().catch(() => {})
    }
    return true
  } catch {
    return false
  }
}

async function fetchJsonArray(url: string): Promise<Array<Record<string, unknown>>> {
  try {
    const raw = await httpsGetJson(url)
    return Array.isArray(raw) ? (raw as Array<Record<string, unknown>>) : []
  } catch {
    return []
  }
}

/**
 * warframestat `/sentinels` is 404; companion primes (Carrier/Shade/…) live on WFCD CDN.
 * Also pull prime companion collars (Kavasa) from Skins — relic drops use short part names.
 */
async function fetchCompanionParents(): Promise<Array<Record<string, unknown>>> {
  const [sentinels, skins] = await Promise.all([
    fetchJsonArray(WFCD_JSON('Sentinels.json')),
    fetchJsonArray(WFCD_JSON('Skins.json')),
  ])
  const collarSkins = skins.filter((row) => {
    const name = String(row.name || '')
    const comps = row.components
    return (
      /prime/i.test(name) &&
      Array.isArray(comps) &&
      comps.length > 0 &&
      /collar|kubrow|kavat/i.test(name)
    )
  })
  return [...sentinels, ...collarSkins]
}

async function fetchAndCache(): Promise<void> {
  // Primed gear is enough for relic rewards; pull main equipment endpoints
  const [warframes, weapons, companions] = await Promise.all([
    fetchJsonArray('https://api.warframestat.us/warframes'),
    fetchJsonArray('https://api.warframestat.us/weapons'),
    fetchCompanionParents(),
  ])

  const parents = [...warframes, ...weapons, ...companions]
  const items: CatalogItem[] = []
  const seen = new Set<string>()

  const pushItem = (
    name: string,
    uniqueName: string,
    ducats: number | null,
    vaulted: boolean | null = null,
  ) => {
    const key = normalizeItemName(name)
    if (!key || seen.has(key)) return
    seen.add(key)
    const { setName, partName } = parseSetAndPart(name)
    items.push({
      name,
      uniqueName,
      setName,
      partName,
      ducats,
      vaulted,
      normalized: key,
    })
  }

  for (const parent of parents) {
    const parentName = String(parent.name || '')
    const parentUnique = String(parent.uniqueName || parentName)
    if (!parentName) continue
    const parentVaulted = typeof parent.vaulted === 'boolean' ? parent.vaulted : null
    const parentIsPrime = /prime/i.test(parentName)
    const primePrefix = parentName.match(/^(.*?\bPrime)\b/i)?.[1]?.trim() || null

    if (parentIsPrime) {
      pushItem(parentName, parentUnique, null, parentVaulted)
      // "Kavasa Prime Kubrow Collar" → also index set name "Kavasa Prime"
      if (primePrefix && normalizeItemName(primePrefix) !== normalizeItemName(parentName)) {
        pushItem(primePrefix, parentUnique, null, parentVaulted)
      }
    }

    const components = parent.components
    if (!Array.isArray(components)) continue
    for (const comp of components) {
      if (!comp || typeof comp !== 'object') continue
      const c = comp as Record<string, unknown>
      const cName = String(c.name || '').trim()
      if (!cName) continue
      const cUnique = String(c.uniqueName || `${parentUnique}:${cName}`)
      const ducats = typeof c.ducats === 'number' ? c.ducats : null
      const cVaulted = typeof c.vaulted === 'boolean' ? c.vaulted : parentVaulted

      // warframestat / WFCD use short part labels ("Barrel", "Cerebrum"); relic drops use
      // full names ("Akstiletto Prime Barrel", "Carrier Prime Cerebrum").
      let displayName = cName
      if (!/prime/i.test(cName) && parentIsPrime) {
        const isShortPart = SHORT_PART_NAMES.has(cName.toUpperCase())
        const isRecipePath = /\/(Recipes|WeaponParts)\//i.test(cUnique)
        if (!isShortPart && !isRecipePath) continue
        displayName = /^blueprint$/i.test(cName) ? `${parentName} Blueprint` : `${parentName} ${cName}`
      } else if (!/prime/i.test(cName)) {
        continue
      }

      pushItem(displayName, cUnique, ducats, cVaulted)

      // Collar parents are longer than relic labels: "Kavasa Prime Kubrow Collar" + Band
      // → also index "Kavasa Prime Band".
      if (
        primePrefix &&
        !/^blueprint$/i.test(cName) &&
        normalizeItemName(`${primePrefix} ${cName}`) !== normalizeItemName(displayName)
      ) {
        pushItem(`${primePrefix} ${cName}`, cUnique, ducats, cVaulted)
      }
      if (
        primePrefix &&
        /^blueprint$/i.test(cName) &&
        normalizeItemName(`${primePrefix} Blueprint`) !== normalizeItemName(displayName)
      ) {
        pushItem(`${primePrefix} Blueprint`, cUnique, ducats, cVaulted)
      }

      // Relic tables often append "Blueprint" to warframe/sentinel Systems (and similar).
      if (
        parentIsPrime &&
        !/\bblueprint\b/i.test(displayName) &&
        /(Neuroptics|Chassis|Systems|Cerebrum|Carapace)$/i.test(displayName)
      ) {
        pushItem(`${displayName} Blueprint`, cUnique, ducats, cVaulted)
      }
    }
  }

  // Common non-prime relic rewards (Forma OCR often drops "Blueprint")
  for (const extra of [
    'Forma Blueprint',
    'Forma',
    'Orokin Catalyst Blueprint',
    'Orokin Reactor Blueprint',
  ]) {
    pushItem(extra, extra, null, false)
  }

  rebuildIndexes(items)
  fs.mkdirSync(path.dirname(cachePath()), { recursive: true })
  const payload: CatalogCache = {
    version: ITEM_CACHE_VERSION,
    fetchedAt: new Date().toISOString(),
    items,
  }
  fs.writeFileSync(cachePath(), JSON.stringify(payload), 'utf8')
  console.info(`[Everything Warframe] Item catalog ready (${items.length} entries)`)
}

export function ensureItemCatalog(): Promise<void> {
  if (!ready) {
    ready = (async () => {
      if (loadCache()) return
      try {
        await fetchAndCache()
      } catch (err) {
        // Prefer a stale/pre-0.9.34 cache over failing every relic scan for the session.
        if (loadCache({ ignoreVersion: true })) {
          console.warn(
            '[Everything Warframe] Item catalog fetch failed; using on-disk cache until next retry',
            err instanceof Error ? err.message : err,
          )
          return
        }
        throw err
      }
    })().catch((err) => {
      // Allow a later scan / planner open to retry after a network failure.
      ready = null
      throw err
    })
  }
  return ready
}

/** True when the in-memory item catalog maps are populated. */
export function isItemCatalogReady(): boolean {
  return byUnique.size > 0
}

/** Cached, ambiguity-aware match against the loaded reward vocabulary. */
const matchCache = new Map<string, { item: CatalogItem; score: number } | null>()
export function matchCatalogItem(ocrText: string): { item: CatalogItem; score: number } | null {
  const needle = normalizeItemName(ocrText)
  if (needle.length < 3) return null
  const exact = byNormalized.get(needle)
  if (exact) return { item: exact, score: 1 }
  if (matchCache.has(needle)) return matchCache.get(needle)!
  const result = rankCatalogMatch(needle, catalog)
  if (matchCache.size >= 256) matchCache.delete(matchCache.keys().next().value!)
  matchCache.set(needle, result)
  return result
}

export function getSetParts(setName: string | null): CatalogItem[] {
  if (!setName) return []
  return bySet.get(setName) || []
}

/** Exact (normalized) name lookup, with/without trailing Blueprint. */
export function findCatalogItemByName(name: string): CatalogItem | null {
  const needle = normalizeItemName(name)
  if (!needle) return null
  const direct = byNormalized.get(needle)
  if (direct) return direct
  if (/\bBLUEPRINT\b/.test(needle)) {
    return byNormalized.get(normalizeItemName(name.replace(/\s+Blueprint$/i, ''))) || null
  }
  return byNormalized.get(normalizeItemName(`${name} Blueprint`)) || null
}

/** Lookup by DE uniqueName path (and common Blueprint/Component aliases). */
export function findCatalogItemByUnique(uniqueName: string): CatalogItem | null {
  if (!uniqueName) return null
  const candidates = [uniqueName]
  const leaf = uniqueName.split('/').pop()
  if (leaf && leaf !== uniqueName) candidates.push(leaf)
  if (/Blueprint$/i.test(uniqueName)) {
    candidates.push(uniqueName.replace(/Blueprint$/i, 'Component'))
    candidates.push(uniqueName.replace(/Blueprint$/i, ''))
  } else if (/Component$/i.test(uniqueName)) {
    candidates.push(uniqueName.replace(/Component$/i, 'Blueprint'))
  } else if (/\/(Recipes|WeaponParts)\//i.test(uniqueName)) {
    candidates.push(`${uniqueName}Blueprint`)
  }
  for (const cand of candidates) {
    const hit = byUnique.get(cand)
    if (hit) return hit
    const leafCand = cand.split('/').pop()
    if (leafCand && leafCand !== cand) {
      const leafHit = byUnique.get(leafCand)
      if (leafHit) return leafHit
    }
  }
  return null
}
