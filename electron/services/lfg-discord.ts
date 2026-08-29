import type { LfgListing } from '../../shared/types'
import { loadSettings, updateSettings } from '../settings'

const WEBHOOK_RE = /^\/api\/webhooks\/\d+\/[\w.-]+$/

/** listingId → last synced "members/slots" signature */
const lastSyncedRoster = new Map<string, string>()

export function isDiscordWebhookUrl(url: string): boolean {
  if (!url.trim()) return false
  try {
    const u = new URL(url.trim())
    if (u.protocol !== 'https:') return false
    const host = u.hostname.toLowerCase()
    if (
      host !== 'discord.com' &&
      host !== 'discordapp.com' &&
      !host.endsWith('.discord.com')
    ) {
      return false
    }
    return WEBHOOK_RE.test(u.pathname)
  } catch {
    return false
  }
}

function messageUrl(webhookUrl: string, messageId?: string) {
  const base = webhookUrl.trim().replace(/\/+$/, '')
  if (!messageId) return `${base}?wait=true`
  return `${base}/messages/${encodeURIComponent(messageId)}`
}

function rosterKey(listing: LfgListing) {
  return `${listing.members?.length ?? 0}/${listing.slotsTotal || 4}`
}

const BRAND_ICON_URL =
  'https://cdn.jsdelivr.net/gh/hoeslovevid/everything-warframe@master/resources/icon-256.png'

function slotBar(filled: number, total: number) {
  const n = Math.max(2, Math.min(4, total))
  const f = Math.max(0, Math.min(n, filled))
  return `${'▰'.repeat(f)}${'▱'.repeat(n - f)}  **${f}/${n}**`
}

function activityMeta(activity: string) {
  const a = String(activity || 'custom').toLowerCase()
  const map: Record<string, { label: string; emoji: string; color: number }> = {
    relic: { label: 'Relic', emoji: '◇', color: 0x4a9fd8 },
    fissure: { label: 'Fissure', emoji: '◈', color: 0x6b7fd7 },
    farm: { label: 'Farm', emoji: '▣', color: 0x3dba8c },
    boss: { label: 'Boss', emoji: '⬡', color: 0xd4783c },
    custom: { label: 'Custom', emoji: '◎', color: 0x5a8faf },
  }
  return map[a] || map.custom
}

function buildPayload(listing: LfgListing, opts: { closed?: boolean } = {}) {
  const closed = Boolean(opts.closed)
  const members = listing.members?.length ?? 1
  const slots = Math.max(2, listing.slotsTotal || 4)
  const full = !closed && members >= slots
  const meta = activityMeta(listing.activity)
  const host = String(listing.hostIgn || '?').slice(0, 24)
  const platform = String(listing.platform || 'pc').toUpperCase().slice(0, 16)
  const region = String(listing.region || 'na').toUpperCase().slice(0, 8)

  const rosterLines =
    listing.members?.length
      ? listing.members.map((m) => {
          const ign = String(m.ign || '?').slice(0, 24)
          return m.isHost ? `★ **${ign}** · host` : `• ${ign}`
        })
      : [`★ **${host}** · host`]
  for (let i = rosterLines.length; i < slots; i++) {
    rosterLines.push(`○ _open_`)
  }

  const detailBits = [`${meta.emoji} ${meta.label}`, platform, region]
  if (listing.steelPath) detailBits.push('Steel Path')
  if (listing.relicKey) {
    detailBits.push(
      [listing.relicKey, listing.refinement, listing.shareType].filter(Boolean).join(' · '),
    )
  }
  if (listing.missionHint) detailBits.push(String(listing.missionHint).slice(0, 60))

  const titleBase = String(listing.title || 'Looking for group').slice(0, 70)
  let color = meta.color
  if (closed) color = 0x6b7280
  else if (full) color = 0xd97706

  const statusLine = closed
    ? '**Status** · Closed'
    : full
      ? '**Status** · Full'
      : `**Status** · Open · looking for ${Math.max(0, slots - members)}`

  const descriptionBits = [statusLine]
  if (listing.notes) descriptionBits.push(`\n${String(listing.notes).slice(0, 180)}`)

  const inviteHint = listing.inviteHint || (listing.hostIgn ? `/invite ${listing.hostIgn}` : '')
  const footerParts = []
  if (inviteHint) footerParts.push(inviteHint)
  footerParts.push('Everything Warframe')

  return {
    username: 'Everything Warframe LFG',
    embeds: [
      {
        author: { name: 'Everything Warframe · LFG', icon_url: BRAND_ICON_URL },
        title: titleBase.slice(0, 100),
        description: descriptionBits.join('\n').slice(0, 500) || undefined,
        color,
        thumbnail: { url: BRAND_ICON_URL },
        fields: [
          { name: 'Squad', value: slotBar(members, slots), inline: true },
          { name: 'Details', value: detailBits.join(' · ').slice(0, 200), inline: true },
          { name: 'Roster', value: rosterLines.join('\n').slice(0, 400), inline: false },
        ],
        footer: { text: footerParts.join(' · ').slice(0, 180), icon_url: BRAND_ICON_URL },
        timestamp: listing.createdAt || new Date().toISOString(),
      },
    ],
  }
}

async function fetchDiscord(
  url: string,
  init: RequestInit,
): Promise<{ ok: boolean; status: number; json?: unknown }> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8_000)
  try {
    const res = await fetch(url, { ...init, signal: ctrl.signal })
    let json: unknown
    if (res.ok && res.headers.get('content-type')?.includes('json')) {
      try {
        json = await res.json()
      } catch {
        // ignore
      }
    }
    return { ok: res.ok || res.status === 404, status: res.status, json }
  } finally {
    clearTimeout(timer)
  }
}

/** Post a public LFG listing; returns Discord message id for live edits. */
export async function postPersonalLfgDiscord(
  webhookUrl: string,
  listing: LfgListing,
): Promise<string | null> {
  if (!isDiscordWebhookUrl(webhookUrl)) return null
  try {
    const res = await fetchDiscord(messageUrl(webhookUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(listing)),
    })
    if (!res.ok) {
      console.warn('[lfg] personal Discord webhook failed:', res.status)
      return null
    }
    const id =
      res.json &&
      typeof res.json === 'object' &&
      res.json &&
      'id' in res.json &&
      typeof (res.json as { id: unknown }).id === 'string'
        ? (res.json as { id: string }).id
        : null
    if (id) lastSyncedRoster.set(listing.id, rosterKey(listing))
    return id
  } catch (err) {
    console.warn(
      '[lfg] personal Discord webhook error:',
      err instanceof Error ? err.message : err,
    )
    return null
  }
}

export async function editPersonalLfgDiscord(
  webhookUrl: string,
  messageId: string,
  listing: LfgListing,
  opts: { closed?: boolean } = {},
): Promise<void> {
  if (!isDiscordWebhookUrl(webhookUrl) || !messageId) return
  try {
    const res = await fetchDiscord(messageUrl(webhookUrl, messageId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildPayload(listing, opts)),
    })
    if (!res.ok) {
      console.warn('[lfg] personal Discord edit failed:', res.status)
      return
    }
    if (!opts.closed) lastSyncedRoster.set(listing.id, rosterKey(listing))
  } catch (err) {
    console.warn(
      '[lfg] personal Discord edit error:',
      err instanceof Error ? err.message : err,
    )
  }
}

export async function deletePersonalLfgDiscord(
  webhookUrl: string,
  messageId: string,
): Promise<void> {
  if (!isDiscordWebhookUrl(webhookUrl) || !messageId) return
  try {
    await fetchDiscord(messageUrl(webhookUrl, messageId), { method: 'DELETE' })
  } catch {
    // ignore
  }
}

function rememberMessageId(listingId: string, messageId: string) {
  const s = loadSettings()
  updateSettings({
    lfgDiscordMessageIds: { ...(s.lfgDiscordMessageIds || {}), [listingId]: messageId },
  })
}

function forgetMessageId(listingId: string) {
  const s = loadSettings()
  const next = { ...(s.lfgDiscordMessageIds || {}) }
  if (!(listingId in next)) return
  delete next[listingId]
  lastSyncedRoster.delete(listingId)
  updateSettings({ lfgDiscordMessageIds: next })
}

/** After create: post and store message id. */
export async function notifyPersonalCreate(listing: LfgListing): Promise<void> {
  const s = loadSettings()
  if (!s.lfgDiscordNotifyOnCreate || !s.lfgDiscordWebhookUrl?.trim()) return
  const mid = await postPersonalLfgDiscord(s.lfgDiscordWebhookUrl, listing)
  if (mid) rememberMessageId(listing.id, mid)
}

/** Host closed their squad. */
export async function notifyPersonalClose(listingId: string, listing?: LfgListing | null): Promise<void> {
  const s = loadSettings()
  const mid = s.lfgDiscordMessageIds?.[listingId]
  const url = s.lfgDiscordWebhookUrl?.trim()
  if (!mid || !url) {
    forgetMessageId(listingId)
    return
  }
  if (listing) {
    await editPersonalLfgDiscord(url, mid, listing, { closed: true })
    await new Promise((r) => setTimeout(r, 1500))
  }
  await deletePersonalLfgDiscord(url, mid)
  forgetMessageId(listingId)
}

/**
 * When the board refresh returns listings you host, PATCH Discord if roster changed.
 * Also closes Discord messages for hosted squads that vanished from the board.
 */
export function syncPersonalDiscordFromListings(listings: LfgListing[]): void {
  const s = loadSettings()
  if (!s.lfgDiscordNotifyOnCreate || !s.lfgDiscordWebhookUrl?.trim()) return
  const url = s.lfgDiscordWebhookUrl.trim()
  const tokens = s.lfgHostTokens || {}
  const ids = s.lfgDiscordMessageIds || {}
  const onBoard = new Set(listings.map((l) => l.id))

  for (const listing of listings) {
    if (!tokens[listing.id]) continue
    const mid = ids[listing.id]
    if (!mid) continue
    const key = rosterKey(listing)
    if (lastSyncedRoster.get(listing.id) === key) continue
    void editPersonalLfgDiscord(url, mid, listing)
  }

  for (const listingId of Object.keys(ids)) {
    if (!tokens[listingId]) {
      forgetMessageId(listingId)
      continue
    }
    if (onBoard.has(listingId)) continue
    // Hosted squad gone (closed / expired) — clean Discord
    void (async () => {
      await deletePersonalLfgDiscord(url, ids[listingId])
      forgetMessageId(listingId)
    })()
  }
}
