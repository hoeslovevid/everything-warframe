/**
 * Local market sold/bought log for simple plat P&L (all-time + this app session).
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type {
  MarketTradeEntry,
  MarketTradeInput,
  MarketTradeLogResult,
} from '../../shared/types'

const MAX_ENTRIES = 200
const sessionStartedAt = new Date().toISOString()

function logPath() {
  return path.join(app.getPath('userData'), 'market-trade-log.json')
}

function loadRaw(): MarketTradeEntry[] {
  try {
    const file = logPath()
    if (!fs.existsSync(file)) return []
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as { entries?: MarketTradeEntry[] }
    return Array.isArray(raw.entries) ? raw.entries : []
  } catch {
    return []
  }
}

function saveRaw(entries: MarketTradeEntry[]) {
  try {
    fs.mkdirSync(path.dirname(logPath()), { recursive: true })
    fs.writeFileSync(logPath(), JSON.stringify({ entries }, null, 0), 'utf8')
  } catch {
    // ignore disk errors
  }
}

function summarize(entries: MarketTradeEntry[]): MarketTradeLogResult {
  let soldPlat = 0
  let boughtPlat = 0
  let sessionSoldPlat = 0
  let sessionBoughtPlat = 0
  const sessionStartMs = Date.parse(sessionStartedAt) || 0
  for (const e of entries) {
    const total = Math.max(0, e.platinum) * Math.max(1, e.quantity)
    if (e.side === 'sell') soldPlat += total
    else boughtPlat += total
    const at = Date.parse(e.at) || 0
    if (at >= sessionStartMs) {
      if (e.side === 'sell') sessionSoldPlat += total
      else sessionBoughtPlat += total
    }
  }
  return {
    entries,
    soldPlat,
    boughtPlat,
    netPlat: soldPlat - boughtPlat,
    sessionStartedAt,
    sessionSoldPlat,
    sessionBoughtPlat,
    sessionNetPlat: sessionSoldPlat - sessionBoughtPlat,
  }
}

export function getMarketTradeLog(): MarketTradeLogResult {
  return summarize(loadRaw())
}

export function addMarketTrade(input: MarketTradeInput): MarketTradeLogResult {
  const itemName = String(input.itemName || '').trim()
  const platinum = Math.floor(Number(input.platinum))
  const quantity = Math.max(1, Math.floor(Number(input.quantity) || 1))
  const side = input.side === 'buy' ? 'buy' : 'sell'
  if (!itemName || !Number.isFinite(platinum) || platinum < 1) {
    return getMarketTradeLog()
  }
  const at = new Date().toISOString()
  const entry: MarketTradeEntry = {
    id: `${at}:${side}:${itemName}:${Math.random().toString(36).slice(2, 8)}`,
    at,
    side,
    itemName,
    platinum,
    quantity,
    note: input.note?.trim() || undefined,
  }
  const next = [entry, ...loadRaw()].slice(0, MAX_ENTRIES)
  saveRaw(next)
  return summarize(next)
}

export function removeMarketTrade(id: string): MarketTradeLogResult {
  const next = loadRaw().filter((e) => e.id !== id)
  saveRaw(next)
  return summarize(next)
}

export function clearMarketTradeLog(): MarketTradeLogResult {
  saveRaw([])
  return summarize([])
}
