/**
 * Persist inventory sync diffs so “what changed” survives across sessions.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import type {
  InventoryDiff,
  InventoryDiffHistoryEntry,
  InventoryDiffHistoryResult,
} from '../../shared/types'

const MAX_ENTRIES = 60

function storePath() {
  return path.join(app.getPath('userData'), 'inventory-diff-history.json')
}

function loadRaw(): InventoryDiffHistoryEntry[] {
  try {
    const file = storePath()
    if (!fs.existsSync(file)) return []
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as {
      entries?: InventoryDiffHistoryEntry[]
    }
    return Array.isArray(raw.entries) ? raw.entries : []
  } catch {
    return []
  }
}

function saveRaw(entries: InventoryDiffHistoryEntry[]) {
  try {
    fs.mkdirSync(path.dirname(storePath()), { recursive: true })
    fs.writeFileSync(storePath(), JSON.stringify({ entries }, null, 0), 'utf8')
  } catch {
    // ignore
  }
}

function trimEntry(diff: InventoryDiff): InventoryDiffHistoryEntry {
  const cap = 40
  return {
    id: `${diff.syncedAt}:${Math.random().toString(36).slice(2, 8)}`,
    syncedAt: diff.syncedAt,
    summary: diff.summary,
    added: (diff.added || []).slice(0, cap),
    removed: (diff.removed || []).slice(0, cap),
    changed: (diff.changed || []).slice(0, cap),
  }
}

export function recordInventoryDiffHistory(diff: InventoryDiff | null | undefined) {
  if (!diff) return
  const hasRows =
    (diff.added?.length || 0) + (diff.removed?.length || 0) + (diff.changed?.length || 0) > 0
  if (!hasRows && !diff.summary?.netUnits) return
  const entries = loadRaw()
  entries.unshift(trimEntry(diff))
  while (entries.length > MAX_ENTRIES) entries.pop()
  saveRaw(entries)
}

export function getInventoryDiffHistory(): InventoryDiffHistoryResult {
  return { entries: loadRaw().slice(0, MAX_ENTRIES) }
}

export function clearInventoryDiffHistory(): InventoryDiffHistoryResult {
  saveRaw([])
  return { entries: [] }
}
