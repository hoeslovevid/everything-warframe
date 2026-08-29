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

function themeVoteWeights(
  bitmap: Buffer,
  width: number,
  height: number,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
): Map<WfThemeId, number> {
  const weights = new Map<WfThemeId, number>()
  for (const id of THEME_IDS) weights.set(id, 0)

  const stepY = Math.max(1, Math.round((y1 - y0) / 40))
  const stepX = Math.max(1, Math.round((x1 - x0) / 80))
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * width + x) * 4
      const b = bitmap[i]
      const g = bitmap[i + 1]
      const r = bitmap[i + 2]
      // Skip near-black panel pixels — they don't vote for a theme.
      if (r + g + b < 90) continue
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
      // Prefer saturated mid/high pixels (UI glyphs) over muddy environment fills.
      const maxc = Math.max(r, g, b)
      const minc = Math.min(r, g, b)
      const satBoost = maxc - minc > 40 ? 1.6 : 0.55
      weights.set(best, (weights.get(best) || 0) + (satBoost / Math.pow(1 + bestD / 255, 4)))
    }
  }
  return weights
}

/** Name-band sample window — avoid Orokin/tileset backgrounds biasing theme detect. */
function rewardNameBandBounds(width: number, height: number) {
  const screenScaling = width * 9 > height * 16 ? height / 1080 : width / 1920
  const mostWidth = 968 * screenScaling
  const lineHeight = 48 * screenScaling
  const mostTop = height / 2 - (316 - 235 + 48) * screenScaling
  const y0 = Math.max(0, Math.round(mostTop + lineHeight * 0.05))
  const y1 = Math.min(height, Math.round(mostTop + lineHeight * 2.1))
  const x0 = Math.max(0, Math.round(width / 2 - mostWidth / 2))
  const x1 = Math.min(width, Math.round(width / 2 + mostWidth / 2))
  return { x0, x1, y0, y1 }
}

function estimateThemeKeepRatio(
  bitmap: Buffer,
  width: number,
  height: number,
  theme: WfThemeId,
  y0: number,
  y1: number,
  x0: number,
  x1: number,
): number {
  let kept = 0
  let samples = 0
  const stepY = Math.max(1, Math.round((y1 - y0) / 24))
  const stepX = Math.max(1, Math.round((x1 - x0) / 48))
  for (let y = y0; y < y1; y += stepY) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * width + x) * 4
      samples += 1
      if (themeKeepsPixel(theme, bitmap[i + 2], bitmap[i + 1], bitmap[i])) kept += 1
    }
  }
  return samples ? kept / samples : 0
}

/**
 * Sample the reward *name band* (not the full frame) and vote for the UI theme.
 * Full-frame voting used to pick Orokin/tileset colors and strip orange reward text.
 * Prefers themes that isolate a sparse glyph mask (~0.5–10% keep) over environment fills.
 */
export function detectUiTheme(png: Buffer): WfThemeId {
  const img = nativeImage.createFromBuffer(png)
  const { width, height } = img.getSize()
  if (width < 64 || height < 64) return 'Lotus'

  const bitmap = img.toBitmap()
  const { x0, x1, y0, y1 } = rewardNameBandBounds(width, height)
  const weights = themeVoteWeights(bitmap, width, height, y0, y1, x0, x1)
  const ordered = [...THEME_IDS].sort(
    (a, b) => (weights.get(b) || 0) - (weights.get(a) || 0),
  )

  for (const id of ordered.slice(0, 8)) {
    const ratio = estimateThemeKeepRatio(bitmap, width, height, id, y0, y1, x0, x1)
    if (ratio >= 0.005 && ratio <= 0.1) return id
  }

  // Warm UI themes often match orange/gold reward text when tileset gold wins the vote.
  const warmPreferred: WfThemeId[] = [
    'Zephyr',
    'Grineer',
    'Baruuk',
    'Legacy',
    'Vitruvian',
    'Lotus',
  ]
  for (const id of warmPreferred) {
    const ratio = estimateThemeKeepRatio(bitmap, width, height, id, y0, y1, x0, x1)
    if (ratio >= 0.005 && ratio <= 0.1) return id
  }

  return ordered[0] || 'Lotus'
}

/** Top-N theme votes (highest weight first) — used for OCR fallback retries. */
export function rankUiThemes(png: Buffer, topN = 3): WfThemeId[] {
  const img = nativeImage.createFromBuffer(png)
  const { width, height } = img.getSize()
  if (width < 64 || height < 64) return ['Lotus']

  const bitmap = img.toBitmap()
  const { x0, x1, y0, y1 } = rewardNameBandBounds(width, height)
  const weights = themeVoteWeights(bitmap, width, height, y0, y1, x0, x1)

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

  // Too few text pixels, or too many (wrong theme matching environment gold) →
  // warm/bright glyph isolation. Orange UI text is often ~gray 110–140 so a
  // plain luminance≥168 threshold used to wipe the names.
  if (kept < total * 0.004 || kept > total * 0.12) {
    for (let i = 0; i + 3 < src.length; i += 4) {
      const b = src[i]
      const g = src[i + 1]
      const r = src[i + 2]
      const gray = (r * 299 + g * 587 + b * 114) / 1000
      const maxc = Math.max(r, g, b)
      const minc = Math.min(r, g, b)
      const warmGlyph = maxc >= 140 && maxc - minc >= 28 && r >= g && r > b
      const brightGlyph = gray >= 168
      const keep = warmGlyph || brightGlyph
      const v = keep ? 0 : 255
      out[i] = out[i + 1] = out[i + 2] = v
      out[i + 3] = 255
    }
  }

  return nativeImage.createFromBitmap(out, { width, height }).toPNG()
}

/**
 * Isolate Riven card UI text for OCR (black glyphs on white).
 * Keeps lavender titles AND pale stat lines; drops warm art.
 * Cycle captures are often dim (gray ~75–140) — do not require bright whites.
 */
export function filterRivenTextPng(png: Buffer): Buffer {
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
    const gray = (r * 299 + g * 587 + b * 114) / 1000
    const maxc = Math.max(r, g, b)
    const minc = Math.min(r, g, b)
    const sat = maxc - minc
    const warmArt = r > b + 24 && r >= g + 4 && maxc >= 100 && sat >= 28
    // Title: dim-to-bright lavender (b-biased), common on Cycle cards.
    const lavender =
      !warmArt &&
      gray >= 68 &&
      maxc >= 78 &&
      b >= r + 4 &&
      b + 8 >= g &&
      sat >= 12
    // Stats: pale / cool-gray (often dimmer than title).
    const paleStat =
      !warmArt && gray >= 78 && gray <= 210 && sat <= 48 && Math.abs(b - r) <= 28
    const coolBright = !warmArt && gray >= 120 && b >= r - 18
    const keep = lavender || paleStat || coolBright
    if (keep) kept += 1
    const v = keep ? 0 : 255
    out[i] = out[i + 1] = out[i + 2] = v
    out[i + 3] = 255
  }

  // Too sparse → any non-warm mid-bright pixel.
  if (kept < total * 0.01) {
    kept = 0
    for (let i = 0; i + 3 < src.length; i += 4) {
      const b = src[i]
      const g = src[i + 1]
      const r = src[i + 2]
      const gray = (r * 299 + g * 587 + b * 114) / 1000
      const warmArt = r > b + 24 && r >= g + 4 && Math.max(r, g, b) - Math.min(r, g, b) >= 28
      const keep = !warmArt && gray >= 72
      if (keep) kept += 1
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

