/** Pure recognition policy. Keep decisions testable without Electron or a screen. */
export const RELIC_CONFIDENT_MATCH = 0.82
export const RELIC_MIN_MATCH = 0.62

export type TextReading = { text: string; confidence: number }

/** Horizontal projection of an isolated black-on-white text panel. */
export function findTextRows(bitmap: Uint8Array, width: number, height: number, maxRowFraction = .22): Array<{ top: number; height: number }> {
  if (width < 24 || height < 12 || bitmap.length !== width * height * 4) return []
  const runs: Array<{ top: number; bottom: number }> = []
  let open: { top: number; bottom: number } | null = null
  for (let y = 0; y < height; y++) {
    let ink = 0
    for (let x = 0; x < width; x++) if (bitmap[(y * width + x) * 4] < 100) ink++
    const text = ink >= Math.max(2, width * .012) && ink < width * .72
    if (text) {
      if (!open || y - open.bottom > 3) { open = { top: y, bottom: y }; runs.push(open) }
      else open.bottom = y
    }
  }
  return runs.filter((r) => r.bottom - r.top >= 3 && r.bottom - r.top <= height * maxRowFraction)
    .map((r) => ({ top: Math.max(0, r.top - 3), height: Math.min(height, r.bottom + 4) - Math.max(0, r.top - 3) }))
}

/** Reward crops often include a ducat icon or rarity bar. Keep the text row. */
export function findRelicTextBand(bitmap: Uint8Array, width: number, height: number): { top: number; height: number } | null {
  let best: { top: number; height: number } | null = null
  let bestScore = 0
  for (const row of findTextRows(bitmap, width, height, .65)) {
    let columns = 0
    let glyphRuns = 0
    let previousInk = false
    for (let x = 0; x < width; x++) {
      let ink = 0
      for (let y = row.top; y < row.top + row.height; y++) if (bitmap[(y * width + x) * 4] < 100) ink++
      const hasInk = ink >= Math.max(2, row.height * .1)
      if (hasInk) { columns++; if (!previousInk) glyphRuns++ }
      previousInk = hasInk
    }
    if (columns < width * .15 || glyphRuns < 3) continue
    const center = (row.top + row.height / 2) / height
    const score = Math.min(24, glyphRuns) / 24 * .6 + columns / width * .4 - Math.abs(center - .5) * .05
    if (score > bestScore) { best = row; bestScore = score }
  }
  return best
}

export function preferReading(a: TextReading, b: TextReading): TextReading {
  if (!b.text.trim()) return a
  if (!a.text.trim()) return b
  return b.confidence > a.confidence ? b : a
}

/** A normal unveiled riven has 2–3 positives and at most one negative. */
export function isCompleteRiven(roll: {
  weapon: string
  stats: Array<{ value: number; name: string }>
} | null): boolean {
  if (!roll || roll.weapon === 'Unknown Riven') return false
  if (roll.stats.some((s) => !Number.isFinite(s.value) || s.value === 0 || !s.name.trim())) return false
  const positives = roll.stats.filter((s) => s.value > 0).length
  const negatives = roll.stats.filter((s) => s.value < 0).length
  return positives >= 2 && positives <= 3 && negatives <= 1 &&
    roll.stats.length <= 4 && new Set(roll.stats.map((s) => s.name)).size === roll.stats.length
}
