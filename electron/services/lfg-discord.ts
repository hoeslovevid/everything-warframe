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

function buildPayload(listing: LfgListing, opts: { closed?: boolean } = {}) {
  const closed = Boolean(opts.closed)
  const members = listing.members?.length ?? 1
  const slots = Math.max(2, listing.slotsTotal || 4)
  const full = !closed && members >= slots
  const roster =
    listing.members?.length
      ? listing.members
          .map((m) => String(m.ign || '?').slice(0, 24))
          .join(', ')
          .slice(0, 200)
      : String(listing.hostIgn || '?').slice(0, 24)

  const fields: Array<{ name: string; value: string; inline?: boolean }> = [
    { name: 'Host', value: String(listing.hostIgn || '?').slice(0, 24), inline: true },
    {
      name: 'Activity',
      value: String(listing.activity || 'custom').slice(0, 24),
      inline: true,
    },
    {
      name: 'Slots',
      value: closed ? `Closed · was ${members}/${slots}` : `${members}/${slots}${full ? ' · FULL' : ''}`,
      inline: true,
    },
    { name: 'Roster', value: roster || '—', inline: false },
    {
      name: 'Platform',
      value: String(listing.platform || 'pc').toUpperCase().slice(0, 16),
      inline: true,
    },
    {
      name: 'Region',
      value: String(listing.region || 'na').toUpperCase().slice(0, 8),
      inline: true,
    },
  ]
  if (listing.relicKey) {
    fields.push({
      name: 'Relic',
      value: [listing.relicKey, listing.refinement, listing.shareType]
        .filter(Boolean)
        .join(' · ')
        .slice(0, 100),
      inline: true,
    })
  }
  if (listing.missionHint) {
    fields.push({
      name: 'Mission',
      value: String(listing.missionHint).slice(0, 60),
      inline: true,
    })
  }
  if (listing.steelPath) {
    fields.push({ name: 'Path', value: 'Steel Path', inline: true })
  }

  const descriptionBits: string[] = []
  if (listing.notes) descriptionBits.push(String(listing.notes).slice(0, 160))
  if (!closed && listing.whisper) {
    descriptionBits.push(
      `**Whisper** (select → copy)\n\`${String(listing.whisper).slice(0, 180)}\``,
    )
  }

  const titleBase = String(listing.title || 'LFG').slice(0, 80)
  let title = titleBase
  if (closed) title = `${titleBase} · closed`
  else if (full) title = `${titleBase} · FULL`

  return {
    username: 'Everything Warframe LFG',
    embeds: [
      {
        title: title.slice(0, 100),
        description: descriptionBits.join('\n\n').slice(0, 500) || undefined,
        color: closed ? 0x6b7280 : full ? 0xc45c26 : 0x3d9bb8,
        fields,
        footer: listing.inviteHint
          ? { text: String(listing.inviteHint).slice(0, 100) }
          : undefined,
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
