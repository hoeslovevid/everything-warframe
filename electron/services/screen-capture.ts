import { desktopCapturer, nativeImage, screen } from 'electron'
import {
  relicRewardRegionVariants,
  relicRewardRegions,
  relicStripLayout,
  resolveRelicRewardRegionVariants,
  resolveRelicRewardRegions,
  resolveRivenCompareRegions,
  rivenCompareRegions,
  type CaptureRegion,
} from '../../shared/captureGeometry'
import { loadSettings } from '../settings'
import { resolveOcrDisplay } from './display-target'
import {
  ensurePersistentCapture,
  grabPersistentFrame,
  isPersistentCaptureLive,
} from './persistent-screen-capture'

function activeOcrScanRegions() {
  return loadSettings().ocrScanRegions
}

export type { CaptureRegion }

/** Optional hook so main can hide the overlay while capturing (avoids OCR reading our UI). */
let pauseOverlayForCapture: (() => () => void) | null = null

export function setCaptureOverlayPause(fn: (() => () => void) | null) {
  pauseOverlayForCapture = fn
}

/** Short desktopCapturer cache — avoids double portal/thumbnail work on retry scans. */
let thumbCache: {
  at: number
  displayId: number
  png: Buffer
  width: number
  height: number
} | null = null
const THUMB_CACHE_MS = 1500

/** Drop cached desktopCapturer thumbs so OCR always sees a fresh frame. */
export function invalidateCaptureCache() {
  thumbCache = null
}

async function withOverlayPaused<T>(fn: () => Promise<T>): Promise<T> {
  const resume = pauseOverlayForCapture?.()
  try {
    // Windows: contentProtection + opacity=0 already exclude the overlay from DWM.
    // Linux/Wayland still needs a short compositor settle.
    const settleMs = process.platform === 'linux' ? (isPersistentCaptureLive() ? 80 : 140) : 0
    if (settleMs > 0) await new Promise((r) => setTimeout(r, settleMs))
    return await fn()
  } finally {
    resume?.()
  }
}

export { relicRewardRegions, relicRewardRegionVariants, relicStripLayout }

async function captureViaDesktopCapturer(preferred?: Electron.Display): Promise<{
  png: Buffer
  width: number
  height: number
} | null> {
  const target = preferred || screen.getPrimaryDisplay()
  const now = Date.now()
  if (thumbCache && now - thumbCache.at < THUMB_CACHE_MS) {
    return { png: thumbCache.png, width: thumbCache.width, height: thumbCache.height }
  }

  // Cap thumbnail size — 4K full-res thumbs are expensive and OCR crops
  // don't need more than 1440p source after upscale.
  const MAX_THUMB_W = 2560
  const MAX_THUMB_H = 1440
  const displays = screen.getAllDisplays()
  let thumbW = 0
  let thumbH = 0
  for (const d of displays) {
    const scale = d.scaleFactor || 1
    thumbW = Math.max(thumbW, Math.round(d.size.width * scale))
    thumbH = Math.max(thumbH, Math.round(d.size.height * scale))
  }
  if (thumbW > MAX_THUMB_W || thumbH > MAX_THUMB_H) {
    const scale = Math.min(MAX_THUMB_W / Math.max(1, thumbW), MAX_THUMB_H / Math.max(1, thumbH))
    thumbW = Math.max(1, Math.round(thumbW * scale))
    thumbH = Math.max(1, Math.round(thumbH * scale))
  }

  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: { width: thumbW, height: thumbH },
  })

  const preferredId = String(target.id)
  const preferredSource =
    sources.find((s) => s.display_id === preferredId) ||
    sources.find((s) => Number(s.display_id) === target.id) ||
    sources.find((s) => s.display_id && preferredId.endsWith(s.display_id))
  const ordered = [
    preferredSource,
    ...sources.filter((s) => s !== preferredSource),
  ].filter(Boolean) as Electron.DesktopCapturerSource[]

  let emptyThumbs = 0
  for (const source of ordered) {
    const png = source.thumbnail.toPNG()
    if (!png?.length) {
      emptyThumbs++
      continue
    }
    const img = nativeImage.createFromBuffer(png)
    const size = img.getSize()
    if (size.width < 16 || size.height < 16) {
      emptyThumbs++
      continue
    }
    const result = { png, width: size.width, height: size.height }
    thumbCache = { at: now, displayId: target.id, ...result }
    return result
  }
  if (sources.length) {
    console.warn(
      `[Everything Warframe] desktopCapturer: ${sources.length} source(s), ${emptyThumbs} empty thumb(s)` +
        ` — persistentLive=${isPersistentCaptureLive()}`,
    )
  }
  return null
}

/**
 * Linux/Wayland + Windows: prefer persistent MediaStream when live (fast frame grabs).
 * Fall back to desktopCapturer thumbnails.
 */
async function captureDisplay(display: Electron.Display): Promise<{
  png: Buffer
  width: number
  height: number
} | null> {
  // Persistent stream is much faster than full-res desktopCapturer thumbs,
  // especially on Windows multi-monitor / 4K. Auto-picks screen via handler.
  const persistent = await grabPersistentFrame()
  if (persistent?.png?.length) {
    console.info(
      `[Everything Warframe] Capture via persistent stream ${persistent.width}×${persistent.height}`,
    )
    return persistent
  }
  const shot = await captureViaDesktopCapturer(display)
  if (shot) {
    console.info(
      `[Everything Warframe] Capture via desktopCapturer ${shot.width}×${shot.height}`,
    )
  } else {
    console.warn(
      '[Everything Warframe] Screen capture failed — on Linux grant the screen-share dialog once and leave it on',
    )
  }
  return shot
}

/**
 * Fast frame for readiness polling — no overlay pause.
 * Prefers live persistent stream; otherwise one desktopCapturer thumb.
 */
export async function captureDisplayQuick(): Promise<{
  png: Buffer
  width: number
  height: number
} | null> {
  if (isPersistentCaptureLive()) {
    const persistent = await grabPersistentFrame()
    if (persistent?.png?.length) return persistent
  }
  invalidateCaptureCache()
  return captureViaDesktopCapturer(resolveOcrDisplay())
}

export async function capturePrimaryDisplay(): Promise<{
  png: Buffer
  width: number
  height: number
} | null> {
  return captureDisplay(resolveOcrDisplay())
}

/** Prefer configured OCR display / persistent stream; desktopCapturer fallback if needed. */
export async function captureBestDisplay(): Promise<{
  png: Buffer
  width: number
  height: number
} | null> {
  return captureDisplay(resolveOcrDisplay())
}

export function cropPng(png: Buffer, region: CaptureRegion): Buffer {
  const img = nativeImage.createFromBuffer(png)
  const size = img.getSize()
  const x = Math.max(0, Math.min(region.x, size.width - 1))
  const y = Math.max(0, Math.min(region.y, size.height - 1))
  const width = Math.max(1, Math.min(region.width, size.width - x))
  const height = Math.max(1, Math.min(region.height, size.height - y))
  return img.crop({ x, y, width, height }).toPNG()
}

/** Re-crop reward name bands from an existing full-frame PNG (3- vs 4-player). */
export function cropRelicBandsFromPng(
  fullPng: Buffer,
  width: number,
  height: number,
  slots: 3 | 4,
): Buffer[][] {
  const custom = activeOcrScanRegions().relicStrip
  const variants = resolveRelicRewardRegionVariants(width, height, slots, custom)
  return variants.map((regions) => regions.map((region) => cropPng(fullPng, region)))
}

export async function captureRewardRegionPngs(): Promise<Buffer[]> {
  return withOverlayPaused(async () => {
    invalidateCaptureCache()
    const shot = await captureBestDisplay()
    if (!shot) return []
    const custom = activeOcrScanRegions().relicStrip
    const regions = resolveRelicRewardRegions(shot.width, shot.height, 4, custom)
    console.info(
      `[Everything Warframe] Relic crop ${shot.width}×${shot.height}` +
        (custom ? ' (custom strip)' : '') +
        ': ' +
        regions
          .map((r, i) => `slot${i}@(${r.x},${r.y},${r.width}x${r.height})`)
          .join(' · '),
    )
    return regions.map((region) => cropPng(shot.png, region))
  })
}

/** Each slot → several vertical band crops (for best-of OCR). */
export async function captureRewardRegionVariants(): Promise<{
  bands: Buffer[][]
  fullPng: Buffer
  width: number
  height: number
} | null> {
  return withOverlayPaused(async () => {
    invalidateCaptureCache()
    const shot = await captureBestDisplay()
    if (!shot) return null
    const custom = activeOcrScanRegions().relicStrip
    const variants = resolveRelicRewardRegionVariants(
      shot.width,
      shot.height,
      4,
      custom,
    )
    console.info(
      `[Everything Warframe] Relic variant crops ${shot.width}×${shot.height}` +
        (custom ? ' (custom strip)' : '') +
        ': ' +
        variants
          .map(
            (bands, i) =>
              `slot${i}=[${bands.map((r) => `${r.y}:${r.height}`).join(',')}]`,
          )
          .join(' · '),
    )
    return {
      bands: variants.map((regions) => regions.map((region) => cropPng(shot.png, region))),
      fullPng: shot.png,
      width: shot.width,
      height: shot.height,
    }
  })
}

export { rivenCompareRegions }

export type RivenCaptureResult = {
  crops: Buffer[]
  fullPng: Buffer
  width: number
  height: number
  regions: CaptureRegion[]
}

/**
 * Capture the two full Cycle mod cards only (left=current, right=reroll).
 * Does not include the companion/overlay UI (paused + content-protected).
 */
export async function captureRivenComparePngs(): Promise<Buffer[]> {
  const result = await captureRivenCompare()
  return result?.crops ?? []
}

export async function captureRivenCompare(): Promise<RivenCaptureResult | null> {
  return withOverlayPaused(async () => {
    invalidateCaptureCache()
    const shot = await captureBestDisplay()
    if (!shot) return null
    const custom = activeOcrScanRegions()
    const regions = resolveRivenCompareRegions(shot.width, shot.height, custom)
    const customLabel =
      custom.rivenCurrent || custom.rivenReroll ? ' (custom regions)' : ''
    console.info(
      `[Everything Warframe] Riven card crops ${shot.width}×${shot.height}${customLabel}: ` +
        regions
          .map((r, i) => `${i === 0 ? 'current' : 'reroll'}@(${r.x},${r.y},${r.width}x${r.height})`)
          .join(' · '),
    )
    return {
      crops: regions.map((region) => cropPng(shot.png, region)),
      fullPng: shot.png,
      width: shot.width,
      height: shot.height,
      regions,
    }
  })
}

/** Warm the persistent capture stream (call when OCR modules are enabled). */
export async function warmScreenCapture(): Promise<boolean> {
  return ensurePersistentCapture()
}
