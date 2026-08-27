import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { RelicScanState, RewardEval, SetPartOwned } from '../../shared/types'
import { getInventoryIndex, ownedCountForReward } from './inventory'
import { ensureItemCatalog, getSetParts, matchCatalogItem } from './item-catalog'
import { lookupMarketPrices } from './market-prices'
import { recognizeRewardNames, warmupOcr } from './ocr'
import { waitForOcrUiReady } from './ocr-readiness'
import { captureRewardRegionVariants, cropRelicBandsFromPng } from './screen-capture'
import { detectRewardPlayerCount, detectUiTheme, rankUiThemes, type WfThemeId } from './wfinfo-theme'
import { ensureWfinfoPrices, lookupWfinfoPrices } from './wfinfo-prices'
import { loadSettings } from '../settings'
import { recordRelicHaul } from './session-haul'
import { WF_THEME_IDS } from './wfinfo-theme'

/** Last confident theme/slots — skip re-detect on the next scan when overrides are Auto. */
let lastConfidentTheme: WfThemeId | null = null
let lastConfidentSlots: 3 | 4 | null = null

function cleanRelicOcr(ocrText: string): string {
  return ocrText
    .replace(/\b(OWNED|CRAFTED|UNRANKED|STEEL|PATH|BONUS|ESSENCE)\b/gi, '')
    .replace(/\b\d+\s*Owned\b/gi, '')
    .replace(/\bForma\b(?!\s+Blueprint)/gi, 'Forma Blueprint')
    .replace(/\bBlueprint\b/gi, 'Blueprint')
    .replace(/[^A-Za-z0-9 '&-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function saveRelicDebugCrops(bands: Buffer[][], label: string, fullPng?: Buffer) {
  void (async () => {
    try {
      const dir = path.join(app.getPath('userData'), 'relic-debug')
      await fs.promises.mkdir(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      const writes: Promise<void>[] = []
      bands.forEach((slotBands, slot) => {
        slotBands.forEach((buf, band) => {
          writes.push(
            fs.promises.writeFile(path.join(dir, `${stamp}-${label}-s${slot}-b${band}.png`), buf),
          )
        })
      })
      if (fullPng?.length) {
        writes.push(fs.promises.writeFile(path.join(dir, `${stamp}-${label}-full.png`), fullPng))
      }
      await Promise.all(writes)
      console.info(`[Everything Warframe] Saved relic debug crops → ${dir}`)
    } catch (err) {
      console.warn('[Everything Warframe] Could not save relic debug crops', err)
    }
  })()
}

function scoreOcrCandidate(cleaned: string): number {
  if (!cleaned) return -1
  const matched = matchCatalogItem(cleaned)
  if (matched) return matched.score
  if (
    cleaned.length >= 8 &&
    /prime|blueprint|systems|chassis|neuro|barrel|receiver|blade|stock|link|grip|handle|string|hilt/i.test(
      cleaned,
    )
  ) {
    return 0.35
  }
  if (cleaned.length > 4) return 0.12
  return 0
}

/** Pick the OCR string that best matches the item catalog (or longest fallback). */
async function bestOcrForSlot(bandCrops: Buffer[], theme: WfThemeId | null): Promise<string> {
  if (!bandCrops.length) return ''
  // Variants are [above, primary, below] — try primary first, then neighbors only if weak.
  const order =
    bandCrops.length >= 3
      ? [1, 0, 2, ...Array.from({ length: bandCrops.length - 3 }, (_, i) => i + 3)]
      : bandCrops.map((_, i) => i)

  let best = ''
  let bestScore = -1
  let tried = 0
  for (const idx of order) {
    const crop = bandCrops[idx]
    if (!crop) continue
    const [raw] = await recognizeRewardNames([crop], theme)
    tried += 1
    const cleaned = cleanRelicOcr(raw || '')
    if (!cleaned) continue
    const score = scoreOcrCandidate(cleaned)
    if (score > bestScore || (score === bestScore && cleaned.length > best.length)) {
      bestScore = score
      best = cleaned
    }
    // Catalog hit — skip remaining neighbors.
    if (bestScore >= 0.45) break
    // After two attempts with something readable, stop burning OCR slots.
    if (tried >= 2 && best.length >= 6) break
  }
  return best
}

type Listener = (state: RelicScanState) => void

const listeners = new Set<Listener>()

const AUTO_HIDE_SUCCESS_MS = 45_000
const AUTO_HIDE_ERROR_MS = 12_000

let hideTimer: NodeJS.Timeout | null = null

let state: RelicScanState = {
  active: false,
  scanning: false,
  scannedAt: '',
  trigger: 'none',
  error: null,
  rewards: [],
  inventoryLoaded: false,
  celebration: false,
  squadSize: null,
  scanMeta: null,
}

/** Optional EE.log squad-size hint supplied by main before a log-triggered scan. */
let pendingSquadSize: number | null = null

export function setRelicSquadSizeHint(size: number | null) {
  pendingSquadSize =
    size != null && size >= 1 && size <= 4 ? Math.round(size) : null
}

function emit() {
  for (const cb of listeners) cb(state)
}

function cancelAutoHide() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function scheduleAutoHide(ms: number) {
  cancelAutoHide()
  hideTimer = setTimeout(() => {
    hideTimer = null
    clearRelicScan()
  }, ms)
}

function ownedCount(uniqueName: string | null, displayName: string): number {
  return ownedCountForReward(uniqueName, displayName)
}

function buildSetParts(setName: string | null): {
  setParts: SetPartOwned[]
  setOwnedParts: number
  setTotalParts: number
} {
  const parts = getSetParts(setName)
  const filtered = parts.filter((p) => p.partName && p.partName !== 'Item')
  const use = filtered.length ? filtered : parts
  const setParts: SetPartOwned[] = use.map((p) => ({
    partName: p.partName || p.name,
    itemName: p.name,
    owned: ownedCount(p.uniqueName, p.name),
  }))
  const setOwnedParts = setParts.filter((p) => p.owned > 0).length
  return { setParts, setOwnedParts, setTotalParts: setParts.length }
}

function isFormaReward(r: RewardEval): boolean {
  return (
    /^forma(\s+blueprint)?$/i.test(r.name.trim()) ||
    /^forma(\s+blueprint)?$/i.test(r.ocrText.trim())
  )
}

function pickBest(rewards: RewardEval[]): RewardEval[] {
  if (!rewards.length) return rewards
  const mode = loadSettings().relicBestPickMode || 'balanced'
  const allForma = rewards.every(isFormaReward)
  let bestIdx = 0
  let bestScore = Number.NEGATIVE_INFINITY
  rewards.forEach((r, i) => {
    // Never highlight Forma as Best unless every slot is Forma.
    if (isFormaReward(r) && !allForma) {
      if (i === 0) bestIdx = 0 // keep index valid; score stays -inf unless only Forma
      return
    }
    let score = 0
    if (mode === 'needed') {
      if (r.needed) score += 10_000
      if (r.platinum != null) score += r.platinum
      if (r.ducats != null) score += r.ducats * 0.05
    } else if (mode === 'platinum') {
      if (r.platinum != null) score += r.platinum * 10
      if (r.needed) score += 50
    } else if (mode === 'ducats') {
      if (r.ducats != null) score += r.ducats * 10
      if (r.needed) score += 50
    } else {
      // balanced — needed first, then plat, then ducats
      if (r.needed) score += 1000
      if (r.platinum != null) score += r.platinum * 2
      if (r.ducats != null) score += r.ducats * 0.1
    }
    if (r.matchScore >= 0.7) score += 20
    // Stable tie-break: prefer earlier slot when scores match
    if (score > bestScore || (score === bestScore && i < bestIdx)) {
      bestScore = score
      bestIdx = i
    }
  })
  // If every non-Forma was skipped somehow, fall back to first non-Forma.
  if (bestScore === Number.NEGATIVE_INFINITY) {
    const nonForma = rewards.findIndex((r) => !isFormaReward(r))
    bestIdx = nonForma >= 0 ? nonForma : 0
  }
  return rewards.map((r, i) => ({ ...r, bestPick: i === bestIdx }))
}

export function getRelicScanState(): RelicScanState {
  return state
}

export function onRelicScanUpdated(cb: Listener) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function clearRelicScan(): RelicScanState {
  cancelAutoHide()
  pendingSquadSize = null
  state = {
    active: false,
    scanning: false,
    scannedAt: '',
    trigger: 'none',
    error: null,
    rewards: [],
    inventoryLoaded: Object.keys(getInventoryIndex()).length > 0,
    celebration: false,
    squadSize: null,
    scanMeta: null,
  }
  emit()
  return state
}

export function ackRelicCelebration(): RelicScanState {
  if (!state.celebration) return state
  state = { ...state, celebration: false }
  emit()
  return state
}

export async function warmupRelicScanner(): Promise<void> {
  await Promise.all([
    ensureItemCatalog(),
    ensureWfinfoPrices().catch(() => {}),
    warmupOcr().catch(() => {}),
  ])
}

export async function scanRelicRewards(
  trigger: 'manual' | 'log' = 'manual',
): Promise<RelicScanState> {
  if (state.scanning) return state

  cancelAutoHide()

  const squadSize = pendingSquadSize
  let lastMeta: RelicScanState['scanMeta'] = state.scanMeta
  let lastFullPng: Buffer | null = null
  state = {
    ...state,
    scanning: true,
    active: true,
    trigger,
    error: null,
    celebration: false,
    inventoryLoaded: Object.keys(getInventoryIndex()).length > 0,
    squadSize,
  }
  emit()

  try {
    // Catalog is required for name matching, but a transient API blip must not
    // permanently poison the session (ensureItemCatalog clears `ready` on failure).
    await Promise.all([
      ensureItemCatalog().catch((err) => {
        console.warn(
          '[Everything Warframe] Item catalog unavailable for relic scan:',
          err instanceof Error ? err.message : err,
        )
      }),
      ensureWfinfoPrices().catch(() => {}),
    ])
    if (trigger === 'log') {
      // Poll until the reward strip looks painted (cap = old fixed delay).
      await waitForOcrUiReady('relic')
    }

    const buildRewards = async (
      saveDebugOnWeak = false,
      themeForce?: WfThemeId | null,
    ): Promise<RewardEval[]> => {
      const capture = await captureRewardRegionVariants()
      if (!capture || capture.bands.length < 4) {
        throw new Error(
          process.platform === 'linux'
            ? 'Could not capture the reward screen. Allow screen share once and use Borderless Windowed.'
            : 'Could not capture the reward screen. Is Warframe borderless on the selected OCR monitor?',
        )
      }

      // WFInfo-style: explicit force → settings override → last confident → auto-detect.
      const settings = loadSettings()
      const theme: WfThemeId =
        themeForce ??
        settings.wfThemeOverride ??
        lastConfidentTheme ??
        detectUiTheme(capture.fullPng)
      console.info(`[Everything Warframe] Relic UI theme ≈ ${theme}`)

      // Squad size: settings override → EE.log → last confident → image detect.
      // Prefer EE.log / override so 3-player crops don't get stretched to 4.
      let slotHint =
        settings.relicSquadSizeOverride ??
        squadSize ??
        lastConfidentSlots ??
        detectRewardPlayerCount(capture.fullPng, theme)
      if (slotHint !== 3 && slotHint !== 4) slotHint = 4
      console.info(`[Everything Warframe] Relic slot count hint ≈ ${slotHint}`)

      // Re-crop for 3-player reward layouts (same strip width, 3 cards).
      const bands =
        slotHint === 3
          ? cropRelicBandsFromPng(capture.fullPng, capture.width, capture.height, 3)
          : capture.bands

      // OCR all slots in parallel (primary band first per slot).
      const ocrNames = await Promise.all(
        bands.map((slotBands, slot) =>
          bestOcrForSlot(slotBands, theme).then((best) => {
            console.info(
              `[Everything Warframe] Relic OCR slot ${slot}: ${best || '(empty)'}`,
            )
            return best
          }),
        ),
      )

      let next: RewardEval[] = ocrNames.map((cleaned, slot) => {
        let matched = matchCatalogItem(cleaned)
        // OCR often drops "Blueprint" on Forma — force a stable catalog name.
        if (
          (!matched || matched.score < 0.5) &&
          /^forma(\s+blueprint)?$/i.test(cleaned.trim())
        ) {
          const formaHit = matchCatalogItem('Forma Blueprint')
          if (formaHit) matched = { ...formaHit, score: Math.max(formaHit.score, 0.85) }
        }
        const name = matched?.item.name || cleaned || `Reward ${slot + 1}`
        const uniqueName = matched?.item.uniqueName || null
        const setName = matched?.item.setName || null
        const partName = matched?.item.partName || null
        const owned = ownedCount(uniqueName, name)
        const { setParts, setOwnedParts, setTotalParts } = buildSetParts(setName)
        const matchScore = matched?.score ?? (cleaned.length > 2 ? 0.2 : 0)
        const forma = /^forma(\s+blueprint)?$/i.test(name) || /^forma(\s+blueprint)?$/i.test(cleaned)

        return {
          slot,
          ocrText: cleaned,
          name: forma ? 'Forma Blueprint' : name,
          uniqueName,
          setName: forma ? null : setName,
          partName: forma ? null : partName,
          owned,
          needed: !forma && owned <= 0 && Boolean(setName),
          setOwnedParts,
          setTotalParts,
          setParts,
          matchScore: forma ? Math.max(matchScore, 0.9) : matchScore,
          ducats: matched?.item.ducats ?? null,
          platinum: null,
          volume: null,
          bestPick: false,
          vaulted: forma ? null : matched?.item.vaulted ?? null,
        }
      })

      // Drop garbage OCR (e.g. "HHI", "dit") — require a real catalog hit or a
      // long prime-part-shaped string. Short unmatched blobs used to pollute the strip.
      next = next.filter(
        (r) =>
          r.matchScore >= 0.42 ||
          /^forma(\s+blueprint)?$/i.test(r.ocrText.trim()) ||
          /^forma(\s+blueprint)?$/i.test(r.name.trim()) ||
          (r.ocrText.trim().length >= 10 &&
            /prime|blueprint|systems|chassis|neuro|barrel|receiver|blade|stock|grip|hilt|link|string/i.test(
              r.ocrText,
            )),
      )

      if (saveDebugOnWeak && next.every((r) => r.matchScore < 0.45)) {
        saveRelicDebugCrops(bands, 'weak', capture.fullPng)
      }

      // Prefer image/settings squad hint when EE.log didn't supply one.
      const trimTo = settings.relicSquadSizeOverride ?? squadSize ?? slotHint
      if (trimTo != null && next.length > trimTo) {
        const strong = next.filter((r) => r.matchScore >= 0.45)
        const keep = strong.length >= trimTo ? strong : next
        next = [...keep]
          .sort((a, b) => b.matchScore - a.matchScore)
          .slice(0, trimTo)
          .sort((a, b) => a.slot - b.slot)
          .map((r, i) => ({ ...r, slot: i }))
      }

      lastMeta = {
        theme,
        slotHint,
        trimmedTo: trimTo,
        formaSlots: next.filter((r) => isFormaReward(r)).length,
      }
      lastFullPng = capture.fullPng
      return next
    }

    let rewards = await buildRewards(false)
    // Catalog match required — length alone is not "useful" (junk like "449-e").
    let useful = rewards.some((r) => r.matchScore >= 0.45)

    // Proton log flush / UI paint can lag — one retry when the first pass is empty.
    if (!useful) {
      console.info('[Everything Warframe] Relic OCR weak — retrying capture…')
      await new Promise((r) => setTimeout(r, process.platform === 'linux' ? 400 : 150))
      rewards = await buildRewards(true)
      useful = rewards.some((r) => r.matchScore >= 0.45)
    }

    // Theme mis-detect: try runner-up UI themes once (skip when user forced a theme).
    if (!useful && !loadSettings().wfThemeOverride) {
      const tried = new Set<string>([lastMeta?.theme || ''].filter(Boolean))
      const alts = lastFullPng
        ? rankUiThemes(lastFullPng, 3).filter((t) => !tried.has(t))
        : WF_THEME_IDS.filter((t) => !tried.has(t)).slice(0, 2)
      for (const alt of alts.slice(0, 2)) {
        console.info(`[Everything Warframe] Relic OCR weak — trying theme ${alt}…`)
        rewards = await buildRewards(false, alt)
        useful = rewards.some((r) => r.matchScore >= 0.45)
        if (useful) break
      }
    }

    if (!useful) {
      const multi =
        process.platform === 'linux'
          ? ' On multi-monitor Linux, set Settings → Game/OCR monitor to the screen Warframe is on, and pick that same screen in the screen-share dialog.'
          : ' If you use multiple monitors, set Settings → Game/OCR monitor to Warframe’s screen.'
      const themeHint =
        lastMeta?.theme
          ? ` Detected UI theme “${lastMeta.theme}” — force Relic UI theme in Settings if names look wrong.`
          : ' Try forcing Relic UI theme or reward slots (3 vs 4) in Settings.'
      throw new Error(
        'No reward names detected. Open the fissure pick screen, then scan again.' +
          themeHint +
          multi,
      )
    }

    // Local WFInfo prices first (instant), then show the strip immediately.
    try {
      const local = lookupWfinfoPrices(rewards.map((r) => r.name))
      rewards = rewards.map((r) => {
        const hit = local.get(r.name)
        return hit ? { ...r, platinum: hit.platinum, volume: hit.volume } : r
      })
    } catch {
      // pricing optional
    }

    rewards = pickBest(rewards)

    try {
      recordRelicHaul(rewards)
    } catch {
      // haul is best-effort
    }

    // Remember confident theme + slot count so the next Auto scan skips re-detect.
    const strong = rewards.filter((r) => r.matchScore >= 0.55)
    if (strong.length >= Math.ceil(rewards.length / 2) && lastMeta?.theme) {
      if ((WF_THEME_IDS as string[]).includes(lastMeta.theme)) {
        lastConfidentTheme = lastMeta.theme as WfThemeId
      }
      const slots =
        lastMeta.trimmedTo === 3 || lastMeta.slotHint === 3
          ? 3
          : lastMeta.trimmedTo === 4 || lastMeta.slotHint === 4
            ? 4
            : null
      if (slots) lastConfidentSlots = slots
    }

    state = {
      active: true,
      scanning: false,
      scannedAt: new Date().toISOString(),
      trigger,
      error: null,
      rewards,
      inventoryLoaded: Object.keys(getInventoryIndex()).length > 0,
      celebration: true,
      squadSize,
      scanMeta: lastMeta,
    }
    emit()
    scheduleAutoHide(AUTO_HIDE_SUCCESS_MS)

    // Live market fill-in after the overlay is already visible (don't burn pick timer).
    const missing = rewards.filter((r) => r.platinum == null).map((r) => r.name)
    if (missing.length) {
      void lookupMarketPrices(missing)
        .then((live) => {
          if (!state.active || state.scanning) return
          let changed = false
          const next = state.rewards.map((r) => {
            if (r.platinum != null) return r
            const hit = live.get(r.name)
            if (!hit) return r
            changed = true
            return { ...r, platinum: hit.platinum, volume: hit.volume }
          })
          if (!changed) return
          state = { ...state, rewards: pickBest(next) }
          emit()
        })
        .catch(() => {})
    }

    return state
  } catch (err) {
    state = {
      ...state,
      scanning: false,
      active: true,
      celebration: false,
      error: err instanceof Error ? err.message : 'Relic scan failed',
      scanMeta: lastMeta,
    }
    emit()
    scheduleAutoHide(AUTO_HIDE_ERROR_MS)
    return state
  }
}
