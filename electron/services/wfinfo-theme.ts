/**
 * WFInfo / wfinfo-ng style UI theme detection + text-pixel isolation.
 * Keeps only accent-colored text pixels so character art behind blueprints
 * does not poison OCR (the main Linux accuracy win).
 */
import { nativeImage } from 'electron'

export type WfThemeId =
  | 'Vitruvian'
  | 'Stalker'
  | 'Baruuk'
  | 'Corpus'
  | 'Fortuna'
  | 'Grineer'
  | 'Lotus'
  | 'Nidus'
  | 'Orokin'
  | 'Tenno'
  | 'HighContrast'
  | 'Legacy'
  | 'Equinox'
  | 'DarkLotus'
  | 'Zephyr'

export const WF_THEME_IDS: WfThemeId[] = [
  'Vitruvian',
  'Stalker',
  'Baruuk',
  'Corpus',
  'Fortuna',
  'Grineer',
  'Lotus',
  'Nidus',
  'Orokin',
  'Tenno',
  'HighContrast',
  'Legacy',
  'Equinox',
  'DarkLotus',
  'Zephyr',
]

type Rgb = [number, number, number]

/** Primary / secondary UI text colors used by Warframe themes (WFInfo table). */
const THEME_COLORS: Record<WfThemeId, { primary: Rgb; secondary: Rgb }> = {
  Vitruvian: { primary: [190, 169, 102], secondary: [245, 227, 173] },
  Stalker: { primary: [153, 31, 35], secondary: [255, 61, 51] },
  Baruuk: { primary: [238, 193, 105], secondary: [236, 211, 162] },
  Corpus: { primary: [35, 201, 245], secondary: [111, 229, 253] },
  Fortuna: { primary: [57, 105, 192], secondary: [255, 115, 230] },
  Grineer: { primary: [255, 189, 102], secondary: [255, 224, 153] },
  Lotus: { primary: [36, 184, 242], secondary: [255, 241, 191] },
  Nidus: { primary: [140, 38, 92], secondary: [245, 73, 93] },
  Orokin: { primary: [20, 41, 29], secondary: [178, 125, 5] },
  Tenno: { primary: [9, 78, 106], secondary: [6, 106, 74] },
  HighContrast: { primary: [2, 127, 217], secondary: [255, 255, 0] },
  Legacy: { primary: [255, 255, 255], secondary: [232, 213, 93] },
  Equinox: { primary: [158, 159, 167], secondary: [232, 227, 227] },
  DarkLotus: { primary: [140, 119, 147], secondary: [189, 169, 237] },
  Zephyr: { primary: [253, 132, 2], secondary: [255, 53, 0] },
}

const THEME_IDS = WF_THEME_IDS

function rgbDist(a: Rgb, b: Rgb): number {
  return Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2])
}

function toHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const R = r / 255
  const G = g / 255
  const B = b / 255
  const max = Math.max(R, G, B)
  const min = Math.min(R, G, B)
  const l = (max + min) / 2
  if (max === min) return { h: 0, s: 0, l }
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h = 0
  if (max === R) h = ((G - B) / d + (G < B ? 6 : 0)) / 6
  else if (max === G) h = ((B - R) / d + 2) / 6
  else h = ((R - G) / d + 4) / 6
  return { h: h * 360, s, l }
}

/** True when a pixel matches the active UI theme text color (WFInfo threshold_filter). */
export function themeKeepsPixel(theme: WfThemeId, r: number, g: number, b: number): boolean {
  const { s, l, h } = toHsl(r, g, b)
  if (theme === 'Equinox') return s <= 0.2 && l >= 0.55
  if (theme === 'Stalker') {
    return s >= 0.61 && s <= 1 && l >= 0.25 && l <= 0.65 && (h <= 5 || h >= 350)
  }
  if (theme === 'HighContrast') {
    return s >= 0.6 && l >= 0.23 && l <= 0.45 && h >= 200 && h <= 215
  }

  const colors = THEME_COLORS[theme]
  // Practical RGB distance (wfinfo-ng's <0.2 on float RGB is too strict in practice).
  const maxDist = theme === 'Legacy' ? 90 : 55
  return (
    rgbDist([r, g, b], colors.primary) <= maxDist ||
    rgbDist([r, g, b], colors.secondary) <= maxDist
  )
}

/**
 * Sample the left/center reward strip and vote for the closest Warframe UI theme.
 * Mirrors wfinfo-ng `detect_theme`.
 */
export function detectUiTheme(png: Buffer): WfThemeId {
  const img = nativeImage.createFromBuffer(png)
  const { width, height } = img.getSize()
  if (width < 64 || height < 64) return 'Lotus'

  const bitmap = img.toBitmap()
  // Electron bitmap is BGRA on most platforms.
  const weights = new Map<WfThemeId, number>()
  for (const id of THEME_IDS) weights.set(id, 0)

  const screenScaling = width * 9 > height * 16 ? height / 1080 : width / 1920
  const lineHeight = (48 / 2) * screenScaling
  const mostWidth = 968 * screenScaling
  const minWidth = mostWidth / 4

  const stepY = Math.max(2, Math.round(height / 180))
  const stepX = Math.max(2, Math.round(width / 320))

  for (let y = Math.round(lineHeight); y < height; y += stepY) {
    const perc = (y - lineHeight) / Math.max(1, height - lineHeight)
    const totalWidth = minWidth * perc + minWidth
    const x0 = Math.max(0, Math.round((mostWidth - totalWidth) / 2))
    const x1 = Math.min(width - 1, Math.round(x0 + totalWidth))
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * width + x) * 4
      const b = bitmap[i]
      const g = bitmap[i + 1]
      const r = bitmap[i + 2]
      let best: WfThemeId = 'Lotus'
      let bestD = Infinity
      for (const id of THEME_IDS) {
        const d = Math.min(
          rgbDist([r, g, b], THEME_COLORS[id].primary),
          rgbDist([r, g, b], THEME_COLORS[id].secondary),
        )
        if (d < bestD) {
          bestD = d
          best = id
        }
      }
      weights.set(best, (weights.get(best) || 0) + 1 / Math.pow(1 + bestD / 255, 4))
    }
  }

  let winner: WfThemeId = 'Lotus'
  let bestW = -1
  for (const id of THEME_IDS) {
    const w = weights.get(id) || 0
    if (w > bestW) {
      bestW = w
      winner = id
    }
  }
  return winner
}

/** Top-N theme votes (highest weight first) — used for OCR fallback retries. */
export function rankUiThemes(png: Buffer, topN = 3): WfThemeId[] {
  const img = nativeImage.createFromBuffer(png)
  const { width, height } = img.getSize()
  if (width < 64 || height < 64) return ['Lotus']

  const bitmap = img.toBitmap()
  const weights = new Map<WfThemeId, number>()
  for (const id of THEME_IDS) weights.set(id, 0)

  const screenScaling = width * 9 > height * 16 ? height / 1080 : width / 1920
  const lineHeight = (48 / 2) * screenScaling
  const mostWidth = 968 * screenScaling
  const minWidth = mostWidth / 4

  const stepY = Math.max(2, Math.round(height / 180))
  const stepX = Math.max(2, Math.round(width / 320))

  for (let y = Math.round(lineHeight); y < height; y += stepY) {
    const perc = (y - lineHeight) / Math.max(1, height - lineHeight)
    const totalWidth = minWidth * perc + minWidth
    const x0 = Math.max(0, Math.round((mostWidth - totalWidth) / 2))
    const x1 = Math.min(width - 1, Math.round(x0 + totalWidth))
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * width + x) * 4
      const b = bitmap[i]
      const g = bitmap[i + 1]
      const r = bitmap[i + 2]
      let best: WfThemeId = 'Lotus'
      let bestD = Infinity
      for (const id of THEME_IDS) {
        const d = Math.min(
          rgbDist([r, g, b], THEME_COLORS[id].primary),
          rgbDist([r, g, b], THEME_COLORS[id].secondary),
        )
        if (d < bestD) {
          bestD = d
          best = id
        }
      }
      weights.set(best, (weights.get(best) || 0) + 1 / Math.pow(1 + bestD / 255, 4))
    }
  }

  return [...THEME_IDS]
    .sort((a, b) => (weights.get(b) || 0) - (weights.get(a) || 0))
    .slice(0, Math.max(1, topN))
}

/**
 * WFInfo-style filter: theme text → black, everything else → white.
 * Falls back to bright-luminance isolation when too few theme pixels survive
 * (common when the UI theme guess is slightly off).
 */
export function filterRelicTextPng(png: Buffer, theme: WfThemeId): Buffer {
  const img = nativeImage.createFromBuffer(png)
  const { width, height } = img.getSize()
  if (width < 8 || height < 8) return png

  const src = Buffer.from(img.toBitmap())
  const out = Buffer.alloc(src.length)
  let kept = 0
  const total = width * height

  for (let i = 0; i + 3 < src.length; i += 4) {
    const b = src[i]
    const g = src[i + 1]
    const r = src[i + 2]
    const keep = themeKeepsPixel(theme, r, g, b)
    if (keep) kept += 1
    const v = keep ? 0 : 255
    out[i] = out[i + 1] = out[i + 2] = v
    out[i + 3] = 255
  }

  // Too few text pixels → luminance fallback (light UI text on dark panels).
  if (kept < total * 0.004 || kept > total * 0.55) {
    for (let i = 0; i + 3 < src.length; i += 4) {
      const b = src[i]
      const g = src[i + 1]
      const r = src[i + 2]
      const gray = (r * 299 + g * 587 + b * 114) / 1000
      const keep = gray >= 168
      const v = keep ? 0 : 255
      out[i] = out[i + 1] = out[i + 2] = v
      out[i + 3] = 255
    }
  }

  return nativeImage.createFromBitmap(out, { width, height }).toPNG()
}

/**
 * WFInfo-style 3-vs-4 player detect on the reward name strip.
 * Uses a cosine weight across the filtered text band; odd peaks → 3 players.
 */
export function detectRewardPlayerCount(fullPng: Buffer, theme: WfThemeId): 3 | 4 {
  const filtered = filterRelicTextPng(fullPng, theme)
  const img = nativeImage.createFromBuffer(filtered)
  const { width, height } = img.getSize()
  if (width < 64 || height < 64) return 4

  const screenScaling = width * 9 > height * 16 ? height / 1080 : width / 1920
  const mostWidth = Math.round(968 * screenScaling)
  const mostLeft = Math.max(0, Math.round(width / 2 - mostWidth / 2))
  const mostTop = Math.max(
    0,
    Math.round(height / 2 - (316 - 235 + 48) * screenScaling),
  )
  const mostBot = Math.min(
    height,
    Math.round(height / 2 - (316 - 235) * screenScaling * 0.5),
  )
  const bandH = Math.max(8, mostBot - mostTop)
  const bitmap = img.toBitmap()

  let totalEven = 0
  let totalOdd = 0
  const right = Math.min(width, mostLeft + mostWidth)
  for (let x = mostLeft; x < right; x++) {
    let count = 0
    for (let y = mostTop; y < mostTop + bandH; y++) {
      const i = (y * width + x) * 4
      // Black text on white after filter
      if (bitmap[i] < 40 && bitmap[i + 1] < 40 && bitmap[i + 2] < 40) count += 1
    }
    count = Math.min(count, Math.floor(bandH / 3))
    const cosine = Math.cos((8 * (x - mostLeft) * Math.PI) / Math.max(1, mostWidth))
    const weight = Math.pow(cosine, 3) * count
    if (cosine < 0) totalEven -= weight
    else if (cosine > 0) totalOdd += weight
  }

  if (totalEven === 0 && totalOdd === 0) return 4
  return totalOdd > totalEven ? 3 : 4
}

