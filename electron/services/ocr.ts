/**
 * WFInfo-style OCR: theme/lavender text isolation → tiny crops → Tesseract
 * (PSM.SINGLE_LINE) → closed-vocab match in relic-scanner / riven-grader.
 *
 * PaddleOCR was removed from the hot path — large-region neural OCR was slow
 * and inaccurate on Warframe UI. Capture still uses Electron region grabs.
 */
import path from 'node:path'
import { createRequire } from 'node:module'
import { app, nativeImage } from 'electron'
import { createWorker, PSM, Worker } from 'tesseract.js'
import { filterRelicTextPng, filterRivenTextPng, type WfThemeId } from './wfinfo-theme'
import { RIVEN_CARD_LINE_BANDS } from '../../shared/captureGeometry'

const nodeRequire = createRequire(__filename)

let tessPool: Worker[] = []
let tessAvailable: Worker[] = []
const tessWaiters: Array<(w: Worker) => void> = []
let tessLoading: Promise<Worker[]> | null = null

let ocrPriorityDepth = 0

const RELIC_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '&-"
const RIVEN_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789%+-.&' "

/** UI chrome / buttons that appear near Cycle cards — never treat as stats. */
const RIVEN_NOISE =
  /^(accept|decline|cycle|kuva|confirm|cancel|riven|keep|take|current|new|reroll|vs|polarity|rank|mr\.?|mastery|disposition|ok|yes|no)$/i

/**
 * Fixed fractions of a full Cycle card crop (art on top, diamond text below).
 * Name + up to 4 stacked stat lines — see shared/captureGeometry RIVEN_CARD_LINE_BANDS.
 */
const RIVEN_PANEL_BAND = RIVEN_CARD_LINE_BANDS.panel
const RIVEN_NAME_BAND = RIVEN_CARD_LINE_BANDS.name
const RIVEN_STAT_BANDS = RIVEN_CARD_LINE_BANDS.stats

/** Briefly raise priority while OCR runs so Warframe doesn't starve us. */
export async function withOcrPriority<T>(fn: () => Promise<T>): Promise<T> {
  ocrPriorityDepth += 1
  if (ocrPriorityDepth === 1) {
    try {
      osSetPriorityAbove()
    } catch {
      // ignore
    }
  }
  try {
    return await fn()
  } finally {
    ocrPriorityDepth -= 1
    if (ocrPriorityDepth === 0) {
      try {
        osSetPriorityBelow()
      } catch {
        // ignore
      }
    }
  }
}

function osSetPriorityAbove() {
  const os = nodeRequire('node:os') as typeof import('node:os')
  try {
    os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL)
  } catch {
    os.setPriority(os.constants.priority.PRIORITY_NORMAL)
  }
}

function osSetPriorityBelow() {
  const os = nodeRequire('node:os') as typeof import('node:os')
  os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL)
}

async function desiredPoolSize(): Promise<number> {
  if (process.env.EW_OCR_POOL === '1') return 1
  if (process.env.EW_OCR_POOL === '2') return 2
  try {
    const { loadSettings } = await import('../settings')
    return loadSettings().ocrPoolSize === 1 ? 1 : 2
  } catch {
    return 2
  }
}

async function createTessWorker(): Promise<Worker> {
  const cachePath = path.join(app.getPath('userData'), 'tesseract-cache')
  const w = await createWorker('eng', 1, {
    cachePath,
    logger: () => {},
  })
  await w.setParameters({
    tessedit_char_whitelist: RELIC_WHITELIST,
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    user_defined_dpi: '300',
  })
  return w
}

async function loadTessPool(): Promise<Worker[]> {
  if (tessPool.length) return tessPool
  if (!tessLoading) {
    tessLoading = (async () => {
      const want = await desiredPoolSize()
      const first = await createTessWorker()
      const pool: Worker[] = [first]
      if (want >= 2) {
        try {
          pool.push(await createTessWorker())
        } catch (err) {
          console.warn(
            '[Everything Warframe] Second Tesseract worker unavailable — serial OCR only',
            err instanceof Error ? err.message : err,
          )
        }
      }
      tessPool = pool
      tessAvailable = [...pool]
      console.info(
        `[Everything Warframe] OCR engine: Tesseract (WFInfo-style) ×${pool.length}` +
          (pool.length === 1 ? ' (enable Dual OCR workers in Settings for speed)' : ''),
      )
      return pool
    })()
  }
  return tessLoading
}

async function acquireTess(): Promise<Worker> {
  await loadTessPool()
  const free = tessAvailable.pop()
  if (free) return free
  return new Promise<Worker>((resolve) => {
    tessWaiters.push(resolve)
  })
}

function releaseTess(w: Worker) {
  const waiter = tessWaiters.shift()
  if (waiter) {
    waiter(w)
    return
  }
  tessAvailable.push(w)
}

async function withTessSlot<T>(fn: (w: Worker) => Promise<T>): Promise<T> {
  const w = await acquireTess()
  try {
    return await fn(w)
  } finally {
    releaseTess(w)
  }
}

/**
 * Grayscale + contrast without sharp (Linux packages sometimes lack a matching
 * sharp native binary). Improves OCR of light UI text on dark mesh.
 */
function nativeContrastPrep(png: Buffer, opts: { scale: number; harsh?: boolean }): Buffer {
  const img = nativeImage.createFromBuffer(png)
  const { width, height } = img.getSize()
  if (width < 8 || height < 8) return png
  const bitmap = Buffer.from(img.toBitmap())
  const harsh = Boolean(opts.harsh)
  const scaleLin = harsh ? 1.85 : 1.45
  const bias = harsh ? -40 : -22
  const threshold = harsh ? 118 : 0
  for (let i = 0; i + 3 < bitmap.length; i += 4) {
    const b = bitmap[i]
    const g = bitmap[i + 1]
    const r = bitmap[i + 2]
    let gray = (r * 299 + g * 587 + b * 114) / 1000
    gray = Math.max(0, Math.min(255, gray * scaleLin + bias))
    if (threshold > 0) gray = gray >= threshold ? 255 : 0
    bitmap[i] = bitmap[i + 1] = bitmap[i + 2] = Math.round(gray)
    bitmap[i + 3] = 255
  }
  const out = nativeImage.createFromBitmap(bitmap, { width, height })
  const tw = Math.max(640, Math.round(width * opts.scale))
  const th = Math.max(8, Math.round((height * tw) / width))
  return out.resize({ width: tw, height: th, quality: 'best' }).toPNG()
}

function electronPngToRgba(png: Buffer): {
  data: Uint8Array
  width: number
  height: number
} | null {
  try {
    const img = nativeImage.createFromBuffer(png)
    const { width, height } = img.getSize()
    if (width < 2 || height < 2) return null
    const bgra = Buffer.from(img.toBitmap())
    const rgba = new Uint8Array(width * height * 4)
    for (let i = 0, j = 0; i + 3 < bgra.length; i += 4, j += 4) {
      rgba[j] = bgra[i + 2]
      rgba[j + 1] = bgra[i + 1]
      rgba[j + 2] = bgra[i]
      rgba[j + 3] = bgra[i + 3]
    }
    return { data: rgba, width, height }
  } catch {
    return null
  }
}

function sharpFromPng(png: Buffer) {
  const sharp = nodeRequire('sharp') as typeof import('sharp')
  const decoded = electronPngToRgba(png)
  if (decoded) {
    return sharp(Buffer.from(decoded.data), {
      raw: { width: decoded.width, height: decoded.height, channels: 4 },
    })
  }
  return sharp(png)
}

/** PNG prep for Tesseract relic name crops (black text on white). */
async function prepareRelicPng(
  png: Buffer,
  scale: number,
  theme?: WfThemeId | null,
  useFilter = true,
): Promise<Buffer> {
  const filtered = useFilter && theme ? filterRelicTextPng(png, theme) : png
  try {
    const decoded = electronPngToRgba(filtered)
    let pipeline = sharpFromPng(filtered).grayscale().normalize()
    if (!useFilter || !theme) {
      // Light UI text on dark mesh without theme mask → invert for Tess.
      pipeline = pipeline.negate().linear(1.3, -12)
    } else {
      pipeline = pipeline.sharpen({ sigma: 0.6 })
    }
    if (decoded && scale !== 1) {
      pipeline = pipeline.resize({
        width: Math.round(decoded.width * scale),
        kernel: 'lanczos3',
      })
    } else if (scale !== 1) {
      pipeline = pipeline.resize({
        width: Math.max(64, Math.round(220 * scale)),
        kernel: 'lanczos3',
      })
    }
    return pipeline
      .extend({
        top: 16,
        bottom: 16,
        left: 14,
        right: 14,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .png()
      .toBuffer()
  } catch {
    const prep = nativeContrastPrep(filtered, { scale: Math.max(1, scale), harsh: true })
    if (useFilter && theme) return prep
    try {
      return await sharpFromPng(prep).negate().png().toBuffer()
    } catch {
      return prep
    }
  }
}

/**
 * Prep a riven crop: text isolate → black-on-white → upscale.
 * Unfiltered path inverts light UI text so Tess sees dark glyphs.
 */
async function prepareRivenLinePng(
  png: Buffer,
  targetWidth = 900,
  useFilter = true,
): Promise<Buffer> {
  const source = useFilter ? filterRivenTextPng(png) : png
  try {
    let pipeline = sharpFromPng(source).grayscale().normalize()
    if (!useFilter) {
      // Light lavender/white on dark mesh → invert to black-on-white.
      pipeline = pipeline.negate().linear(1.35, -16)
    } else {
      pipeline = pipeline.linear(1.25, -10).sharpen({ sigma: 0.85 })
    }
    return await pipeline
      .extend({
        top: 18,
        bottom: 18,
        left: 22,
        right: 22,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .resize({ width: targetWidth, kernel: 'lanczos3' })
      .png()
      .toBuffer()
  } catch {
    const prep = nativeContrastPrep(source, { scale: 3.0, harsh: true })
    if (useFilter) return prep
    // nativeContrastPrep leaves light-on-dark when unfiltered — invert via sharp/native
    try {
      return await sharpFromPng(prep).negate().png().toBuffer()
    } catch {
      return prep
    }
  }
}

function filterRivenLines(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim()
    if (!t || t.length < 2) return false
    if (RIVEN_NOISE.test(t)) return false
    if (/^[?\d,\.\s]+$/.test(t) && !/%/.test(t)) return false
    // Drop pure glyph soup with no digit / weapon-ish token.
    if (!/\d/.test(t) && !/[A-Za-z]{4,}/.test(t)) return false
    if (/^[.\-\s&]+$/.test(t)) return false
    return true
  })
}

function countRivenStatHints(lines: string[]): number {
  return lines.filter(
    (line) => /^[+\-–—]?\s*\d/.test(line) || /%|x\d/i.test(line),
  ).length
}

function mergeRivenPasses(passes: string[][]): string {
  const merged: string[] = []
  const seen = new Set<string>()
  for (const lines of passes) {
    for (const line of lines) {
      const key = line.toLowerCase()
      if (seen.has(key)) continue
      seen.add(key)
      merged.push(line)
    }
  }
  return merged.join('\n').trim()
}

function trimRivenCardLetterbox(png: Buffer): Buffer {
  try {
    const img = nativeImage.createFromBuffer(png)
    const { width: w, height: h } = img.getSize()
    if (w < 40 || h < 40) return png
    const bitmap = Buffer.from(img.toBitmap())
    const rowDark = (y: number) => {
      let dark = 0
      let n = 0
      const step = Math.max(1, Math.floor(w / 80))
      for (let x = 0; x < w; x += step) {
        const i = (y * w + x) * 4
        const gray = (bitmap[i] + bitmap[i + 1] + bitmap[i + 2]) / 3
        n += 1
        if (gray < 22) dark += 1
      }
      return n > 0 && dark / n > 0.92
    }
    let top = 0
    while (top < h * 0.15 && rowDark(top)) top += Math.max(1, Math.floor(h / 200))
    let bot = h - 1
    while (bot > h * 0.85 && rowDark(bot)) bot -= Math.max(1, Math.floor(h / 200))
    if (top < h * 0.025 && h - 1 - bot < h * 0.025) return png
    if (bot - top < h * 0.6) return png
    const out = img.crop({ x: 0, y: top, width: w, height: bot - top + 1 }).toPNG()
    return out?.length ? out : png
  } catch {
    return png
  }
}

async function cropRivenBand(
  png: Buffer,
  band: { top: number; height: number },
  dy = 0,
): Promise<Buffer | null> {
  try {
    const trimmed = trimRivenCardLetterbox(png)
    const img = nativeImage.createFromBuffer(trimmed)
    const { width: w, height: h } = img.getSize()
    if (w <= 40 || h <= 40) return null
    // Inset past the purple crystal frame on both sides.
    const x = Math.round(w * 0.16)
    const y = Math.round(h * (band.top + dy))
    const width = Math.max(1, Math.round(w * 0.68))
    const height = Math.max(1, Math.round(h * band.height))
    if (y >= h || x >= w || y + 8 >= h) return null
    const cropH = Math.min(height, h - Math.max(0, y))
    const cropW = Math.min(width, w - x)
    // Tess crashes / spam on needle crops ("Image too small to scale!!").
    if (cropW < 48 || cropH < 12) return null
    const crop = img.crop({
      x: Math.min(x, w - 1),
      y: Math.max(0, Math.min(y, h - 1)),
      width: cropW,
      height: cropH,
    })
    const { width: cw, height: ch } = crop.getSize()
    if (cw < 48 || ch < 12) return null
    const out = crop.toPNG()
    if (out?.length && out.length > 64) return out
    return nativeImage
      .createFromBitmap(Buffer.from(crop.toBitmap()), { width: cw, height: ch })
      .toPNG()
  } catch (err) {
    console.warn(
      '[Everything Warframe] Riven line crop failed',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

async function ocrRivenCrop(
  png: Buffer,
  opts?: { filter?: boolean; psm?: PSM },
): Promise<string> {
  const useFilter = opts?.filter !== false
  const psm = opts?.psm ?? PSM.SINGLE_LINE
  const prepared = await prepareRivenLinePng(png, psm === PSM.SINGLE_BLOCK ? 900 : 720, useFilter)
  return withTessSlot(async (w) => {
    await w.setParameters({
      tessedit_char_whitelist: RIVEN_WHITELIST,
      tessedit_pageseg_mode: psm,
      user_defined_dpi: '300',
    })
    const result = await w.recognize(prepared)
    const raw = (result.data.text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (psm === PSM.SINGLE_BLOCK) {
      return filterRivenLines(raw).join('\n')
    }
    return raw.join(' ').replace(/\s+/g, ' ').trim()
  })
}

async function ocrSingleLine(
  png: Buffer,
  mode: 'relic' | 'riven',
  theme?: WfThemeId | null,
  opts?: { rivenFilter?: boolean; relicFilter?: boolean },
): Promise<string> {
  if (mode === 'relic') {
    try {
      const img = nativeImage.createFromBuffer(png)
      const { width, height } = img.getSize()
      if (width < 24 || height < 8) return ''
    } catch {
      return ''
    }
    const useFilter = opts?.relicFilter !== false
    const prepared = await prepareRelicPng(png, 2.0, theme, useFilter)
    return withTessSlot(async (w) => {
      await w.setParameters({
        tessedit_char_whitelist: RELIC_WHITELIST,
        tessedit_pageseg_mode: PSM.SINGLE_LINE,
        user_defined_dpi: '300',
      })
      const result = await w.recognize(prepared)
      return (result.data.text || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)
        .join(' ')
        .replace(/\s+/g, ' ')
        .trim()
    })
  }
  let text = await ocrRivenCrop(png, {
    filter: opts?.rivenFilter !== false,
    psm: PSM.SINGLE_LINE,
  })
  if (!text || (text.length < 4 && !/\d/.test(text))) {
    text = await ocrRivenCrop(png, { filter: false, psm: PSM.SINGLE_LINE })
  }
  return text
}

async function ocrRivenPanel(png: Buffer, dy = 0): Promise<string[]> {
  const panelCrop = await cropRivenBand(png, RIVEN_PANEL_BAND, dy)
  if (!panelCrop) return []
  try {
    const block = await ocrRivenCrop(panelCrop, { filter: true, psm: PSM.SINGLE_BLOCK })
    return filterRivenLines(block.split(/\n/).map((l) => l.trim()).filter(Boolean))
  } catch {
    return []
  }
}

async function ocrRivenPanelUnfiltered(png: Buffer, dy = 0): Promise<string[]> {
  const panelCrop = await cropRivenBand(png, RIVEN_PANEL_BAND, dy)
  if (!panelCrop) return []
  try {
    const block = await ocrRivenCrop(panelCrop, { filter: false, psm: PSM.SINGLE_BLOCK })
    return filterRivenLines(block.split(/\n/).map((l) => l.trim()).filter(Boolean))
  } catch {
    return []
  }
}

/** Per-line slices — only when the panel pass is weak. */
async function ocrRivenLineSlices(png: Buffer, dy = 0): Promise<string[]> {
  const lineBands: Array<{ top: number; height: number }> = [
    RIVEN_NAME_BAND,
    ...RIVEN_STAT_BANDS,
  ]
  const crops = await Promise.all(lineBands.map((b) => cropRivenBand(png, b, dy)))
  const texts = await Promise.all(
    crops.map(async (crop) => {
      if (!crop) return ''
      try {
        // One filtered pass only — no per-line unfiltered salvage (too slow).
        return await ocrRivenCrop(crop, { filter: true, psm: PSM.SINGLE_LINE })
      } catch {
        return ''
      }
    }),
  )
  return filterRivenLines(texts.filter(Boolean))
}

/**
 * Progressive OCR: 1 panel → optional unfiltered → optional line slices.
 * Avoids the old 10–12 Tess calls per card on every scan.
 */
async function ocrRivenCardLines(png: Buffer, dy = 0): Promise<string[]> {
  let lines = await ocrRivenPanel(png, dy)
  if (countRivenStatHints(lines) >= 2) return lines

  const unfiltered = await ocrRivenPanelUnfiltered(png, dy)
  lines = filterRivenLines(
    mergeRivenPasses([lines, unfiltered]).split(/\n/).filter(Boolean),
  )
  if (countRivenStatHints(lines) >= 2) return lines

  const sliced = await ocrRivenLineSlices(png, dy)
  return filterRivenLines(
    mergeRivenPasses([lines, sliced]).split(/\n/).filter(Boolean),
  )
}

/**
 * OCR reward name crops (WFInfo-style). Theme-filtered first; unfiltered salvage
 * when the mask blanks the line — same progressive pattern as riven panel OCR.
 */
export async function recognizeRewardNames(
  images: Buffer[],
  theme?: WfThemeId | null,
): Promise<string[]> {
  return withOcrPriority(async () => {
    await loadTessPool()
    return Promise.all(
      images.map(async (png) => {
        try {
          let text = await ocrSingleLine(png, 'relic', theme, { relicFilter: true })
          // Theme mis-detect / dim glyphs — one unfiltered pass like riven salvage.
          if (!text || text.replace(/\s/g, '').length < 4) {
            const alt = await ocrSingleLine(png, 'relic', theme, { relicFilter: false })
            if ((alt || '').length > (text || '').length) text = alt
          }
          return text
        } catch (err) {
          console.warn(
            '[Everything Warframe] Relic OCR failed',
            err instanceof Error ? err.message : err,
          )
          return ''
        }
      }),
    )
  })
}

/**
 * Fast path: one panel OCR per card (parallel). Extra passes only if weak.
 */
export async function recognizeRivenStatsFast(images: Buffer[]): Promise<string[]> {
  return withOcrPriority(async () => {
    await loadTessPool()
    return Promise.all(
      images.map(async (png) => {
        const lines = await ocrRivenCardLines(png, 0)
        return lines.join('\n')
      }),
    )
  })
}

/**
 * Deep: one nudged panel + line slices when the fast path was weak.
 */
export async function recognizeRivenBlocks(
  images: Buffer[],
  opts?: { deep?: boolean },
): Promise<string[]> {
  return withOcrPriority(async () => {
    await loadTessPool()
    return Promise.all(
      images.map(async (png) => {
        const primary = await ocrRivenCardLines(png, 0)
        if (!opts?.deep || countRivenStatHints(primary) >= 2) {
          return primary.join('\n')
        }
        // One vertical nudge only (not ± both + full cascade).
        const nudged = await ocrRivenCardLines(png, -0.025)
        return mergeRivenPasses([primary, nudged])
      }),
    )
  })
}

function tinyWarmupPng(): Buffer {
  const w = 96
  const h = 24
  const bgra = Buffer.alloc(w * h * 4, 255)
  for (let y = 6; y < 18; y++) {
    for (let x = 16; x < 80; x++) {
      const i = (y * w + x) * 4
      bgra[i] = bgra[i + 1] = bgra[i + 2] = 20
      bgra[i + 3] = 255
    }
  }
  return nativeImage.createFromBitmap(bgra, { width: w, height: h }).toPNG()
}

export async function warmupOcr(): Promise<void> {
  const pool = await loadTessPool()
  const warm = tinyWarmupPng()
  try {
    await Promise.all(
      pool.map(async () => {
        await withTessSlot(async (worker) => {
          await worker.setParameters({
            tessedit_char_whitelist: RELIC_WHITELIST,
            tessedit_pageseg_mode: PSM.SINGLE_LINE,
          })
          await worker.recognize(warm)
        })
      }),
    )
  } catch {
    // ignore warmup failures
  }
  console.info(`[Everything Warframe] OCR warmup: Tesseract ready ×${pool.length}`)
}

export async function shutdownOcr(): Promise<void> {
  const workers = [...tessPool]
  tessPool = []
  tessAvailable = []
  tessWaiters.length = 0
  tessLoading = null
  await Promise.all(workers.map((w) => w.terminate().catch(() => {})))
}
