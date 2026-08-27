/** Shared screen-fraction geometry for OCR crops and overlay placement. */

import type { OcrRegionNorm, OcrScanRegions } from './types'
import { DEFAULT_OCR_SCAN_REGIONS } from './types'

export type CaptureRegion = {
  x: number
  y: number
  width: number
  height: number
}

export type { OcrRegionNorm, OcrScanRegions }

function clamp01(n: number) {
  return Math.min(1, Math.max(0, n))
}

export function clampNorm(r: OcrRegionNorm): OcrRegionNorm {
  const x = clamp01(Number.isFinite(r.x) ? r.x : 0)
  const y = clamp01(Number.isFinite(r.y) ? r.y : 0)
  const width = Math.min(1 - x, Math.max(0.02, Number.isFinite(r.width) ? r.width : 0.02))
  const height = Math.min(1 - y, Math.max(0.02, Number.isFinite(r.height) ? r.height : 0.02))
  return { x, y, width, height }
}

export function regionToNorm(
  region: CaptureRegion,
  width: number,
  height: number,
): OcrRegionNorm {
  const w = Math.max(1, width)
  const h = Math.max(1, height)
  return clampNorm({
    x: region.x / w,
    y: region.y / h,
    width: region.width / w,
    height: region.height / h,
  })
}

export function normToRegion(
  norm: OcrRegionNorm,
  width: number,
  height: number,
): CaptureRegion {
  const n = clampNorm(norm)
  const x = Math.round(n.x * width)
  const y = Math.round(n.y * height)
  const w = Math.max(1, Math.round(n.width * width))
  const h = Math.max(1, Math.round(n.height * height))
  return {
    x: Math.max(0, Math.min(x, Math.max(0, width - 1))),
    y: Math.max(0, Math.min(y, Math.max(0, height - 1))),
    width: Math.min(w, Math.max(1, width - x)),
    height: Math.min(h, Math.max(1, height - y)),
  }
}

function isValidNorm(value: unknown): value is OcrRegionNorm {
  if (!value || typeof value !== 'object') return false
  const r = value as OcrRegionNorm
  return (
    typeof r.x === 'number' &&
    typeof r.y === 'number' &&
    typeof r.width === 'number' &&
    typeof r.height === 'number' &&
    Number.isFinite(r.x) &&
    Number.isFinite(r.y) &&
    Number.isFinite(r.width) &&
    Number.isFinite(r.height) &&
    r.width > 0 &&
    r.height > 0
  )
}

/** Sanitize settings payload; invalid / missing fields → null (built-in defaults). */
export function mergeOcrScanRegions(
  raw: Partial<OcrScanRegions> | null | undefined,
  base: OcrScanRegions = DEFAULT_OCR_SCAN_REGIONS,
): OcrScanRegions {
  const pick = (v: unknown, fallback: OcrRegionNorm | null): OcrRegionNorm | null => {
    if (v === null) return null
    if (v === undefined) return fallback
    return isValidNorm(v) ? clampNorm(v) : fallback
  }
  return {
    relicStrip: pick(raw?.relicStrip, base.relicStrip),
    rivenCurrent: pick(raw?.rivenCurrent, base.rivenCurrent),
    rivenReroll: pick(raw?.rivenReroll, base.rivenReroll),
  }
}

/**
 * Left = current roll, right = reroll — full Kuva Cycle diamond cards.
 *
 * Tuned for multi-monitor / varied aspect ratios. Crops are slightly wider than
 * the diamond art so edge-hugging values like `x1.64` stay inside the frame.
 */
export function rivenCompareRegions(width: number, height: number): CaptureRegion[] {
  const gap = Math.round(width * 0.01)
  // Slightly earlier / wider so edge-hugging "x1.64" multipliers stay in-frame.
  const startX = Math.round(width * 0.348)
  const y = Math.round(height * 0.12)

  // Current / selected card is rendered larger than the reroll card.
  const leftW = Math.round(width * 0.24)
  const leftH = Math.round(height * 0.7)
  const rightW = Math.round(width * 0.22)
  const rightH = Math.round(height * 0.64)
  const rightY = y + Math.round(height * 0.03)

  return [
    { x: startX, y, width: leftW, height: leftH },
    { x: startX + leftW + gap, y: rightY, width: rightW, height: rightH },
  ]
}

/** Lower portion of a card crop — where rolled stats usually sit. */
export function rivenCardStatsRegion(card: CaptureRegion): CaptureRegion {
  const topSkip = Math.round(card.height * 0.26)
  return {
    x: card.x + Math.round(card.width * 0.03),
    y: card.y + topSkip,
    width: Math.round(card.width * 0.94),
    height: Math.round(card.height * 0.66),
  }
}

/**
 * Horizontal grader strip spanning both Cycle cards (like the relic strip).
 * Anchored just above the in-game current/reroll diamonds.
 */
export function rivenStripLayout(width: number, height: number) {
  const regions = rivenCompareRegions(width, height)
  const left = regions[0]
  const right = regions[1]
  const x = left.x
  const stripWidth = right.x + right.width - left.x
  // Compact horizontal cards are ~18–22% of screen height; sit just above the diamonds.
  const stripH = Math.round(Math.min(height * 0.2, 220))
  const gap = Math.round(height * 0.01)
  const y = Math.max(8, left.y - stripH - gap)
  return {
    x,
    y,
    width: stripWidth,
    height: stripH,
  }
}

/** Place the grader strip above the in-game compare cards. */
export function defaultRivenAnchor(
  width: number,
  height: number,
): { x: number; y: number } {
  const layout = rivenStripLayout(width, height)
  return { x: layout.x, y: layout.y }
}

/**
 * Four reward-name bands on a typical fissure pick screen.
 * Geometry follows WFInfo / wfinfo-ng PIXEL_REWARD_* constants (scaled to
 * 1920×1080 reference). The name line sits near `mostTop` (below item art,
 * above player names) — do not add a full reward-box height or crops land in
 * empty space under the strip (regression seen on 1440p end-of-mission).
 */
export function relicRewardRegions(
  width: number,
  height: number,
  slots: 3 | 4 = 4,
): CaptureRegion[] {
  const screenScaling = width * 9 > height * 16 ? height / 1080 : width / 1920
  // WFInfo: PIXEL_REWARD_WIDTH=968, HEIGHT=235, YDISPLAY=316, LINE_HEIGHT=48
  const mostWidth = 968 * screenScaling
  const lineHeight = 48 * screenScaling
  const mostTop =
    height / 2 -
    (316 - 235 + 48) * screenScaling
  // Name band starts just below mostTop (art / Owned tags sit above).
  // Keep height under the rarity divider so player names don't pollute OCR.
  const y = mostTop + lineHeight * 0.4
  const h = lineHeight * 1.45
  const cardW = mostWidth / slots
  const startX = width / 2 - mostWidth / 2

  return Array.from({ length: slots }, (_, i) => ({
    x: Math.round(startX + i * cardW),
    y: Math.max(0, Math.round(y)),
    width: Math.round(cardW),
    height: Math.round(h),
  }))
}

/**
 * Per-slot vertical variants so UI scale / resolution still hits the name line.
 * Order: slightly above, primary, slightly below.
 */
export function relicRewardRegionVariants(
  width: number,
  height: number,
  slots: 3 | 4 = 4,
): CaptureRegion[][] {
  const primary = relicRewardRegions(width, height, slots)
  // Wider vertical search for UI scale / aspect quirks (still near the name line).
  const deltas = [-0.045, -0.015, 0.02]
  const bandH = Math.round(height * 0.08)
  return primary.map((base) =>
    deltas.map((dy) => ({
      x: base.x,
      y: Math.max(0, Math.min(height - bandH, Math.round(base.y + height * dy))),
      width: base.width,
      height: bandH,
    })),
  )
}

/** Built-in relic strip as normalized fractions (for Layout preview defaults). */
export function defaultRelicStripNorm(
  width = 1920,
  height = 1080,
): OcrRegionNorm {
  const regions = relicRewardRegions(width, height, 4)
  const left = regions[0]
  const right = regions[regions.length - 1]
  return regionToNorm(
    {
      x: left.x,
      y: left.y,
      width: right.x + right.width - left.x,
      height: Math.max(...regions.map((r) => r.height)),
    },
    width,
    height,
  )
}

/** Built-in riven card crops as normalized fractions. */
export function defaultRivenCardNorms(
  width = 1920,
  height = 1080,
): { current: OcrRegionNorm; reroll: OcrRegionNorm } {
  const [current, reroll] = rivenCompareRegions(width, height)
  return {
    current: regionToNorm(current, width, height),
    reroll: regionToNorm(reroll, width, height),
  }
}

/**
 * Effective relic name-band crops: custom strip (subdivided into slots) or
 * built-in WFInfo geometry.
 */
export function resolveRelicRewardRegions(
  width: number,
  height: number,
  slots: 3 | 4 = 4,
  customStrip?: OcrRegionNorm | null,
): CaptureRegion[] {
  if (!customStrip) return relicRewardRegions(width, height, slots)
  const strip = normToRegion(customStrip, width, height)
  const cardW = strip.width / slots
  return Array.from({ length: slots }, (_, i) => ({
    x: Math.round(strip.x + i * cardW),
    y: strip.y,
    width: Math.max(1, Math.round(cardW)),
    height: strip.height,
  }))
}

export function resolveRelicRewardRegionVariants(
  width: number,
  height: number,
  slots: 3 | 4 = 4,
  customStrip?: OcrRegionNorm | null,
): CaptureRegion[][] {
  const primary = resolveRelicRewardRegions(width, height, slots, customStrip)
  // Smaller vertical search when the user already tuned the strip.
  const deltas = customStrip ? [-0.015, 0, 0.015] : [-0.045, -0.015, 0.02]
  const bandH = customStrip
    ? Math.max(primary[0]?.height ?? Math.round(height * 0.06), Math.round(height * 0.05))
    : Math.round(height * 0.08)
  return primary.map((base) =>
    deltas.map((dy) => ({
      x: base.x,
      y: Math.max(0, Math.min(height - bandH, Math.round(base.y + height * dy))),
      width: base.width,
      height: customStrip ? Math.max(base.height, Math.round(height * 0.04)) : bandH,
    })),
  )
}

/** Effective riven card crops: per-side custom or built-in Cycle geometry. */
export function resolveRivenCompareRegions(
  width: number,
  height: number,
  custom?: Pick<OcrScanRegions, 'rivenCurrent' | 'rivenReroll'> | null,
): CaptureRegion[] {
  const defaults = rivenCompareRegions(width, height)
  return [
    custom?.rivenCurrent
      ? normToRegion(custom.rivenCurrent, width, height)
      : defaults[0],
    custom?.rivenReroll
      ? normToRegion(custom.rivenReroll, width, height)
      : defaults[1],
  ]
}

/** Strip geometry as fractions of display size (for overlay alignment). */
export function relicStripLayout(width: number, height: number) {
  const regions = relicRewardRegions(width, height)
  const left = regions[0]?.x ?? 0
  const right = (regions[3]?.x ?? 0) + (regions[3]?.width ?? 0)
  const ocrBottom = regions[0] ? regions[0].y + regions[0].height : Math.round(height * 0.63)
  return {
    x: left,
    y: Math.min(height - 80, ocrBottom + Math.round(height * 0.02)),
    width: right - left,
    gap: regions.length > 1 ? regions[1].x - (regions[0].x + regions[0].width) : 0,
    cardWidth: regions[0]?.width ?? Math.round(width * 0.17),
  }
}

export function defaultRelicAnchor(
  width: number,
  height: number,
): { x: number; y: number } {
  const layout = relicStripLayout(width, height)
  return { x: layout.x, y: layout.y }
}
