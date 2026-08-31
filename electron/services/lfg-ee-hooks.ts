/**
 * EE.log → LFG auto-close / auto-extend for listings this install is hosting.
 */
import { loadSettings, updateSettings } from '../settings'
import { deleteLfg, extendLfg, listLfg } from './lfg-hub'

type BroadcastSettings = (settings: ReturnType<typeof updateSettings>) => void

let broadcastSettings: BroadcastSettings | null = null

export function bindLfgEeHooks(broadcast: BroadcastSettings) {
  broadcastSettings = broadcast
}

export async function onLfgMissionStart() {
  const s = loadSettings()
  if (!s.lfgAutoCloseOnMissionStart) return
  const tokens = s.lfgHostTokens || {}
  const ids = Object.keys(tokens)
  if (!ids.length) return
  for (const id of ids) {
    await deleteLfg({ id, hostToken: tokens[id] }).catch(() => {})
  }
  const nextTokens = { ...tokens }
  for (const id of ids) delete nextTokens[id]
  const next = updateSettings({ lfgHostTokens: nextTokens })
  broadcastSettings?.(next)
  console.info(
    `[Everything Warframe] LFG auto-closed ${ids.length} listing(s) on mission start`,
  )
}

export async function onLfgMissionComplete() {
  const s = loadSettings()
  if (!s.lfgAutoExtendOnMissionComplete) return
  const tokens = s.lfgHostTokens || {}
  const ids = Object.keys(tokens)
  if (!ids.length) return
  const board = await listLfg({}).catch(() => null)
  let extended = 0
  for (const id of ids) {
    const listing = board?.listings?.find((l) => l.id === id)
    if (!listing) continue
    const ttlMs = Date.parse(listing.expiresAt) - Date.now()
    if (ttlMs < 8 * 60_000) {
      const ok = await extendLfg({
        id,
        hostToken: tokens[id],
        addMs: 10 * 60_000,
      }).catch(() => ({ ok: false }))
      if (ok?.ok) extended += 1
    }
  }
  if (extended) {
    console.info(
      `[Everything Warframe] LFG auto-extended ${extended} listing(s) after mission`,
    )
  }
}
