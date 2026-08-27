import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createRequire } from 'node:module'
import { app, nativeImage } from 'electron'
import { createWorker, PSM, Worker } from 'tesseract.js'
import { filterRelicTextPng, type WfThemeId } from './wfinfo-theme'

const nodeRequire = createRequire(__filename)

type PaddleLine = {
  text?: string
  mean?: number
  box?: Array<[number, number]>
}

type PaddleResult = {
  texts?: PaddleLine[]
  rawTexts?: string[]
}

type ImageRawData = {
  data: Uint8Array | Uint8ClampedArray
  width: number
  height: number
}

type PaddleOcr = {
  detect: (image: string | ImageRawData) => Promise<PaddleResult>
}

type PaddleModule = {
  create?: (options?: Record<string, unknown>) => Promise<PaddleOcr>
  releaseAll?: () => Promise<void>
  default?: {
    create: (options?: Record<string, unknown>) => Promise<PaddleOcr>
  }
}

/** Two ONNX instances so slot OCR can overlap (engine is not re-entrant). */
const PADDLE_POOL_SIZE = 2

let paddlePool: PaddleOcr[] = []
let paddleAvailable: PaddleOcr[] = []
const paddleWaiters: Array<(engine: PaddleOcr) => void> = []
let paddleLoading: Promise<PaddleOcr[]> | null = null
let paddleFailed = false

let tessWorker: Worker | null = null
let tessLoading: Promise<Worker> | null = null

/** Reused scratch path if buffer detect fails (rare). */
let paddleScratchPath: string | null = null
let ocrPriorityDepth = 0

const RELIC_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789 '&-"
const RIVEN_WHITELIST =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789%+-.&' "

/** UI chrome / buttons that appear near Cycle cards — never treat as stats. */
const RIVEN_NOISE =
  /^(accept|decline|cycle|kuva|confirm|cancel|riven|keep|take|current|new|reroll|vs|polarity|rank|mr\.?|mastery|disposition|ok|yes|no)$/i

function getScratchPath() {
  if (!paddleScratchPath) {
    paddleScratchPath = path.join(os.tmpdir(), `everything-warframe-paddle-${process.pid}.png`)
  }
  return paddleScratchPath
}

/** Briefly raise priority while OCR runs so Warframe doesn't starve us. */
export async function withOcrPriority<T>(fn: () => Promise<T>): Promise<T> {
  ocrPriorityDepth += 1
  if (ocrPriorityDepth === 1) {
    try {
      os.setPriority(os.constants.priority.PRIORITY_ABOVE_NORMAL)
    } catch {
      try {
        os.setPriority(os.constants.priority.PRIORITY_NORMAL)
      } catch {
        // ignore
      }
    }
  }
  try {
    return await fn()
  } finally {
    ocrPriorityDepth -= 1
    if (ocrPriorityDepth === 0) {
      try {
        os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL)
      } catch {
        // ignore
      }
    }
  }
}

async function createPaddleInstance(create: NonNullable<PaddleModule['create']>): Promise<PaddleOcr> {
  return create()
}

async function loadPaddlePool(): Promise<PaddleOcr[]> {
  if (paddlePool.length) return paddlePool
  if (paddleFailed) return []
  if (!paddleLoading) {
    paddleLoading = (async () => {
      try {
        let mod: PaddleModule
        try {
          mod = nodeRequire('@repeato/ocr') as PaddleModule
        } catch {
          mod = (await import('@repeato/ocr')) as PaddleModule
        }
        const create = mod.create || mod.default?.create
        if (!create) throw new Error('@repeato/ocr create() missing')

        const first = await createPaddleInstance(create)
        const pool: PaddleOcr[] = [first]
        // Second instance enables concurrent relic/riven OCR.
        // Default dual unless Settings → ocrPoolSize is 1 (or EW_OCR_POOL=1).
        let wantDual = process.env.EW_OCR_POOL === '2'
        if (process.env.EW_OCR_POOL === '1') wantDual = false
        else if (!wantDual) {
          try {
            const { loadSettings } = await import('../settings')
            const s = loadSettings()
            wantDual = s.ocrPoolSize !== 1
          } catch {
            wantDual = true
          }
        }
        if (wantDual) {
          try {
            const second = await createPaddleInstance(create)
            pool.push(second)
          } catch (err) {
            console.warn(
              '[Everything Warframe] Second PaddleOCR instance unavailable — serial detect only',
              err instanceof Error ? err.message : err,
            )
          }
        }
        paddlePool = pool
        paddleAvailable = [...pool]
        console.info(
          `[Everything Warframe] OCR engine: PaddleOCR (PP-OCRv4 ONNX) ×${pool.length}` +
            (pool.length === 1 ? ' (enable Dual OCR workers in Settings for speed)' : ''),
        )
        return pool
      } catch (err) {
        paddleFailed = true
        console.warn(
          '[Everything Warframe] PaddleOCR unavailable — falling back to Tesseract',
          err instanceof Error ? err.message : err,
        )
        return []
      }
    })()
  }
  return paddleLoading
}

async function acquirePaddle(): Promise<PaddleOcr | null> {
  const pool = await loadPaddlePool()
  if (!pool.length) return null
  const free = paddleAvailable.pop()
  if (free) return free
  return new Promise<PaddleOcr>((resolve) => {
    paddleWaiters.push(resolve)
  })
}

function releasePaddle(engine: PaddleOcr) {
  const waiter = paddleWaiters.shift()
  if (waiter) {
    waiter(engine)
    return
  }
  paddleAvailable.push(engine)
}

async function withPaddleSlot<T>(fn: (engine: PaddleOcr) => Promise<T>): Promise<T> {
  const engine = await acquirePaddle()
  if (!engine) throw new Error('PaddleOCR unavailable')
  try {
    return await fn(engine)
  } finally {
    releasePaddle(engine)
  }
}

async function getTessWorker(): Promise<Worker> {
  if (tessWorker) return tessWorker
  if (!tessLoading) {
    tessLoading = (async () => {
      const cachePath = path.join(app.getPath('userData'), 'tesseract-cache')
      const w = await createWorker('eng', 1, {
        cachePath,
        logger: () => {},
      })
      await w.setParameters({
        tessedit_char_whitelist: RELIC_WHITELIST,
      })
      tessWorker = w
      return w
    })()
  }
  return tessLoading
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

async function pngToRaw(png: Buffer): Promise<ImageRawData> {
  try {
    const sharp = nodeRequire('sharp') as typeof import('sharp')
    const { data, info } = await sharp(png)
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return {
      data: new Uint8Array(data),
      width: info.width,
      height: info.height,
    }
  } catch {
    const img = nativeImage.createFromBuffer(png)
    const { width, height } = img.getSize()
    const bgra = Buffer.from(img.toBitmap())
    const rgba = new Uint8Array(width * height * 4)
    for (let i = 0, j = 0; i + 3 < bgra.length; i += 4, j += 4) {
      rgba[j] = bgra[i + 2]
      rgba[j + 1] = bgra[i + 1]
      rgba[j + 2] = bgra[i]
      rgba[j + 3] = bgra[i + 3]
    }
    return { data: rgba, width, height }
  }
}

/** Prep a riven card → raw RGBA for Paddle (no PNG round-trip). */
async function prepareRivenRaw(
  png: Buffer,
  mode: 'normal' | 'harsh' = 'normal',
): Promise<ImageRawData> {
  try {
    const sharp = nodeRequire('sharp') as typeof import('sharp')
    // Avoid a separate metadata() round-trip — resize by factor from pipeline input.
    let pipeline = sharp(png).grayscale().normalize()
    if (mode === 'harsh') {
      pipeline = pipeline.linear(1.85, -40).threshold(118)
    } else {
      pipeline = pipeline.linear(1.45, -22).sharpen({ sigma: 1.0 })
    }
    const { data, info } = await pipeline
      .extend({
        top: 32,
        bottom: 32,
        left: 32,
        right: 32,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .resize({ width: 1040, kernel: 'lanczos3' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return {
      data: new Uint8Array(data),
      width: info.width,
      height: info.height,
    }
  } catch (err) {
    console.warn(
      '[Everything Warframe] sharp unavailable for riven prep — using native contrast fallback',
      err instanceof Error ? err.message : err,
    )
    return pngToRaw(nativeContrastPrep(png, { scale: 2.6, harsh: mode === 'harsh' }))
  }
}

/** Prep relic name crop → raw RGBA for Paddle (no PNG encode/decode). */
async function prepareRelicRaw(
  png: Buffer,
  scale: number,
  theme?: WfThemeId | null,
): Promise<ImageRawData> {
  const filtered = theme ? filterRelicTextPng(png, theme) : png
  try {
    const sharp = nodeRequire('sharp') as typeof import('sharp')
    let pipeline = sharp(filtered).grayscale().normalize().sharpen({ sigma: 0.6 })
    if (scale !== 1) {
      // Factor resize — skip metadata() round-trip on the hot path.
      pipeline = pipeline.resize({
        width: Math.max(64, Math.round(220 * scale)),
        kernel: 'lanczos3',
      })
    }
    const { data, info } = await pipeline
      .extend({
        top: 16,
        bottom: 16,
        left: 14,
        right: 14,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    return {
      data: new Uint8Array(data),
      width: info.width,
      height: info.height,
    }
  } catch (err) {
    console.warn(
      '[Everything Warframe] sharp unavailable for relic prep — using native contrast fallback',
      err instanceof Error ? err.message : err,
    )
    return pngToRaw(nativeContrastPrep(filtered, { scale: Math.max(1, scale), harsh: true }))
  }
}

/** PNG prep for Tesseract (needs an image buffer). */
async function prepareRelicPng(
  png: Buffer,
  scale: number,
  theme?: WfThemeId | null,
): Promise<Buffer> {
  const filtered = theme ? filterRelicTextPng(png, theme) : png
  try {
    const sharp = nodeRequire('sharp') as typeof import('sharp')
    const meta = await sharp(filtered).metadata()
    const width = meta.width || 0
    let pipeline = sharp(filtered).grayscale().normalize().sharpen({ sigma: 0.6 })
    if (width > 0 && scale !== 1) {
      pipeline = pipeline.resize({
        width: Math.round(width * scale),
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
    return nativeContrastPrep(filtered, { scale: Math.max(1, scale), harsh: true })
  }
}

async function prepareRivenPng(png: Buffer, mode: 'normal' | 'harsh' = 'normal'): Promise<Buffer> {
  try {
    const sharp = nodeRequire('sharp') as typeof import('sharp')
    const meta = await sharp(png).metadata()
    const width = meta.width || 400
    const targetW = Math.max(640, Math.round(width * 2.6))
    let pipeline = sharp(png).grayscale().normalize()
    if (mode === 'harsh') {
      pipeline = pipeline.linear(1.85, -40).threshold(118)
    } else {
      pipeline = pipeline.linear(1.45, -22).sharpen({ sigma: 1.0 })
    }
    return pipeline
      .extend({
        top: 32,
        bottom: 32,
        left: 32,
        right: 32,
        background: { r: 0, g: 0, b: 0, alpha: 1 },
      })
      .resize({ width: targetW, kernel: 'lanczos3' })
      .png()
      .toBuffer()
  } catch {
    return nativeContrastPrep(png, { scale: 2.6, harsh: mode === 'harsh' })
  }
}

/**
 * Merge Paddle boxes into reading-order lines.
 * Same visual row (value + stat name) becomes one string for the parser.
 */
function linesFromPaddle(result: PaddleResult): string[] {
  const texts = (result.texts || []).filter((t) => (t.text || '').trim())
  if (!texts.length && result.rawTexts?.length) {
    return result.rawTexts.map((t) => t.trim()).filter(Boolean)
  }

  const items = texts.map((t) => {
    const box = t.box || []
    const xs = box.map((p) => p[0])
    const ys = box.map((p) => p[1])
    const left = Math.min(...xs, 0)
    const top = Math.min(...ys, 0)
    const bottom = Math.max(...ys, 0)
    return {
      text: (t.text || '').trim(),
      left,
      top,
      midY: (top + bottom) / 2,
      height: Math.max(8, bottom - top),
    }
  })

  items.sort((a, b) => a.midY - b.midY || a.left - b.left)

  const rows: typeof items[] = []
  for (const item of items) {
    const row = rows[rows.length - 1]
    if (!row) {
      rows.push([item])
      continue
    }
    const ref = row[0]
    const threshold = Math.max(12, Math.min(ref.height, item.height) * 0.65)
    if (Math.abs(item.midY - ref.midY) <= threshold) {
      row.push(item)
    } else {
      rows.push([item])
    }
  }

  const lines: string[] = []
  for (const row of rows) {
    row.sort((a, b) => a.left - b.left)
    const joined = row
      .map((c) => c.text)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    if (!joined) continue
    const parts = joined.split(/(?=[+\-]\s*\d)/).map((p) => p.trim()).filter(Boolean)
    if (parts.length > 1 && parts.every((p) => /^[+\-]\s*\d/.test(p))) {
      lines.push(...parts)
    } else {
      lines.push(joined)
    }
  }
  return lines
}

function filterRivenLines(lines: string[]): string[] {
  return lines.filter((line) => {
    const t = line.trim()
    if (!t || t.length < 2) return false
    if (RIVEN_NOISE.test(t)) return false
    if (/^[?\d,\.\s]+$/.test(t) && !/%/.test(t)) return false
    return true
  })
}

function countRivenStatHints(lines: string[]): number {
  return lines.filter(
    (line) => /^[+\-–—]?\s*\d/.test(line) || /%|x\d/i.test(line),
  ).length
}

async function detectRaw(engine: PaddleOcr, raw: ImageRawData): Promise<string[]> {
  try {
    const result = await engine.detect(raw)
    return linesFromPaddle(result)
  } catch {
    // Rare builds only accept file paths — encode once as fallback.
    const file = getScratchPath()
    let png: Buffer
    try {
      const sharp = nodeRequire('sharp') as typeof import('sharp')
      png = await sharp(Buffer.from(raw.data), {
        raw: { width: raw.width, height: raw.height, channels: 4 },
      })
        .png()
        .toBuffer()
    } catch {
      const bgra = Buffer.alloc(raw.width * raw.height * 4)
      for (let i = 0, j = 0; j + 3 < raw.data.length; i += 4, j += 4) {
        bgra[i] = raw.data[j + 2]
        bgra[i + 1] = raw.data[j + 1]
        bgra[i + 2] = raw.data[j]
        bgra[i + 3] = raw.data[j + 3]
      }
      png = nativeImage
        .createFromBitmap(bgra, { width: raw.width, height: raw.height })
        .toPNG()
    }
    await fs.promises.writeFile(file, png)
    const result = await engine.detect(file)
    return linesFromPaddle(result)
  }
}

async function recognizeRelicsTess(
  images: Buffer[],
  theme?: WfThemeId | null,
): Promise<string[]> {
  const w = await getTessWorker()
  await w.setParameters({
    tessedit_char_whitelist: RELIC_WHITELIST,
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
  })
  const names: string[] = []
  for (const png of images) {
    const prepared = await prepareRelicPng(png, 2.0, theme)
    const result = await w.recognize(prepared)
    const text = (result.data.text || '')
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .join(' ')
      .replace(/\s+/g, ' ')
      .trim()
    names.push(text)
  }
  return names
}

async function recognizeRivensTess(images: Buffer[]): Promise<string[]> {
  const w = await getTessWorker()
  await w.setParameters({
    tessedit_char_whitelist: RIVEN_WHITELIST,
    tessedit_pageseg_mode: PSM.SINGLE_BLOCK,
  })
  const blocks: string[] = []
  for (const png of images) {
    const prepared = await prepareRivenPng(png)
    const result = await w.recognize(prepared)
    const text = filterRivenLines(
      (result.data.text || '')
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean),
    ).join('\n')
    blocks.push(text)
  }
  await w.setParameters({
    tessedit_char_whitelist: RELIC_WHITELIST,
    tessedit_pageseg_mode: PSM.SINGLE_LINE,
  })
  return blocks
}

/**
 * OCR reward name crops. Pass `theme` (from full-frame detectUiTheme) so
 * prep can isolate UI text like WFInfo / wfinfo-ng.
 */
export async function recognizeRewardNames(
  images: Buffer[],
  theme?: WfThemeId | null,
): Promise<string[]> {
  return withOcrPriority(async () => {
    const pool = await loadPaddlePool()
    if (!pool.length) return recognizeRelicsTess(images, theme)

    return Promise.all(
      images.map(async (png) => {
        const prepared = await prepareRelicRaw(png, 2.0, theme)
        const lines = await withPaddleSlot((engine) => detectRaw(engine, prepared))
        return lines.join(' ').replace(/\s+/g, ' ').trim()
      }),
    )
  })
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

async function rivenStatsBandPasses(
  png: Buffer,
  bands: ReadonlyArray<{ top: number; height: number }>,
  prep: 'normal' | 'harsh' | 'both',
): Promise<string[][]> {
  const passes: string[][] = []
  try {
    const sharp = nodeRequire('sharp') as typeof import('sharp')
    const meta = await sharp(png).metadata()
    const w = meta.width || 0
    const h = meta.height || 0
    if (w <= 20 || h <= 20) return passes
    for (const band of bands) {
      const statsPng = await sharp(png)
        .extract({
          left: Math.round(w * 0.015),
          top: Math.round(h * band.top),
          width: Math.round(w * 0.97),
          height: Math.round(h * band.height),
        })
        .toBuffer()
      if (prep === 'normal' || prep === 'both') {
        const statsPrep = await prepareRivenRaw(statsPng, 'normal')
        passes.push(
          filterRivenLines(await withPaddleSlot((engine) => detectRaw(engine, statsPrep))),
        )
      }
      if (prep === 'harsh' || prep === 'both') {
        const statsHarsh = await prepareRivenRaw(statsPng, 'harsh')
        passes.push(
          filterRivenLines(await withPaddleSlot((engine) => detectRaw(engine, statsHarsh))),
        )
      }
    }
  } catch {
    // stats band optional
  }
  return passes
}

/**
 * OCR each full riven card independently (current / reroll).
 * Fast path: one normal full-card pass; harsh only if that read looks weak.
 * Deep: adds harsh + stats-band crops (caller uses when parse is still weak).
 */
export async function recognizeRivenBlocks(
  images: Buffer[],
  opts?: { deep?: boolean },
): Promise<string[]> {
  return withOcrPriority(async () => {
    const pool = await loadPaddlePool()
    if (!pool.length) return recognizeRivensTess(images)

    const deep = opts?.deep === true

    const readOne = async (png: Buffer): Promise<string> => {
      const passes: string[][] = []

      const fullPrep = await prepareRivenRaw(png, 'normal')
      const normalLines = filterRivenLines(
        await withPaddleSlot((engine) => detectRaw(engine, fullPrep)),
      )
      passes.push(normalLines)

      const weakNormal = countRivenStatHints(normalLines) < 2
      if (deep || weakNormal) {
        const harshPrep = await prepareRivenRaw(png, 'harsh')
        passes.push(
          filterRivenLines(await withPaddleSlot((engine) => detectRaw(engine, harshPrep))),
        )
      }

      if (deep) {
        const bandPasses = await rivenStatsBandPasses(
          png,
          [
            { top: 0.3, height: 0.55 },
            { top: 0.42, height: 0.48 },
          ],
          'both',
        )
        for (const lines of bandPasses) {
          passes.push(
            lines.filter((line) => /^[+\-–—]?\s*\d/.test(line) || /%|x\d/i.test(line)),
          )
        }
      }

      return mergeRivenPasses(passes)
    }

    // Cards prep+detect can overlap across the pool (2 engines).
    return Promise.all(images.map((png) => readOne(png)))
  })
}

function tinyWarmupRaw(): ImageRawData {
  const w = 64
  const h = 24
  const data = new Uint8Array(w * h * 4)
  data.fill(255)
  for (let y = 6; y < 18; y++) {
    for (let x = 20; x < 44; x++) {
      const i = (y * w + x) * 4
      data[i] = data[i + 1] = data[i + 2] = 20
      data[i + 3] = 255
    }
  }
  return { data, width: w, height: h }
}

export async function warmupOcr(): Promise<void> {
  const pool = await loadPaddlePool()
  if (pool.length) {
    try {
      const raw = tinyWarmupRaw()
      await Promise.all(pool.map((engine) => detectRaw(engine, raw)))
      console.info(`[Everything Warframe] OCR warmup: Paddle ready ×${pool.length}`)
    } catch (err) {
      console.warn(
        '[Everything Warframe] OCR warmup detect skipped',
        err instanceof Error ? err.message : err,
      )
    }
    return
  }
  await getTessWorker()
  console.info('[Everything Warframe] OCR warmup: Tesseract ready')
}

export async function shutdownOcr(): Promise<void> {
  try {
    const mod = nodeRequire('@repeato/ocr') as PaddleModule
    await mod.releaseAll?.()
  } catch {
    // ignore
  }
  paddlePool = []
  paddleAvailable = []
  paddleWaiters.length = 0
  paddleLoading = null
  if (paddleScratchPath) {
    try {
      await fs.promises.unlink(paddleScratchPath)
    } catch {
      // ignore
    }
    paddleScratchPath = null
  }
  if (tessWorker) {
    await tessWorker.terminate().catch(() => {})
    tessWorker = null
    tessLoading = null
  }
}
