import { prepareOcrPixels } from './ocr-image'
/**
 * WFInfo-style OCR: theme/lavender text isolation → tiny crops → Tesseract
 * (PSM.SINGLE_LINE) → closed-vocab match in relic-scanner / riven-grader.
 *
 * PaddleOCR was removed from the hot path — large-region neural OCR was slow
 * and inaccurate on Warframe UI. Capture still uses Electron region grabs.
 */
import path from 'node:path'
import fs from 'node:fs'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { app, nativeImage } from 'electron'
import { createWorker, PSM, Worker } from 'tesseract.js'
import { filterRelicTextPng, filterRivenTextPng, type WfThemeId } from './wfinfo-theme'
import { RIVEN_CARD_LINE_BANDS } from '../../shared/captureGeometry'
import { preferReading, findTextRows, isCompleteRiven, type TextReading } from '../../shared/ocr-quality'
import { parseRivenOcr } from './riven-grader'

const nodeRequire = createRequire(__filename)

let tessPool: Worker[] = []
let tessAvailable: Worker[] = []
const tessWaiters: Array<{ resolve: (w: Worker) => void; reject: (err: Error) => void }> = []
let tessLoading: Promise<Worker[]> | null = null
let shuttingDown = false
let warmupTask: Promise<void> | null = null
const readingCache = new Map<string, TextReading>()
// Tesseract 5 otherwise generates unused HTML, TSV and layout output per crop.
const TEXT_OUTPUT = { text: true, blocks: false, layoutBlocks: false, hocr: false,
  tsv: false, box: false, unlv: false, osd: false, pdf: false }

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

/** Use normal scheduling for short OCR jobs; return to background priority afterward. */
export async function withOcrPriority<T>(fn: () => Promise<T>): Promise<T> {
  ocrPriorityDepth += 1
  if (ocrPriorityDepth === 1) {
    try {
      osSetPriorityForScan()
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

function osSetPriorityForScan() {
  const os = nodeRequire('node:os') as typeof import('node:os')
  // Restore normal scheduling during recognition without outranking the game.
  os.setPriority(os.constants.priority.PRIORITY_NORMAL)
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
  await fs.promises.mkdir(cachePath, { recursive: true })
  const w = await createWorker('eng', 1, {
    cachePath,
    logger: () => {},
  })
  try { await w.setParameters({
    tessedit_char_whitelist: RELIC_WHITELIST,
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
    user_defined_dpi: '300',
  }) } catch (err) { await w.terminate().catch(() => {}); throw err }
  return w
}

async function loadTessPool(): Promise<Worker[]> {
  if (shuttingDown) throw new Error('OCR is shutting down')
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
    })().catch((err) => {
      tessLoading = null
      throw err
    })
  }
  return tessLoading
}

async function acquireTess(): Promise<Worker> {
  await loadTessPool()
  const free = tessAvailable.pop()
  if (free) return free
  if (shuttingDown) throw new Error('OCR is shutting down')
  return new Promise<Worker>((resolve, reject) => {
    tessWaiters.push({ resolve, reject })
  })
}

function releaseTess(w: Worker) {
  if (shuttingDown || !tessPool.includes(w)) return
  const waiter = tessWaiters.shift()
  if (waiter) {
    waiter.resolve(w)
    return
  }
  tessAvailable.push(w)
}

async function readPrepared(w: Worker, png: Buffer, key: string): Promise<TextReading> {
  const hash = createHash('sha256').update(key).update(png).digest('hex')
  const cached = readingCache.get(hash)
  if (cached) return cached
  const result = await w.recognize(png, {}, TEXT_OUTPUT)
  const reading = { text: result.data.text || '', confidence: result.data.confidence || 0 }
  if (readingCache.size >= 96) readingCache.delete(readingCache.keys().next().value!)
  readingCache.set(hash, reading)
  return reading
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

/** PNG prep for Tesseract relic name crops (black text on white). */
async function prepareRelicPng(png: Buffer, scale: number, theme?: WfThemeId | null, useFilter = true): Promise<Buffer> {
  try {
    const pixels = electronPngToRgba(png)
    if (!pixels) return png
    return await prepareOcrPixels(pixels, { mode: 'relic', filtered: useFilter, theme, targetWidth: Math.round(pixels.width * scale) })
  } catch {
    const source = useFilter && theme ? filterRelicTextPng(png, theme) : png
    return nativeContrastPrep(source, { scale, harsh: true })
  }
}

async function prepareRivenLinePng(png: Buffer, targetWidth = 900, useFilter = true): Promise<Buffer> {
  try {
    const pixels = electronPngToRgba(png)
    if (!pixels) return png
    return await prepareOcrPixels(pixels, { mode: 'riven', filtered: useFilter, targetWidth })
  } catch {
    const source = useFilter ? filterRivenTextPng(png) : png
    return nativeContrastPrep(source, { scale: 3, harsh: true })
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

function completeRivenLines(lines: string[]): boolean {
  return isCompleteRiven(parseRivenOcr(lines.join('\n'), 'current'))
}

function mergeRivenPasses(passes: string[][]): string {
  let best = '', bestScore = -1
  for (const lines of passes) {
    const text = lines.join('\n').trim()
    const roll = parseRivenOcr(text, 'current')
    const score = roll.stats.length * 10 + Number(isCompleteRiven(roll)) * 5 + Number(roll.weapon !== 'Unknown Riven')
    if (score > bestScore) { best = text; bestScore = score }
  }
  return best
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
    const x = Math.round(w * 0.04)
    const y = Math.round(h * (band.top + dy))
    const width = Math.max(1, Math.round(w * 0.92))
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
  const prepared = await prepareRivenLinePng(png, psm === PSM.SINGLE_LINE ? 720 : 1000, useFilter)
  return withTessSlot(async (w) => {
    await w.setParameters({
      tessedit_char_whitelist: RIVEN_WHITELIST,
      tessedit_pageseg_mode: psm,
      user_defined_dpi: '300',
    })
    const result = await readPrepared(w, prepared, `riven:${psm}`)
    const raw = result.text
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
    if (psm !== PSM.SINGLE_LINE) {
      return filterRivenLines(raw).join('\n')
    }
    return raw.join(' ').replace(/\s+/g, ' ').trim()
  })
}

async function ocrSingleLine(
  png: Buffer,
  mode: 'relic' | 'riven',
  theme?: WfThemeId | null,
  opts?: { rivenFilter?: boolean; relicFilter?: boolean; psm?: PSM },
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
        tessedit_pageseg_mode: opts?.psm ?? PSM.SINGLE_LINE,
        user_defined_dpi: '300',
      })
      let result = await readPrepared(w, prepared, `relic:${opts?.psm ?? PSM.SINGLE_LINE}`)
      if (useFilter && theme && result.confidence < 65) {
        const alternate = await prepareRelicPng(png, 2, theme, false)
        result = preferReading(result, await readPrepared(w, alternate, `relic:${opts?.psm ?? PSM.SINGLE_LINE}`))
      }
      return result.text
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
  let crops: Array<Buffer | null> = []
  const panel = await cropRivenBand(png, RIVEN_PANEL_BAND, dy)
  if (panel) {
    const image = nativeImage.createFromBuffer(panel)
    const mask = nativeImage.createFromBuffer(filterRivenTextPng(panel))
    const { width, height } = mask.getSize()
    const rows = findTextRows(mask.toBitmap(), width, height)
    if (rows.length >= 2 && rows.length <= 9) {
      crops = rows.map((row) => image.crop({ x: 0, y: row.top, width, height: row.height }).toPNG())
    }
  }
  if (!crops.length) crops = await Promise.all(lineBands.map((b) => cropRivenBand(png, b, dy)))
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
  if (completeRivenLines(lines)) return lines

  // A broad sparse pass locates text when custom capture boxes include extra art,
  // or UI scale moves the card text outside the standard line bands.
  const broad = await cropRivenBand(png, { top: .52, height: .47 }, dy)
  if (broad) {
    const sparse = filterRivenLines((await ocrRivenCrop(broad, { filter: true, psm: PSM.SPARSE_TEXT })).split('\n'))
    lines = mergeRivenPasses([lines, sparse]).split('\n').filter(Boolean)
    if (completeRivenLines(lines)) return lines
  }

  const unfiltered = await ocrRivenPanelUnfiltered(png, dy)
  lines = filterRivenLines(
    mergeRivenPasses([lines, unfiltered]).split(/\n/).filter(Boolean),
  )
  if (completeRivenLines(lines)) return lines

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
  opts?: { unfiltered?: boolean; multiline?: boolean },
): Promise<string[]> {
  return withOcrPriority(async () => {
    await loadTessPool()
    return Promise.all(
      images.map(async (png) => {
        try {
          let text = await ocrSingleLine(png, 'relic', theme, {
            relicFilter: !opts?.unfiltered,
            psm: opts?.multiline ? PSM.SINGLE_BLOCK : PSM.SINGLE_LINE,
          })
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
        if (!opts?.deep || completeRivenLines(primary)) {
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

async function runWarmup(): Promise<void> {
  const pool = await loadTessPool()
  const warm = tinyWarmupPng()
  await Promise.all(
      pool.map(async () => {
        await withTessSlot(async (worker) => {
          await worker.setParameters({
            tessedit_char_whitelist: RELIC_WHITELIST,
            tessedit_pageseg_mode: PSM.SINGLE_LINE,
          })
          await worker.recognize(warm, {}, TEXT_OUTPUT)
        })
      }),
    )
  console.info(`[Everything Warframe] OCR warmup: Tesseract ready ×${pool.length}`)
}

export function warmupOcr(): Promise<void> {
  if (!warmupTask) warmupTask = runWarmup().catch((err) => { warmupTask = null; throw err })
  return warmupTask
}

export async function shutdownOcr(): Promise<void> {
  shuttingDown = true
  if (tessLoading) await tessLoading.catch(() => {})
  const workers = [...tessPool]
  tessPool = []
  tessAvailable = []
  for (const waiter of tessWaiters.splice(0)) waiter.reject(new Error('OCR stopped'))
  tessLoading = null
  warmupTask = null
  readingCache.clear()
  await Promise.all(workers.map((w) => w.terminate().catch(() => {})))
}
