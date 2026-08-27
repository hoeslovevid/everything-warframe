import { nativeImage } from 'electron'
import {
  resolveRelicRewardRegions,
  resolveRivenCompareRegions,
} from '../../shared/captureGeometry'
import { loadSettings } from '../settings'
import { captureDisplayQuick } from './screen-capture'

export type ReadinessKind = 'relic' | 'riven'

type WaitOpts = {
  /** Floor wait before first sample (ms). */
  minMs?: number
  /** Hard cap — always proceed after this (ms). */
  maxMs?: number
  /** Poll interval (ms). */
  intervalMs?: number
}

function sleep(ms: number) {
  return new Promise<void>((r) => setTimeout(r, ms))
}

/**
 * Score a crop for “UI text looks painted”: light glyphs on a mostly dark field.
 * Returns 0–1 readiness confidence.
 */
function textOnDarkScore(png: Buffer): number {
  const img = nativeImage.createFromBuffer(png)
  const { width, height } = img.getSize()
  if (width < 8 || height < 8) return 0
  const bitmap = img.toBitmap()
  const stepX = Math.max(1, Math.floor(width / 80))
  const stepY = Math.max(1, Math.floor(height / 40))
  let samples = 0
  let dark = 0
  let bright = 0
  let edges = 0
  let prevGray = -1
  for (let y = 0; y < height; y += stepY) {
    prevGray = -1
    for (let x = 0; x < width; x += stepX) {
      const i = (y * width + x) * 4
      const b = bitmap[i]
      const g = bitmap[i + 1]
      const r = bitmap[i + 2]
      const gray = (r * 299 + g * 587 + b * 114) / 1000
      samples += 1
      if (gray < 55) dark += 1
      else if (gray > 170) bright += 1
      if (prevGray >= 0 && Math.abs(gray - prevGray) > 55) edges += 1
      prevGray = gray
    }
  }
  if (!samples) return 0
  const darkRatio = dark / samples
  const brightRatio = bright / samples
  const edgeRatio = edges / Math.max(1, samples)
  // Reward / Cycle UI: dark panel + sparse bright text + horizontal edges.
  if (darkRatio < 0.28 || brightRatio < 0.012 || brightRatio > 0.42) return 0
  const score =
    Math.min(1, darkRatio / 0.55) * 0.4 +
    Math.min(1, brightRatio / 0.08) * 0.35 +
    Math.min(1, edgeRatio / 0.12) * 0.25
  return score
}

function scoreRelicFrame(png: Buffer, width: number, height: number): number {
  const custom = loadSettings().ocrScanRegions.relicStrip
  const regions = resolveRelicRewardRegions(width, height, 4, custom)
  if (!regions.length) return 0
  // Primary name band for middle slots is enough to know the strip painted.
  const picks = [regions[1], regions[2]].filter(Boolean)
  let best = 0
  for (const region of picks) {
    const img = nativeImage.createFromBuffer(png)
    const size = img.getSize()
    const x = Math.max(0, Math.min(region.x, size.width - 1))
    const y = Math.max(0, Math.min(region.y, size.height - 1))
    const w = Math.max(1, Math.min(region.width, size.width - x))
    const h = Math.max(1, Math.min(region.height, size.height - y))
    const crop = img.crop({ x, y, width: w, height: h }).toPNG()
    best = Math.max(best, textOnDarkScore(crop))
  }
  return best
}

function scoreRivenFrame(png: Buffer, width: number, height: number): number {
  const custom = loadSettings().ocrScanRegions
  const regions = resolveRivenCompareRegions(width, height, custom)
  if (regions.length < 2) return 0
  const img = nativeImage.createFromBuffer(png)
  const size = img.getSize()
  let total = 0
  for (const region of regions.slice(0, 2)) {
    const x = Math.max(0, Math.min(region.x, size.width - 1))
    const y = Math.max(0, Math.min(region.y, size.height - 1))
    const w = Math.max(1, Math.min(region.width, size.width - x))
    const h = Math.max(1, Math.min(region.height, size.height - y))
    // Stats band is mid-card — crop the middle 55% vertically for a tighter signal.
    const bandY = y + Math.round(h * 0.28)
    const bandH = Math.max(8, Math.round(h * 0.5))
    const crop = img
      .crop({
        x,
        y: Math.min(bandY, size.height - 1),
        width: w,
        height: Math.min(bandH, size.height - bandY),
      })
      .toPNG()
    total += textOnDarkScore(crop)
  }
  return total / 2
}

const READY_THRESHOLD = 0.42
/** One confident frame is enough — retry path covers false starts. */
const STABLE_HITS = 1

/**
 * Poll the screen until the target UI looks painted, or maxMs elapses.
 * Uses a quick capture path (persistent stream when live) — no overlay pause.
 */
export async function waitForOcrUiReady(
  kind: ReadinessKind,
  opts: WaitOpts = {},
): Promise<{ waitedMs: number; ready: boolean; score: number }> {
  const linux = process.platform === 'linux'
  const defaults =
    kind === 'relic'
      ? {
          minMs: linux ? 120 : 50,
          maxMs: linux ? 800 : 400,
          intervalMs: 60,
        }
      : {
          minMs: linux ? 200 : 120,
          maxMs: linux ? 1800 : 1000,
          intervalMs: 80,
        }
  const minMs = opts.minMs ?? defaults.minMs
  const maxMs = opts.maxMs ?? defaults.maxMs
  const intervalMs = opts.intervalMs ?? defaults.intervalMs

  const started = Date.now()
  if (minMs > 0) await sleep(minMs)

  let hits = 0
  let lastScore = 0
  while (Date.now() - started < maxMs) {
    try {
      const shot = await captureDisplayQuick()
      if (shot?.png?.length) {
        lastScore =
          kind === 'relic'
            ? scoreRelicFrame(shot.png, shot.width, shot.height)
            : scoreRivenFrame(shot.png, shot.width, shot.height)
        if (lastScore >= READY_THRESHOLD) {
          hits += 1
          if (hits >= STABLE_HITS) {
            const waitedMs = Date.now() - started
            console.info(
              `[Everything Warframe] OCR readiness ${kind}: ready score=${lastScore.toFixed(2)} after ${waitedMs}ms`,
            )
            return { waitedMs, ready: true, score: lastScore }
          }
        } else {
          hits = 0
        }
      }
    } catch {
      hits = 0
    }
    const remaining = maxMs - (Date.now() - started)
    if (remaining <= 0) break
    await sleep(Math.min(intervalMs, remaining))
  }

  const waitedMs = Date.now() - started
  console.info(
    `[Everything Warframe] OCR readiness ${kind}: proceed score=${lastScore.toFixed(2)} after ${waitedMs}ms (cap)`,
  )
  return { waitedMs, ready: lastScore >= READY_THRESHOLD, score: lastScore }
}
