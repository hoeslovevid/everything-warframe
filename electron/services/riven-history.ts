/**
 * Persist recent riven compare scans for history + plat trend.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type {
  RivenHistoryEntry,
  RivenHistoryResult,
  RivenRoll,
  RivenScanState,
  RivenStatLine,
} from '../../shared/types'

const MAX_ENTRIES = 40

function formatStat(stat: RivenStatLine): string {
  const neg = stat.negative || stat.value < 0
  const abs = Math.abs(stat.value)
  if (stat.name.startsWith('damage to ') && stat.unit === '%') {
    const mult = 1 + abs / 100
    return `${neg ? '-' : ''}x${Number(mult.toFixed(2))}`
  }
  return `${neg ? '-' : '+'}${abs}${stat.unit === '%' ? '%' : ''}`
}

function historyPath() {
  return path.join(app.getPath('userData'), 'riven-history.json')
}

function loadRaw(): RivenHistoryEntry[] {
  try {
    const file = historyPath()
    if (!fs.existsSync(file)) return []
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: RivenHistoryEntry[] }
    return Array.isArray(raw.entries) ? raw.entries : []
  } catch {
    return []
  }
}

function saveRaw(entries: RivenHistoryEntry[]) {
  try {
    fs.mkdirSync(path.dirname(historyPath()), { recursive: true })
    fs.writeFileSync(historyPath(), JSON.stringify({ entries }, null, 0), 'utf8')
  } catch {
    // ignore disk errors
  }
}

function statsSummary(roll: RivenRoll): string {
  return roll.stats.map(formatStat).filter(Boolean).slice(0, 4).join(' ')
}

function entryFromRoll(
  roll: RivenRoll,
  scannedAt: string,
  picked: boolean,
): RivenHistoryEntry {
  return {
    id: `${scannedAt}:${roll.side}:${roll.weapon}`,
    scannedAt,
    weapon: roll.weapon,
    side: roll.side,
    picked,
    score: roll.score,
    tier: roll.tier,
    platinum: roll.platinum ?? null,
    polarity: roll.polarity ?? null,
    marketUrl: roll.marketUrl ?? null,
    statsSummary: statsSummary(roll),
  }
}

export function getRivenHistory(): RivenHistoryResult {
  const entries = loadRaw()
  const platTrend = entries
    .filter((e) => e.picked && e.platinum != null && e.platinum > 0)
    .slice(0, 24)
    .map((e) => ({
      scannedAt: e.scannedAt,
      platinum: e.platinum as number,
      weapon: e.weapon,
    }))
    .reverse()
  return { entries, platTrend }
}

export function clearRivenHistory(): RivenHistoryResult {
  saveRaw([])
  return { entries: [], platTrend: [] }
}

/** Append both sides from a finished scan (idempotent per scannedAt). */
export function recordRivenScan(state: RivenScanState): void {
  if (!state.scannedAt || state.error) return
  if (!state.current && !state.reroll) return

  const pickedSide =
    state.recommendation === 'take'
      ? 'reroll'
      : state.recommendation === 'keep'
        ? 'current'
        : null

  const next: RivenHistoryEntry[] = []
  if (state.current && isCompleteRiven(state.current)) {
    next.push(entryFromRoll(state.current, state.scannedAt, pickedSide === 'current'))
  }
  if (state.reroll && isCompleteRiven(state.reroll)) {
    next.push(entryFromRoll(state.reroll, state.scannedAt, pickedSide === 'reroll'))
  }
  if (!next.length) return

  const prev = loadRaw().filter((e) => e.scannedAt !== state.scannedAt)
  saveRaw([...next, ...prev].slice(0, MAX_ENTRIES))
}

/** Update plat/market fields after async enrich for the same scannedAt. */
export function updateRivenHistoryPrices(state: RivenScanState): void {
  if (!state.scannedAt) return
  const entries = loadRaw()
  let changed = false
  const next = entries.map((e) => {
    if (e.scannedAt !== state.scannedAt) return e
    const roll = e.side === 'current' ? state.current : state.reroll
    if (!roll) return e
    changed = true
    return {
      ...e,
      platinum: roll.platinum ?? e.platinum,
      marketUrl: roll.marketUrl ?? e.marketUrl,
      score: roll.score,
      tier: roll.tier,
      statsSummary: statsSummary(roll) || e.statsSummary,
    }
  })
  if (changed) saveRaw(next)
}
import { isCompleteRiven } from '../../shared/ocr-quality'
