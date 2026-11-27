/** Closed-vocabulary matching that preserves uncertainty between similar rewards. */
type Candidate = { normalized: string; uniqueName: string; name: string }
const GENERIC = new Set(['PRIME', 'BLUEPRINT', 'NEUROPTICS', 'CHASSIS', 'SYSTEMS',
  'BARREL', 'RECEIVER', 'STOCK', 'BLADE', 'HANDLE', 'HILT', 'LINK', 'GRIP', 'STRING',
  'LOWER', 'UPPER', 'LIMB', 'HEAD', 'HARNESS', 'WINGS', 'CEREBRUM', 'CARAPACE'])
const PARTS = new Set(['NEUROPTICS', 'CHASSIS', 'SYSTEMS', 'BARREL', 'RECEIVER',
  'STOCK', 'BLADE', 'HANDLE', 'HILT', 'LINK', 'GRIP', 'STRING'])
const tokenCache = new WeakMap<Candidate, string[]>()

function distance(a: string, b: string): number {
  const row = Array.from({ length: b.length + 1 }, (_, i) => i)
  for (let i = 1; i <= a.length; i++) {
    let prev = row[0]
    row[0] = i
    for (let j = 1; j <= b.length; j++) {
      const old = row[j]
      row[j] = Math.min(row[j] + 1, row[j - 1] + 1, prev + Number(a[i - 1] !== b[j - 1]))
      prev = old
    }
  }
  return row[b.length]
}

function tokenScore(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 4 || b.length < 4) return 0
  const d = distance(a, b)
  if (d <= (Math.max(a.length, b.length) >= 8 ? 2 : 1)) return 1 - d / Math.max(a.length, b.length)
  if (Math.min(a.length, b.length) >= 5 && (a.startsWith(b) || b.startsWith(a))) {
    return Math.min(a.length, b.length) / Math.max(a.length, b.length)
  }
  return 0
}

export function rankCatalogMatch<T extends Candidate>(needle: string, items: T[]): { item: T; score: number } | null {
  const words = needle.split(' ').filter(Boolean)
  if (!words.some((w) => !GENERIC.has(w))) return null
  let best: T | null = null
  let bestScore = 0
  let runnerUp = 0
  for (const item of items) {
    let tokens = tokenCache.get(item)
    if (!tokens) { tokens = item.normalized.split(' ').filter(Boolean); tokenCache.set(item, tokens) }
    // A readable part name must agree: Systems must never become Chassis.
    if (words.some((w) => PARTS.has(w) && !tokens!.includes(w))) continue
    const distinctive = tokens.filter((w) => !GENERIC.has(w))
    if (!distinctive.length || !distinctive.every((w) => words.some((n) => tokenScore(w, n) >= 0.65))) continue
    const used = new Set<number>()
    let sum = 0
    for (const word of tokens) {
      let hit = -1, score = 0
      words.forEach((w, i) => {
        const next = used.has(i) ? 0 : tokenScore(word, w)
        if (next > score) { score = next; hit = i }
      })
      if (hit >= 0) used.add(hit)
      sum += score
    }
    const score = sum / Math.max(words.length, tokens.length)
    if (score > bestScore) {
      runnerUp = best && best.uniqueName !== item.uniqueName ? bestScore : runnerUp
      best = item; bestScore = score
    } else if (best && best.uniqueName !== item.uniqueName) runnerUp = Math.max(runnerUp, score)
  }
  if (!best || bestScore < 0.62) return null
  // An ambiguous crop remains a suggestion; it cannot become a confident price lookup.
  return { item: best, score: bestScore - runnerUp < 0.06 ? Math.min(0.6, bestScore) : bestScore }
}
