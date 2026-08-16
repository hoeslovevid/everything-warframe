import crypto from 'node:crypto'
import fs from 'node:fs'
import https from 'node:https'
import os from 'node:os'
import path from 'node:path'
import { execFileSync, spawn, type ChildProcess } from 'node:child_process'
import { app } from 'electron'
import {
  InventoryCandidate,
  InventoryIndex,
  InventorySource,
  InventoryStatus,
  InventorySyncResult,
  MasteryEntry,
  MasteryIndex,
} from '../../shared/types'
import { loadSettings, updateSettings } from '../settings'
import {
  findWarframeWineLauncher,
  isProtonPlayAvailable,
  WARFRAME_STEAM_APP_ID,
  warframeCompatDataDir,
  warframeProtonLocalAppData,
  warframeProtonPrefix,
  warframeSteamClientRoot,
} from './steam-paths'
import { isWarframeRunning as isWarframeProcessRunning, isWarframeGameRunningSync, invalidateWarframeProcessCache } from './warframe-process'
import { buildWineHelperEnv, scrubWineHelperOutput } from '../linux-child-env'
import { getRecipeByUnique } from './recipe-catalog'
import { findCatalogItemByName, findCatalogItemByUnique } from './item-catalog'
import { lookupWfinfoPlatinum } from './wfinfo-prices'
import { recordInventoryHaul } from './session-haul'

const HELPER_URL =
  'https://github.com/Sainan/warframe-api-helper/releases/download/1.1.2/warframe-api-helper.exe'

/** Same AES key/IV AlecaFrame / warframe-api-helper use for lastData.dat */
const ALECA_KEY = Buffer.from([76, 69, 79, 45, 65, 76, 69, 67, 9, 69, 79, 45, 65, 76, 69, 67])
const ALECA_IV = Buffer.from([49, 50, 70, 71, 66, 51, 54, 45, 76, 69, 51, 45, 113, 61, 57, 0])

const INVENTORY_ARRAY_KEYS = [
  'Suits',
  'Pistols',
  'LongGuns',
  'Melee',
  'SpaceSuits',
  'SpaceGuns',
  'SpaceMelee',
  'Sentinels',
  'SentinelWeapons',
  'KubrowPets',
  'Cats',
  'MoaPets',
  'Horses',
  'SpecialItems',
  'MiscItems',
  'Recipes',
  'Consumables',
  'FlavourItems',
  'ShipDecorations',
  'FusionTreasures',
  'Upgrades',
  'WeaponSkins',
  'OperatorAmps',
  'MechSuits',
  'Relics',
]

const GEAR_MASTERY_KEYS = new Set([
  'Suits',
  'Pistols',
  'LongGuns',
  'Melee',
  'SpaceSuits',
  'SpaceGuns',
  'SpaceMelee',
  'Sentinels',
  'SentinelWeapons',
  'KubrowPets',
  'Cats',
  'MoaPets',
  'Horses',
  'SpecialItems',
  'OperatorAmps',
  'MechSuits',
])

const MAX_RANK = 30

let cachedIndex: InventoryIndex = {}
let cachedMastery: MasteryIndex = {}
let cachedGearCategory: Record<string, import('../../shared/types').LoadoutCategory> = {}
let cachedPlayerLevel: number | null = null
let cachedMeta = { path: '', itemCount: 0, uniqueCount: 0 }
/** Monotonic — Foundry / other UIs refresh when this changes. */
let inventoryRevision = 0
let lastInventoryDiff: import('../../shared/types').InventoryDiff | null = null
const listeners = new Set<(status: InventoryStatus) => void>()

export type InventorySyncProgress = {
  stage: 'checking' | 'helper' | 'launching' | 'waiting' | 'parsing' | 'done' | 'error'
  message: string
}

const progressListeners = new Set<(p: InventorySyncProgress) => void>()

export function onInventorySyncProgress(cb: (p: InventorySyncProgress) => void) {
  progressListeners.add(cb)
  return () => {
    progressListeners.delete(cb)
  }
}

function emitSyncProgress(
  stage: InventorySyncProgress['stage'],
  message: string,
) {
  const payload = { stage, message }
  for (const cb of progressListeners) {
    try {
      cb(payload)
    } catch {
      // ignore listener errors
    }
  }
}

function toolsDir() {
  return path.join(app.getPath('userData'), 'tools')
}

function inventoryWorkDir() {
  return path.join(app.getPath('userData'), 'inventory')
}

function helperExePath() {
  return path.join(toolsDir(), 'warframe-api-helper.exe')
}

function managedInventoryPath() {
  return path.join(inventoryWorkDir(), 'inventory.json')
}

export function isWarframeRunning(): boolean {
  return isWarframeGameRunningSync()
}

function fileMtimeIso(filePath: string): string {
  try {
    return fs.statSync(filePath).mtime.toISOString()
  } catch {
    return ''
  }
}

function pushCandidate(
  list: InventoryCandidate[],
  filePath: string,
  label: string,
  source: InventorySource,
) {
  if (!filePath || !fs.existsSync(filePath)) return
  if (list.some((c) => c.path.toLowerCase() === filePath.toLowerCase())) return
  list.push({
    path: filePath,
    label,
    source,
    mtime: fileMtimeIso(filePath),
  })
}

function walkForName(root: string, name: string, maxDepth = 3, out: string[] = [], depth = 0) {
  if (depth > maxDepth || out.length >= 8) return out
  let entries: fs.Dirent[]
  try {
    entries = fs.readdirSync(root, { withFileTypes: true })
  } catch {
    return out
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name)
    if (entry.isFile() && entry.name.toLowerCase() === name.toLowerCase()) {
      out.push(full)
    } else if (entry.isDirectory() && !entry.name.startsWith('.')) {
      walkForName(full, name, maxDepth, out, depth + 1)
    }
  }
  return out
}

export function detectInventoryCandidates(): InventoryCandidate[] {
  const home = os.homedir()
  const local = process.env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
  const roaming = process.env.APPDATA || path.join(home, 'AppData', 'Roaming')
  const downloads = path.join(home, 'Downloads')
  const desktop = path.join(home, 'Desktop')
  const list: InventoryCandidate[] = []

  pushCandidate(list, managedInventoryPath(), 'Everything Warframe synced inventory', 'helper')
  pushCandidate(list, path.join(inventoryWorkDir(), 'inventory.json'), 'Everything Warframe inventory folder', 'helper')
  pushCandidate(list, path.join(toolsDir(), 'inventory.json'), 'Helper tools folder', 'helper')
  pushCandidate(list, path.join(downloads, 'inventory.json'), 'Downloads/inventory.json', 'detected')
  pushCandidate(list, path.join(desktop, 'inventory.json'), 'Desktop/inventory.json', 'detected')
  pushCandidate(list, path.join(process.cwd(), 'inventory.json'), 'Current folder inventory.json', 'detected')

  const alecaPaths = [
    path.join(local, 'AlecaFrame', 'lastData.dat'),
    path.join(roaming, 'AlecaFrame', 'lastData.dat'),
    path.join(local, 'Overwolf', 'Extensions'),
  ]

  // Proton: look inside Warframe's Wine prefix for Windows-side exports
  const protonLocal = warframeProtonLocalAppData()
  if (protonLocal) {
    alecaPaths.push(path.join(protonLocal, 'AlecaFrame', 'lastData.dat'))
    pushCandidate(
      list,
      path.join(protonLocal, 'inventory.json'),
      'Proton prefix inventory.json',
      'detected',
    )
  }

  for (const p of alecaPaths) {
    if (p.endsWith('lastData.dat')) {
      pushCandidate(list, p, 'AlecaFrame lastData.dat', 'alecaframe')
    } else if (fs.existsSync(p)) {
      for (const found of walkForName(p, 'lastData.dat', 4)) {
        pushCandidate(list, found, 'AlecaFrame / Overwolf lastData.dat', 'alecaframe')
      }
    }
  }

  for (const found of walkForName(downloads, 'inventory.json', 2)) {
    pushCandidate(list, found, 'Downloads inventory.json', 'detected')
  }

  list.sort((a, b) => (b.mtime || '').localeCompare(a.mtime || ''))
  return list
}

function addCount(index: InventoryIndex, key: string, count: number) {
  if (!key || count <= 0) return
  index[key] = (index[key] || 0) + count
  // Also index basename for fuzzy matching later
  const base = key.split('/').pop()
  if (base && base !== key) index[base] = (index[base] || 0) + count

  // Catalogs (warframestat / foundry) often use *Component or omit Blueprint,
  // while the live inventory API stores those stacks as *Blueprint.
  for (const alias of inventoryKeyAliases(key)) {
    index[alias] = (index[alias] || 0) + count
    const aliasBase = alias.split('/').pop()
    if (aliasBase && aliasBase !== alias) {
      index[aliasBase] = (index[aliasBase] || 0) + count
    }
  }
}

/**
 * Map inventory ItemType paths onto the names foundry/relic catalogs query.
 * Inventory:  .../EmberPrimeChassisBlueprint (ItemCount 40)
 * Catalog:    .../EmberPrimeChassisComponent
 * Inventory:  .../BratonPrimeBarrelBlueprint
 * Catalog:    .../BratonPrimeBarrel
 *
 * Note: we intentionally do NOT index warframe *Blueprint → *Component here.
 * Uncrafted part BPs must not satisfy Foundry “built component” checks; that
 * bridge lives in ownedCountFor (non-strict) for relic/set ownership only.
 */
export function inventoryKeyAliases(key: string): string[] {
  if (!key || !/Blueprint$/i.test(key)) return []
  const withoutBp = key.replace(/Blueprint$/i, '')
  const leaf = withoutBp.split('/').pop() || ''
  const aliases: string[] = []

  // Weapon / pet / archwing parts: catalog uniqueName usually has no Blueprint suffix
  if (
    /(Barrel|Receiver|Stock|Blade|Handle|Hilt|Link|Head|Grip|String|Boot|Gauntlet|Cerebrum|Carapace|Harness|Wings|Pouch|Stars|Ornament|Limb)$/i.test(
      leaf,
    )
  ) {
    aliases.push(withoutBp)
  }

  return [...new Set(aliases)]
}

function readStackCount(row: Record<string, unknown>): number {
  const raw =
    row.ItemCount ?? row.Count ?? row.Quantity ?? row.quantity ?? row.itemCount ?? row.count
  if (raw == null || raw === '') return 1
  const n = typeof raw === 'number' ? raw : Number(String(raw).replace(/,/g, '').trim())
  if (!Number.isFinite(n) || n <= 0) return 1
  return Math.floor(n)
}

function setMastery(
  mastery: MasteryIndex,
  key: string,
  ownedDelta: number,
  xpLevel: number | null,
  hasXpSignal: boolean,
  formaCount: number | null = null,
) {
  if (!key) return
  const apply = (k: string) => {
    const prev = mastery[k] || { owned: 0, xpLevel: null, mastered: null, formaCount: null }
    const nextOwned = prev.owned + ownedDelta
    let nextLevel = prev.xpLevel
    if (xpLevel != null) {
      nextLevel = prev.xpLevel == null ? xpLevel : Math.max(prev.xpLevel, xpLevel)
    }
    let mastered: boolean | null = prev.mastered
    if (hasXpSignal && nextLevel != null) {
      mastered = nextLevel >= MAX_RANK
    } else if (hasXpSignal && mastered == null) {
      mastered = false
    }
    let nextForma = prev.formaCount
    if (formaCount != null) {
      nextForma = prev.formaCount == null ? formaCount : Math.max(prev.formaCount, formaCount)
    }
    mastery[k] = { owned: nextOwned, xpLevel: nextLevel, mastered, formaCount: nextForma }
  }
  apply(key)
  const base = key.split('/').pop()
  if (base && base !== key) apply(base)
}

function readFormaCount(row: Record<string, unknown>): number | null {
  const polar = row.Polarity ?? row.Polarities
  if (Array.isArray(polar)) return polar.length
  if (typeof row.FormaCount === 'number' && Number.isFinite(row.FormaCount)) {
    return Math.max(0, Math.floor(row.FormaCount))
  }
  return null
}

function gearCategoryForInventoryKey(key: string): import('../../shared/types').LoadoutCategory {
  if (key === 'Suits') return 'warframe'
  if (key === 'LongGuns') return 'primary'
  if (key === 'Pistols') return 'secondary'
  if (key === 'Melee') return 'melee'
  if (key === 'SpaceSuits' || key === 'SpaceMelee' || key === 'SpaceGuns') return 'archwing'
  if (key === 'Sentinels' || key === 'SentinelWeapons' || key === 'KubrowPets' || key === 'Cats')
    return 'companion'
  if (key === 'MechSuits') return 'other'
  return 'other'
}

function readXpLevel(row: Record<string, unknown>): { level: number | null; hasSignal: boolean } {
  if (typeof row.XPLevel === 'number' && Number.isFinite(row.XPLevel)) {
    return { level: row.XPLevel, hasSignal: true }
  }
  if (typeof row.Level === 'number' && Number.isFinite(row.Level)) {
    return { level: row.Level, hasSignal: true }
  }
  if (typeof row.Rank === 'number' && Number.isFinite(row.Rank)) {
    return { level: row.Rank, hasSignal: true }
  }
  // Affinity-only rows: treat as owned with unknown mastery unless clearly maxed via huge XP
  if (typeof row.XP === 'number' && Number.isFinite(row.XP)) {
    // Rank 30 affinity thresholds vary; ~1.6M+ is a common warframe max ballpark
    if (row.XP >= 1_600_000) return { level: MAX_RANK, hasSignal: true }
    return { level: null, hasSignal: true }
  }
  return { level: null, hasSignal: false }
}

export function parseInventoryJson(raw: unknown): {
  index: InventoryIndex
  mastery: MasteryIndex
  gearCategory: Record<string, import('../../shared/types').LoadoutCategory>
  playerLevel: number | null
  itemCount: number
} {
  const index: InventoryIndex = {}
  const mastery: MasteryIndex = {}
  const gearCategory: Record<string, import('../../shared/types').LoadoutCategory> = {}
  let playerLevel: number | null = null
  let itemCount = 0
  if (!raw || typeof raw !== 'object') {
    return { index, mastery, gearCategory, playerLevel, itemCount }
  }

  const root = raw as Record<string, unknown>

  if (typeof root.PlayerLevel === 'number' && Number.isFinite(root.PlayerLevel)) {
    playerLevel = Math.max(0, Math.floor(root.PlayerLevel))
  } else if (typeof root.AccountLevel === 'number' && Number.isFinite(root.AccountLevel)) {
    playerLevel = Math.max(0, Math.floor(root.AccountLevel))
  }

  for (const key of INVENTORY_ARRAY_KEYS) {
    const arr = root[key]
    if (!Array.isArray(arr)) continue
    for (const entry of arr) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      const type = String(row.ItemType || row.uniqueName || row.ItemName || '')
      const count = readStackCount(row)
      if (!type) continue
      addCount(index, type, count)
      itemCount += count
      if (GEAR_MASTERY_KEYS.has(key)) {
        const { level, hasSignal } = readXpLevel(row)
        const forma = readFormaCount(row)
        setMastery(mastery, type, count, level, hasSignal, forma)
        const cat = gearCategoryForInventoryKey(key)
        gearCategory[type] = cat
        const base = type.split('/').pop()
        if (base) gearCategory[base] = cat
      }
    }
  }

  // XPInfo often lists mastered / leveled gear even if not currently owned
  const xpInfo = root.XPInfo
  if (Array.isArray(xpInfo)) {
    for (const entry of xpInfo) {
      if (!entry || typeof entry !== 'object') continue
      const row = entry as Record<string, unknown>
      const type = String(row.ItemType || row.uniqueName || '')
      if (!type) continue
      const { level, hasSignal } = readXpLevel(row)
      const prev = mastery[type]
      if (!prev) {
        setMastery(mastery, type, 0, level, hasSignal || level != null)
      } else if (hasSignal || level != null) {
        setMastery(mastery, type, 0, level, true)
      }
    }
  }

  // Player currencies (Baro affordability)
  if (typeof root.RegularCredits === 'number' && Number.isFinite(root.RegularCredits)) {
    index.RegularCredits = Math.max(0, Math.floor(root.RegularCredits))
  }
  if (typeof root.PremiumCredits === 'number' && Number.isFinite(root.PremiumCredits)) {
    index.PremiumCredits = Math.max(0, Math.floor(root.PremiumCredits))
  }
  // Ducats often live in MiscItems as *DucatCurrency*
  for (const key of Object.keys(index)) {
    if (/ducatcurrency/i.test(key) || /\/ducats?$/i.test(key)) {
      index.Ducats = (index.Ducats || 0) + index[key]
    }
  }
  if (typeof root.TradeScore === 'number' && Number.isFinite(root.TradeScore) && !index.Ducats) {
    index.Ducats = Math.max(0, Math.floor(root.TradeScore))
  }

  // Some exports nest under Inventory
  if (itemCount === 0 && root.Inventory && typeof root.Inventory === 'object') {
    return parseInventoryJson(root.Inventory)
  }

  return { index, mastery, gearCategory, playerLevel, itemCount }
}

export function decryptAlecaFrameDat(filePath: string): unknown {
  const encrypted = fs.readFileSync(filePath)
  const decipher = crypto.createDecipheriv('aes-128-cbc', ALECA_KEY, ALECA_IV)
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()])
  // strip PKCS7 padding leftovers if JSON has trailing junk
  const text = decrypted.toString('utf8').replace(/\0+$/g, '').trim()
  const start = text.indexOf('{')
  const end = text.lastIndexOf('}')
  if (start < 0 || end < 0) throw new Error('Decrypted AlecaFrame data is not JSON')
  return JSON.parse(text.slice(start, end + 1))
}

function loadJsonFile(filePath: string): unknown {
  if (filePath.toLowerCase().endsWith('.dat')) {
    return decryptAlecaFrameDat(filePath)
  }
  return JSON.parse(fs.readFileSync(filePath, 'utf8'))
}

export function loadInventoryFromPath(filePath: string): {
  index: InventoryIndex
  mastery: MasteryIndex
  gearCategory: Record<string, import('../../shared/types').LoadoutCategory>
  playerLevel: number | null
  itemCount: number
  uniqueCount: number
} {
  const raw = loadJsonFile(filePath)
  const { index, mastery, gearCategory, playerLevel, itemCount } = parseInventoryJson(raw)
  return {
    index,
    mastery,
    gearCategory,
    playerLevel,
    itemCount,
    uniqueCount: Object.keys(index).length,
  }
}

export function getInventoryIndex(): InventoryIndex {
  return { ...cachedIndex }
}

export function getMasteryIndex(): MasteryIndex {
  return { ...cachedMastery }
}

export function getGearCategoryIndex(): Record<
  string,
  import('../../shared/types').LoadoutCategory
> {
  return { ...cachedGearCategory }
}

export function getPlayerLevel(): number | null {
  return cachedPlayerLevel
}

/** Live refs for main-process services — do not mutate. */
export function peekInventoryIndex(): InventoryIndex {
  return cachedIndex
}

export function peekMasteryIndex(): MasteryIndex {
  return cachedMastery
}

/** WFCD sometimes appends revision suffixes (BlueprintV2). */
function stripRevisionSuffix(uniqueName: string): string | null {
  const stripped = uniqueName.replace(/V\d+$/i, '')
  return stripped !== uniqueName ? stripped : null
}

/** Compact token for ownership compares (Neuroptics ≡ Helmet; ignore Blueprint/Component). */
function compactOwnedToken(name: string): string {
  return name
    .toUpperCase()
    .replace(/['’]/g, '')
    .replace(/NEUROPTICS/g, 'HELMET')
    .replace(/[^A-Z0-9]+/g, '')
    .replace(/(BLUEPRINT|COMPONENT)$/g, '')
}

const PART_OR_BLUEPRINT_RE =
  /\b(blueprint|neuroptics|chassis|systems|barrel|receiver|stock|blade|handle|hilt|link|head|grip|string|boot|gauntlet|cerebrum|carapace|harness|wings|pouch|stars|ornament|limb|band|buckle|chain)\b/i

/** Finished warframe/weapon paths — not recipe stacks from relic rewards. */
function isFinishedGearUniqueName(uniqueName: string): boolean {
  if (/\/(Recipes|WeaponParts)\//i.test(uniqueName)) return false
  return /\/Lotus\/(Powersuits|Weapons)\//i.test(uniqueName)
}

export function ownedCountFor(
  uniqueName: string,
  index: InventoryIndex = cachedIndex,
  opts?: { strict?: boolean },
): number {
  if (!uniqueName) return 0
  // Relic reward rows in WFCD Relics.json currently misuse Projection IDs as item
  // uniqueNames — never treat those as owned part stacks.
  if (/\/Projections\//i.test(uniqueName) || /VoidProjection/i.test(uniqueName)) return 0

  const strict = opts?.strict === true
  const candidates = [uniqueName]
  const noRev = stripRevisionSuffix(uniqueName)
  if (noRev) candidates.push(noRev)

  for (const cand of candidates) {
    const direct = lookupCount(cand, index)
    if (direct > 0) return direct

    if (strict) continue

    // Catalog *Component → inventory *Blueprint (parts / Foundry materials / relic ownership).
    if (/Component$/i.test(cand)) {
      const asBp = cand.replace(/Component$/i, 'Blueprint')
      const n = lookupCount(asBp, index)
      if (n > 0) return n
    }

    // Catalog path without Blueprint → inventory *Blueprint
    if (!/Blueprint$/i.test(cand) && /\/(Recipes|WeaponParts)\//i.test(cand)) {
      const n = lookupCount(`${cand}Blueprint`, index)
      if (n > 0) return n
    }
  }

  return 0
}

/** Strict lookup: exact path / basename only (no Blueprint↔Component bridging). */
export function ownedCountForCraft(
  uniqueName: string,
  index: InventoryIndex = cachedIndex,
): number {
  return ownedCountFor(uniqueName, index, { strict: true })
}

/**
 * Ownership by display name when uniqueName is missing or unreliable.
 * Exact token match only — never treat "Trinity Prime" as owning
 * "Trinity Prime Systems Blueprint".
 */
export function ownedCountByDisplayName(
  displayName: string,
  index: InventoryIndex = cachedIndex,
): number {
  const needle = compactOwnedToken(displayName)
  if (!needle || needle.length < 4) return 0
  const wantsBlueprint = /\bBLUEPRINT\b/i.test(displayName)
  const hasPartWord = PART_OR_BLUEPRINT_RE.test(displayName)

  let best = 0
  let bestKeyLen = 0
  for (const [key, count] of Object.entries(index)) {
    if (!count) continue
    // Basename keys only (full paths are duplicated via addCount and skew "longest wins")
    if (key.includes('/')) continue
    if (key === 'RegularCredits' || key === 'Ducats' || key === 'PremiumCredits') continue
    if (/VoidProjection/i.test(key) || /^T[1-4]VoidProjection/i.test(key)) continue

    const token = compactOwnedToken(key)
    if (!token || token !== needle) continue

    const keyIsRecipe = /Blueprint$/i.test(key) || /Component$/i.test(key)
    // "X Prime Blueprint" must not match the crafted "XPrime" suit/weapon row.
    if (wantsBlueprint && !keyIsRecipe) continue
    // Bare set name ("Banshee Prime") should not consume recipe blueprint stacks.
    if (!hasPartWord && keyIsRecipe) continue

    if (key.length >= bestKeyLen) {
      bestKeyLen = key.length
      best = count
    }
  }
  return best
}

export function ownedCountForReward(
  uniqueName: string | null | undefined,
  displayName: string,
  index: InventoryIndex = cachedIndex,
): number {
  if (uniqueName) {
    const skipFinished =
      Boolean(displayName) &&
      PART_OR_BLUEPRINT_RE.test(displayName) &&
      isFinishedGearUniqueName(uniqueName)
    if (!skipFinished) {
      const byUnique = ownedCountFor(uniqueName, index)
      if (byUnique > 0) return byUnique
    }
  }
  if (displayName) return ownedCountByDisplayName(displayName, index)
  return 0
}

function lookupCount(uniqueName: string, index: InventoryIndex): number {
  if (index[uniqueName] != null) return index[uniqueName]
  const base = uniqueName.split('/').pop()
  if (base && index[base] != null) return index[base]
  return 0
}

export function masteryFor(uniqueName: string): MasteryEntry | null {
  if (!uniqueName) return null
  return (
    cachedMastery[uniqueName] ||
    cachedMastery[uniqueName.split('/').pop() || ''] ||
    null
  )
}

function downloadFile(url: string, dest: string): Promise<void> {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(dest), { recursive: true })
    const file = fs.createWriteStream(dest)
    const get = (target: string, redirects = 0) => {
      https
        .get(target, { headers: { 'User-Agent': 'EverythingWarframe' } }, (res) => {
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
            file.close()
            fs.unlink(dest, () => {})
            reject(new Error(`Download failed (${res.statusCode})`))
            return
          }
          res.pipe(file)
          file.on('finish', () => file.close(() => resolve()))
        })
        .on('error', (err) => {
          file.close()
          fs.unlink(dest, () => {})
          reject(err)
        })
    }
    get(url)
  })
}

export async function ensureHelperDownloaded(): Promise<string> {
  const exe = helperExePath()
  if (fs.existsSync(exe) && fs.statSync(exe).size > 100_000) return exe
  await downloadFile(HELPER_URL, exe)
  return exe
}

export function helperIsReady(): boolean {
  try {
    return fs.existsSync(helperExePath()) && fs.statSync(helperExePath()).size > 100_000
  } catch {
    return false
  }
}

export function inferInventorySource(filePath: string): InventorySource {
  const lower = filePath.toLowerCase()
  if (lower.endsWith('.dat')) return 'alecaframe'
  const managed = managedInventoryPath().toLowerCase()
  if (lower === managed || lower.startsWith(inventoryWorkDir().toLowerCase())) return 'helper'
  return 'detected'
}

async function waitForNewFile(
  filePath: string,
  notBeforeMs: number,
  timeoutMs: number,
  abortWhen?: Promise<unknown>,
): Promise<boolean> {
  const start = Date.now()
  let aborted = false
  if (abortWhen) {
    void abortWhen.then(() => {
      aborted = true
    })
  }
  while (Date.now() - start < timeoutMs) {
    if (fs.existsSync(filePath)) {
      try {
        const st = fs.statSync(filePath)
        // Ignore a leftover file from a previous sync (common under Wine/Proton).
        if (st.size > 100 && st.mtimeMs >= notBeforeMs - 500) {
          await new Promise((r) => setTimeout(r, 400))
          return true
        }
      } catch {
        // retry
      }
    }
    // Helper already exited without writing inventory.json — fail fast.
    if (aborted) {
      await new Promise((r) => setTimeout(r, 300))
      if (fs.existsSync(filePath)) {
        try {
          const st = fs.statSync(filePath)
          if (st.size > 100 && st.mtimeMs >= notBeforeMs - 500) return true
        } catch {
          // fall through
        }
      }
      return false
    }
    await new Promise((r) => setTimeout(r, 400))
  }
  return false
}

/** Prevent overlapping syncs from stacking Wine/Proton helpers. */
let syncInFlight: Promise<InventorySyncResult> | null = null
let activeHelper: ChildProcess | null = null

export function isInventorySyncInFlight(): boolean {
  return syncInFlight != null
}

/** Avoid ERR_STREAM_WRITE_AFTER_END — write() errors are async EventEmitter events. */
function safeStdinWrite(
  stdin: NodeJS.WritableStream | null | undefined,
  data: string,
  end = false,
) {
  if (!stdin) return
  const stream = stdin as NodeJS.WriteStream & {
    destroyed?: boolean
    writableEnded?: boolean
    _ewSafeHook?: boolean
  }
  if (stream.destroyed || stream.writableEnded || stream.writable === false) return
  if (!stream._ewSafeHook) {
    stream._ewSafeHook = true
    stream.on('error', () => {
      /* swallow closed-pipe noise so it cannot crash Electron */
    })
  }
  try {
    if (data) stream.write(data)
    if (end) stream.end()
  } catch {
    // ignore
  }
}

function stopActiveHelper(opts?: { clearOrphans?: boolean }) {
  const child = activeHelper
  activeHelper = null
  if (child?.pid) {
    // Soft nudge only if stdin is still open — never write after end (crash #ERR_STREAM_WRITE_AFTER_END).
    safeStdinWrite(child.stdin, '\r\n', true)
    const pid = child.pid
    try {
      // Detached Wine/Proton gets its own process group — signal the group.
      if (process.platform === 'linux') {
        try {
          process.kill(-pid, 'SIGTERM')
        } catch {
          child.kill('SIGTERM')
        }
      } else {
        child.kill('SIGTERM')
      }
    } catch {
      // ignore
    }
    setTimeout(() => {
      try {
        if (process.platform === 'linux') {
          try {
            process.kill(-pid, 'SIGKILL')
          } catch {
            if (!child.killed) child.kill('SIGKILL')
          }
        } else if (!child.killed) {
          child.kill('SIGKILL')
        }
      } catch {
        // ignore
      }
    }, 400)
  }
  if (opts?.clearOrphans !== false && process.platform === 'linux') {
    try {
      // Narrow pattern — never pkill the AppImage / Electron parent.
      execFileSync('pkill', ['-f', 'warframe-api-helper\\.exe'], {
        stdio: 'ignore',
        timeout: 1500,
      })
    } catch {
      // pkill exits 1 when nothing matched
    }
  }
}

/** Candidate paths where the helper may drop inventory.json under Wine/Proton. */
function inventoryOutputCandidates(workDir: string): string[] {
  const names = ['inventory.json']
  const out: string[] = []
  for (const name of names) {
    out.push(path.join(workDir, name))
    out.push(path.join(toolsDir(), name))
  }
  const protonLocal = warframeProtonLocalAppData()
  if (protonLocal) {
    out.push(path.join(protonLocal, 'inventory.json'))
    out.push(path.join(protonLocal, 'Warframe', 'inventory.json'))
  }
  return [...new Set(out)]
}

function findFreshInventoryFile(candidates: string[], notBeforeMs: number): string | null {
  let best: { path: string; mtime: number } | null = null
  for (const p of candidates) {
    try {
      if (!fs.existsSync(p)) continue
      const st = fs.statSync(p)
      if (st.size <= 100 || st.mtimeMs < notBeforeMs - 2000) continue
      if (!best || st.mtimeMs > best.mtime) best = { path: p, mtime: st.mtimeMs }
    } catch {
      // ignore
    }
  }
  return best?.path ?? null
}

function helperFailureMessage(cleaned: string): string {
  if (/Process not found/i.test(cleaned)) {
    return 'Inventory helper could not see Warframe.x64.exe in the Proton prefix. Stay logged into Warframe via Steam, then sync again. If this keeps failing, import inventory.json manually.'
  }
  if (/Failed to gruzzle the crumbs/i.test(cleaned)) {
    return process.platform === 'linux'
      ? 'Inventory helper found Warframe but could not read session memory (gruzzle). Stay logged in on the Orbiter, then in Settings → Linux health check Memory access — if ptrace is restricted, run: sudo sysctl -w kernel.yama.ptrace_scope=0 — and Sync again. Do not run the AppImage as root.'
      : 'Inventory helper found Warframe but could not read account credentials from memory (gruzzle failed). Stay on the orbiter / logged in, then retry. If it keeps failing after an update, import inventory.json manually.'
  }
  if (/Failed to open process/i.test(cleaned)) {
    return process.platform === 'linux'
      ? 'Inventory helper found Warframe but could not open the process. Check Linux health → Memory access (ptrace_scope), use the same Proton as the game, and sync while logged in.'
      : 'Inventory helper found Warframe but could not open the process. Try syncing again while logged in; avoid running the helper under a different Proton than the game.'
  }
  if (/Request failed/i.test(cleaned)) {
    return 'Inventory download failed after reading account credentials (HTTPS under Wine). Stay logged into Warframe, check network access to mobile.warframe.com, then try again.'
  }
  if (cleaned) return cleaned.slice(0, 400)
  return process.platform === 'linux'
    ? 'Timed out waiting for inventory.json under Proton. Stay logged in on the orbiter, then sync once — overlapping syncs are blocked now. Or import a file manually.'
    : 'Timed out waiting for inventory.json. Stay logged into Warframe and try again.'
}

async function syncInventoryFromGameUnlocked(): Promise<InventorySyncResult> {
  const settings = loadSettings()
  if (!settings.inventoryConsent) {
    emitSyncProgress('error', 'Permission required')
    return {
      ok: false,
      error: 'Permission required. Accept the inventory sync risk acknowledgment first.',
    }
  }
  emitSyncProgress('checking', 'Checking Warframe is running…')
  invalidateWarframeProcessCache()
  const running = isWarframeGameRunningSync() || (await isWarframeProcessRunning())
  if (!running) {
    emitSyncProgress('error', 'Warframe is not running')
    return {
      ok: false,
      error:
        process.platform === 'linux'
          ? 'Warframe is not running under Steam/Proton. Launch the game, then try again.'
          : 'Warframe.x64.exe is not running. Log into Warframe, then try again.',
    }
  }

  // Never stack helpers — kill any leftover Wine process from a prior timeout.
  stopActiveHelper()

  let stdinPulse: ReturnType<typeof setInterval> | null = null
  try {
    emitSyncProgress('helper', 'Preparing inventory helper…')
    const exe = await ensureHelperDownloaded()
    const work = inventoryWorkDir()
    fs.mkdirSync(work, { recursive: true })
    const candidates = inventoryOutputCandidates(work)
    const legacyOut = path.join(work, 'inventory.json')
    for (const p of candidates) {
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p)
      } catch {
        // ignore locked files — freshness check still uses mtime
      }
    }

    const startedAt = Date.now()
    let child: ChildProcess
    if (process.platform === 'linux') {
      const wine = findWarframeWineLauncher()
      const pfx = warframeProtonPrefix()
      if (!wine) {
        emitSyncProgress('error', 'Proton/Wine not found')
        return {
          ok: false,
          error:
            'Linux inventory sync needs Proton’s wine or system wine. Install Steam Proton, or import inventory.json / lastData.dat manually.',
        }
      }
      if (!pfx) {
        emitSyncProgress('error', 'Proton prefix not found')
        return {
          ok: false,
          error:
            'Warframe Proton prefix not found (Steam AppID 230410). Launch Warframe once via Steam, or import an inventory file manually.',
        }
      }
      console.info(
        `[Everything Warframe] Inventory sync via ${wine.label} (WINEPREFIX=${pfx})`,
      )
      emitSyncProgress('launching', `Launching helper via ${wine.label}…`)
      const env = buildWineHelperEnv(wine, pfx)
      const compat = warframeCompatDataDir()
      if (compat) env.STEAM_COMPAT_DATA_PATH = compat
      const steamRoot = warframeSteamClientRoot()
      if (steamRoot) {
        env.STEAM_COMPAT_CLIENT_INSTALL_PATH = steamRoot
      }
      env.SteamAppId = WARFRAME_STEAM_APP_ID
      env.SteamGameId = WARFRAME_STEAM_APP_ID
      // Detach so Wine/Proton death or SIGKILL cannot take down the AppImage.
      child = spawn(wine.command, [...wine.args, exe], {
        cwd: work,
        env,
        stdio: ['pipe', 'pipe', 'pipe'],
        detached: true,
      })
      try {
        child.unref()
      } catch {
        // ignore
      }
    } else {
      emitSyncProgress('launching', 'Launching inventory helper…')
      child = spawn(exe, [], {
        cwd: work,
        windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      })
    }

    activeHelper = child
    emitSyncProgress('waiting', 'Reading session from Warframe… stay on the Orbiter')

    let stderr = ''
    child.stderr?.on('data', (d) => {
      stderr += String(d)
    })
    child.stdout?.on('data', (d) => {
      stderr += String(d)
    })

    // Helper waits for Enter after (or before) finishing — pulse stdin immediately
    // so Proton/Wine does not sit for the full timeout with no inventory.json.
    const nudgeStdin = () => {
      safeStdinWrite(child.stdin, '\r\n')
    }
    nudgeStdin()
    stdinPulse = setInterval(nudgeStdin, 1500)

    const childExit = new Promise<number | null>((resolve) => {
      child.on('exit', (code) => resolve(code))
      child.on('error', (err) => {
        stderr += `\n${err instanceof Error ? err.message : String(err)}`
        resolve(null)
      })
    })

    const appearedPrimary = await waitForNewFile(legacyOut, startedAt, 55_000, childExit)
    let foundPath = appearedPrimary
      ? legacyOut
      : findFreshInventoryFile(candidates, startedAt)

    if (stdinPulse) {
      clearInterval(stdinPulse)
      stdinPulse = null
    }
    // stopActiveHelper soft-closes stdin + SIGTERM — do not write/end twice.
    stopActiveHelper()
    // Give Wine a moment to flush a late write after kill/Enter.
    if (!foundPath) {
      await new Promise((r) => setTimeout(r, 600))
      foundPath = findFreshInventoryFile(candidates, startedAt)
    }

    if (!foundPath) {
      const cleaned = scrubWineHelperOutput(stderr)
      console.warn(
        '[Everything Warframe] Inventory helper failed or timed out:',
        cleaned.slice(0, 800) || '(no helper output)',
      )
      const msg = helperFailureMessage(cleaned)
      emitSyncProgress('error', msg)
      return { ok: false, error: msg }
    }

    if (foundPath !== legacyOut) {
      try {
        fs.mkdirSync(work, { recursive: true })
        fs.copyFileSync(foundPath, legacyOut)
        foundPath = legacyOut
      } catch (err) {
        console.warn(
          '[Everything Warframe] Could not copy helper inventory into managed path',
          err instanceof Error ? err.message : err,
        )
      }
    }

    emitSyncProgress('parsing', 'Parsing inventory…')
    const result = useInventoryFile(foundPath, 'helper')
    if (result.ok) {
      emitSyncProgress(
        'done',
        `Synced ${result.uniqueCount ?? 0} unique items`,
      )
    } else {
      emitSyncProgress('error', result.error || 'Failed to load inventory')
    }
    return result
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'Inventory sync failed'
    emitSyncProgress('error', msg)
    return {
      ok: false,
      error: msg,
    }
  } finally {
    if (stdinPulse) clearInterval(stdinPulse)
    if (activeHelper) stopActiveHelper()
  }
}

export async function syncInventoryFromGame(): Promise<InventorySyncResult> {
  if (syncInFlight) {
    console.info('[Everything Warframe] Inventory sync already running — joining in-flight attempt')
    return syncInFlight
  }
  syncInFlight = syncInventoryFromGameUnlocked().finally(() => {
    syncInFlight = null
  })
  return syncInFlight
}

function computeInventoryDiff(
  before: InventoryIndex,
  after: InventoryIndex,
): import('../../shared/types').InventoryDiff | null {
  const beforeKeys = Object.keys(before)
  if (!beforeKeys.length) return null

  const added: import('../../shared/types').InventoryDiffEntry[] = []
  const removed: import('../../shared/types').InventoryDiffEntry[] = []
  const changed: import('../../shared/types').InventoryDiffEntry[] = []
  let netUnits = 0

  const keys = new Set([...beforeKeys, ...Object.keys(after)])
  for (const uniqueName of keys) {
    if (!uniqueName.includes('/') && !['RegularCredits', 'Ducats', 'PremiumCredits'].includes(uniqueName)) {
      continue
    }
    const a = before[uniqueName] || 0
    const b = after[uniqueName] || 0
    if (a === b) continue
    const delta = b - a
    netUnits += delta
    const displayName = resolveBrowseDisplayName(uniqueName)
    const entry = { uniqueName, displayName, before: a, after: b, delta }
    if (a <= 0 && b > 0) added.push(entry)
    else if (a > 0 && b <= 0) removed.push(entry)
    else changed.push(entry)
  }

  const byAbs = (x: { delta: number }, y: { delta: number }) => Math.abs(y.delta) - Math.abs(x.delta)
  added.sort(byAbs)
  removed.sort(byAbs)
  changed.sort(byAbs)

  return {
    syncedAt: new Date().toISOString(),
    added: added.slice(0, 80),
    removed: removed.slice(0, 80),
    changed: changed.slice(0, 80),
    summary: {
      addedStacks: added.length,
      removedStacks: removed.length,
      changedStacks: changed.length,
      netUnits,
    },
  }
}

export function getInventoryDiff(): import('../../shared/types').InventoryDiff | null {
  return lastInventoryDiff
}

export function useInventoryFile(
  filePath: string,
  source: InventorySource,
): InventorySyncResult {
  try {
    // If AlecaFrame .dat, decrypt into managed inventory.json for stable path
    let finalPath = filePath
    let finalSource = source
    if (filePath.toLowerCase().endsWith('.dat')) {
      const json = decryptAlecaFrameDat(filePath)
      fs.mkdirSync(inventoryWorkDir(), { recursive: true })
      finalPath = managedInventoryPath()
      fs.writeFileSync(finalPath, JSON.stringify(json, null, 2), 'utf8')
      finalSource = 'alecaframe'
    }

    const previous = { ...cachedIndex }
    const loaded = loadInventoryFromPath(finalPath)
    lastInventoryDiff = computeInventoryDiff(previous, loaded.index)
    try {
      recordInventoryHaul(lastInventoryDiff)
    } catch {
      // haul is best-effort
    }
    cachedIndex = loaded.index
    cachedMastery = loaded.mastery
    cachedGearCategory = loaded.gearCategory
    cachedPlayerLevel = loaded.playerLevel
    cachedMeta = {
      path: finalPath,
      itemCount: loaded.itemCount,
      uniqueCount: loaded.uniqueCount,
    }
    inventoryRevision += 1

    updateSettings({
      inventoryPath: finalPath,
      inventorySource: finalSource,
      inventoryLastSynced: new Date().toISOString(),
    })

    const status = getInventoryStatus()
    for (const cb of listeners) cb(status)

    try {
      void import('./economy-snapshots').then((m) => {
        m.recordEconomySnapshotFromIndex(cachedIndex)
      })
    } catch {
      // ignore
    }

    try {
      void import('./arbitration-log').then((m) => {
        m.noteInventoryDiffForArbitration(lastInventoryDiff)
      })
    } catch {
      // ignore
    }

    return {
      ok: true,
      path: finalPath,
      source: finalSource,
      itemCount: loaded.itemCount,
      uniqueCount: loaded.uniqueCount,
      diff: lastInventoryDiff,
    }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'Failed to load inventory file',
    }
  }
}

export function reloadConfiguredInventory(): void {
  const settings = loadSettings()
  if (!settings.inventoryPath || !fs.existsSync(settings.inventoryPath)) {
    cachedIndex = {}
    cachedMastery = {}
    cachedGearCategory = {}
    cachedPlayerLevel = null
    cachedMeta = { path: '', itemCount: 0, uniqueCount: 0 }
    return
  }
  try {
    const loaded = loadInventoryFromPath(settings.inventoryPath)
    cachedIndex = loaded.index
    cachedMastery = loaded.mastery
    cachedGearCategory = loaded.gearCategory
    cachedPlayerLevel = loaded.playerLevel
    cachedMeta = {
      path: settings.inventoryPath,
      itemCount: loaded.itemCount,
      uniqueCount: loaded.uniqueCount,
    }
    inventoryRevision += 1
  } catch (err) {
    console.error('[Everything Warframe] Failed to reload inventory', err)
  }
}

export function clearInventoryData(): InventoryStatus {
  cachedIndex = {}
  cachedMastery = {}
  cachedGearCategory = {}
  cachedPlayerLevel = null
  cachedMeta = { path: '', itemCount: 0, uniqueCount: 0 }
  lastInventoryDiff = null
  inventoryRevision += 1
  updateSettings({
    inventoryPath: '',
    inventorySource: 'none',
    inventoryLastSynced: '',
  })
  const managed = managedInventoryPath()
  try {
    if (fs.existsSync(managed)) fs.unlinkSync(managed)
  } catch {
    // ignore
  }
  const status = getInventoryStatus()
  for (const cb of listeners) cb(status)
  return status
}

export function setInventoryConsent(consent: boolean): InventoryStatus {
  updateSettings({ inventoryConsent: consent })
  const status = getInventoryStatus()
  for (const cb of listeners) cb(status)
  return status
}

export function getInventoryStatus(): InventoryStatus {
  const settings = loadSettings()
  if (
    settings.inventoryPath &&
    settings.inventoryPath !== cachedMeta.path &&
    fs.existsSync(settings.inventoryPath)
  ) {
    reloadConfiguredInventory()
  }

  const lastSynced = settings.inventoryLastSynced
  const syncedAt = lastSynced ? Date.parse(lastSynced) : NaN
  const staleAgeMs = Number.isFinite(syncedAt) ? Math.max(0, Date.now() - syncedAt) : null
  const STALE_AFTER_MS = 6 * 60 * 60 * 1000
  const stale = staleAgeMs == null || staleAgeMs >= STALE_AFTER_MS

  return {
    path: settings.inventoryPath,
    source: settings.inventorySource,
    consent: settings.inventoryConsent,
    lastSynced,
    itemCount: cachedMeta.itemCount,
    uniqueCount: cachedMeta.uniqueCount,
    revision: inventoryRevision,
    loaded: cachedMeta.uniqueCount > 0,
    helperReady: helperIsReady(),
    warframeRunning: isWarframeRunning(),
    stale,
    staleAgeMs,
    platform: process.platform,
    protonPlay: isProtonPlayAvailable(),
    error: null,
    candidates: detectInventoryCandidates(),
    playerLevel: cachedPlayerLevel,
  }
}

function leafDisplayName(uniqueName: string): string {
  const leaf = uniqueName.split('/').pop() || uniqueName
  return leaf
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const CURRENCY_NAMES: Record<string, string> = {
  RegularCredits: 'Credits',
  PremiumCredits: 'Platinum',
  Ducats: 'Ducats',
}

function resolveBrowseDisplayName(uniqueName: string): string {
  if (CURRENCY_NAMES[uniqueName]) return CURRENCY_NAMES[uniqueName]

  const recipe = getRecipeByUnique(uniqueName)
  if (recipe?.name) return recipe.name
  if (/Blueprint$/i.test(uniqueName)) {
    const asComp = getRecipeByUnique(uniqueName.replace(/Blueprint$/i, 'Component'))
    if (asComp?.name) {
      return /blueprint/i.test(asComp.name) ? asComp.name : `${asComp.name} Blueprint`
    }
  }
  if (/Component$/i.test(uniqueName)) {
    const asBp = getRecipeByUnique(uniqueName.replace(/Component$/i, 'Blueprint'))
    if (asBp?.name) return asBp.name.replace(/\s+Blueprint$/i, '')
  }

  const item = findCatalogItemByUnique(uniqueName)
  if (item?.name) return item.name

  return leafDisplayName(uniqueName)
}

function classifyInventoryKey(uniqueName: string): {
  kind: import('../../shared/types').InventoryBrowseKind
  isBlueprint: boolean
  isComponent: boolean
} {
  const isBlueprint = /Blueprint$/i.test(uniqueName)
  const isComponent = /Component$/i.test(uniqueName)
  if (uniqueName === 'RegularCredits' || uniqueName === 'Ducats' || uniqueName === 'PremiumCredits') {
    return { kind: 'currency', isBlueprint, isComponent }
  }
  if (/\/Projections\//i.test(uniqueName) || /VoidProjection/i.test(uniqueName)) {
    return { kind: 'relic', isBlueprint, isComponent }
  }
  if (
    isBlueprint ||
    isComponent ||
    /\/(Recipes|WeaponParts)\//i.test(uniqueName)
  ) {
    return { kind: 'part', isBlueprint, isComponent }
  }
  if (
    /\/(Powersuits|Weapons|Melee|LongGuns|Pistols|Sentinels|KubrowPet|Cat|Moa|Hoverboard|Mechs|OperatorAmps)\//i.test(
      uniqueName,
    )
  ) {
    return { kind: 'gear', isBlueprint, isComponent }
  }
  if (/\/(Types\/Items|Resources|Fish|Plants|MiscItems)\//i.test(uniqueName) || /Resource/i.test(uniqueName)) {
    return { kind: 'resource', isBlueprint, isComponent }
  }
  return { kind: 'other', isBlueprint, isComponent }
}

/** Browseable inventory rows (full paths only — skips basename alias duplicates). */
export function browseInventory(
  query?: import('../../shared/types').InventoryBrowseQuery,
): import('../../shared/types').InventoryBrowseItem[] {
  const search = String(query?.search || '')
    .trim()
    .toLowerCase()
  const kindFilter = query?.kind || 'all'
  const sellableOnly = Boolean(query?.sellableOnly)
  const enrichPrices = sellableOnly || Boolean(query?.enrichPrices)
  const sort =
    query?.sort ||
    (sellableOnly ? 'platinum' : 'count')
  const limit = Math.min(Math.max(Number(query?.limit) || 500, 1), 5000)
  const rows: import('../../shared/types').InventoryBrowseItem[] = []

  for (const [uniqueName, count] of Object.entries(cachedIndex)) {
    if (!count || count <= 0) continue
    // Skip basename / alias shortcuts — keep canonical paths (+ currencies)
    if (!uniqueName.includes('/') && !['RegularCredits', 'Ducats', 'PremiumCredits'].includes(uniqueName)) {
      continue
    }
    const { kind, isBlueprint, isComponent } = classifyInventoryKey(uniqueName)
    if (kindFilter !== 'all' && kind !== kindFilter) continue
    const displayName = resolveBrowseDisplayName(uniqueName)
    if (search) {
      const hay = `${displayName} ${uniqueName} ${leafDisplayName(uniqueName)}`.toLowerCase()
      if (!hay.includes(search)) continue
    }

    // Keep one of each prime part/BP; extras are sell/ducat candidates.
    const keepOne = kind === 'part' || isBlueprint || isComponent
    const excess = keepOne ? Math.max(0, count - 1) : 0

    let platinum: number | null = null
    let ducats: number | null = null
    if (enrichPrices) {
      const catalog =
        findCatalogItemByUnique(uniqueName) || findCatalogItemByName(displayName)
      const platDirect = lookupWfinfoPlatinum(displayName)
      const platAlt =
        catalog?.name && catalog.name !== displayName
          ? lookupWfinfoPlatinum(catalog.name)
          : null
      platinum = platDirect ?? platAlt
      ducats = catalog?.ducats ?? null
    }

    if (sellableOnly) {
      if (kind === 'relic' || kind === 'currency' || kind === 'resource' || kind === 'gear') {
        continue
      }
      if (excess <= 0) continue
      // WFM listing needs plat; ducat-only extras still useful for Baro dump sorting.
      if (platinum == null && ducats == null) continue
    }

    rows.push({
      uniqueName,
      displayName,
      count,
      kind,
      isBlueprint,
      isComponent,
      platinum,
      ducats,
      excess,
    })
  }

  rows.sort((a, b) => {
    if (sort === 'ducats') {
      const ad = (a.ducats ?? 0) * (a.excess || a.count)
      const bd = (b.ducats ?? 0) * (b.excess || b.count)
      if (bd !== ad) return bd - ad
      if (b.excess !== a.excess) return b.excess - a.excess
    } else if (sort === 'platinum') {
      const ap = a.platinum ?? -1
      const bp = b.platinum ?? -1
      if (bp !== ap) return bp - ap
      if (b.excess !== a.excess) return b.excess - a.excess
    } else if (sort === 'excess') {
      if (b.excess !== a.excess) return b.excess - a.excess
    } else if (sort === 'name') {
      return a.displayName.localeCompare(b.displayName)
    } else if (b.count !== a.count) {
      return b.count - a.count
    }
    return a.displayName.localeCompare(b.displayName)
  })
  return rows.slice(0, limit)
}

export function onInventoryUpdated(cb: (status: InventoryStatus) => void) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}
