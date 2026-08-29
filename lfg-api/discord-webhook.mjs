/**
 * Hub Discord notify: prefer bot (Whisper button) when configured, else webhook.
 *
 * Env:
 *   DISCORD_BOT_TOKEN — bot login (channel via /lfg setup or DISCORD_CHANNEL_ID)
 *   DISCORD_CHANNEL_ID — optional fallback channel
 *   DISCORD_WEBHOOK_URL — webhook fallback
 */
import { buildLfgDiscordPayload } from './discord-embed.mjs'
import {
  closeLfgMessage,
  createLfgMessage,
  editLfgMessage,
  isBotReady,
  listConfiguredWebhookUrls,
} from './discord-bot.mjs'

export {
  buildLfgDiscordPayload,
  buildLfgEmbed,
  buildWhisperFromListing,
} from './discord-embed.mjs'

const WEBHOOK_RE = /^\/api\/webhooks\/\d+\/[\w.-]+$/

/**
 * @param {string} url
 * @returns {boolean}
 */
function isValidWebhook(url) {
  if (typeof url !== 'string' || !url.trim()) return false
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

export function isDiscordWebhookUrl(url) {
  return isValidWebhook(url)
}

/**
 * @param {string} webhookUrl
 * @param {string} [messageId]
 */
function messageUrl(webhookUrl, messageId) {
  const base = webhookUrl.trim().replace(/\/+$/, '')
  if (!messageId) return `${base}?wait=true`
  return `${base}/messages/${encodeURIComponent(messageId)}`
}

/**
 * @param {string} webhookUrl
 * @param {object} listing
 */
export async function postLfgToDiscord(webhookUrl, listing) {
  if (!isValidWebhook(webhookUrl)) {
    return { ok: false, error: 'invalid webhook url' }
  }
  const payload = buildLfgDiscordPayload(listing)
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8_000)
  try {
    const res = await fetch(messageUrl(webhookUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      return { ok: false, status: res.status, error: `discord ${res.status}` }
    }
    let messageId
    try {
      const body = await res.json()
      if (body && typeof body.id === 'string') messageId = body.id
    } catch {
      // ignore
    }
    return { ok: true, status: res.status, messageId }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'discord post failed',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {string} webhookUrl
 * @param {string} messageId
 * @param {object} listing
 * @param {{ closed?: boolean }} [opts]
 */
export async function editLfgDiscord(webhookUrl, messageId, listing, opts = {}) {
  if (!isValidWebhook(webhookUrl) || !messageId) {
    return { ok: false, error: 'invalid webhook or message id' }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8_000)
  try {
    const res = await fetch(messageUrl(webhookUrl, messageId), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(buildLfgDiscordPayload(listing, opts)),
      signal: ctrl.signal,
    })
    if (!res.ok) {
      return { ok: false, status: res.status, error: `discord ${res.status}` }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'discord edit failed',
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {string} webhookUrl
 * @param {string} messageId
 */
export async function deleteLfgDiscord(webhookUrl, messageId) {
  if (!isValidWebhook(webhookUrl) || !messageId) {
    return { ok: false, error: 'invalid webhook or message id' }
  }
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 8_000)
  try {
    const res = await fetch(messageUrl(webhookUrl, messageId), {
      method: 'DELETE',
      signal: ctrl.signal,
    })
    if (!res.ok && res.status !== 404) {
      return { ok: false, status: res.status, error: `discord ${res.status}` }
    }
    return { ok: true, status: res.status }
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : 'discord delete failed',
    }
  } finally {
    clearTimeout(timer)
  }
}

function hubWebhookUrl() {
  const url = process.env.DISCORD_WEBHOOK_URL
  return url && String(url).trim() ? String(url).trim() : ''
}

function webhookUrlsForFallback() {
  /** @type {string[]} */
  const urls = []
  const seen = new Set()
  const push = (u) => {
    if (!u || !isValidWebhook(u) || seen.has(u)) return
    seen.add(u)
    urls.push(u)
  }
  push(hubWebhookUrl())
  for (const u of listConfiguredWebhookUrls()) push(u)
  return urls
}

/**
 * @param {object} listing
 * @returns {Promise<{ messageId: string | null, posts: any[] }>}
 */
export async function createHubDiscord(listing) {
  if (isBotReady()) {
    const result = await createLfgMessage(listing)
    if (result.messageId || result.posts?.length) {
      return {
        messageId: result.messageId,
        posts: result.posts || [],
      }
    }
    // members_only filtered every guild — do not spam those channels via webhook
    if (result.filteredOut) {
      return { messageId: null, posts: [] }
    }
    console.warn('[lfg-api] Discord bot create returned no posts; trying webhook fallback')
  }

  const urls = webhookUrlsForFallback()
  /** @type {any[]} */
  const posts = []
  for (const url of urls) {
    const r = await postLfgToDiscord(url, listing)
    if (r.ok && r.messageId) {
      posts.push({ guildId: null, channelId: 'webhook', messageId: r.messageId, webhookUrl: url })
    } else if (!r.ok) {
      console.warn('[lfg-api] Discord webhook failed:', r.error || r.status)
    }
  }
  return { messageId: posts[0]?.messageId || null, posts }
}

/** Live-update slots/roster on existing Discord message(s). */
export function updateHubDiscord(listing) {
  const hasPosts =
    (Array.isArray(listing?.discordPosts) && listing.discordPosts.length > 0) ||
    listing?.discordMessageId
  if (!hasPosts) return

  if (isBotReady()) {
    void editLfgMessage(listing).then((r) => {
      if (!r.ok) console.warn('[lfg-api] Discord bot edit failed')
    })
    // Also patch webhook-only posts
    for (const p of listing.discordPosts || []) {
      if (p.webhookUrl && p.messageId) {
        void editLfgDiscord(p.webhookUrl, p.messageId, listing)
      }
    }
    return
  }

  for (const p of listing.discordPosts || []) {
    if (p.webhookUrl && p.messageId) {
      void editLfgDiscord(p.webhookUrl, p.messageId, listing)
    }
  }
  const url = hubWebhookUrl()
  if (url && listing.discordMessageId && !(listing.discordPosts || []).length) {
    void editLfgDiscord(url, listing.discordMessageId, listing)
  }
}

/** Mark closed (or delete) when a listing ends. */
export function closeHubDiscord(listing, { deleteMessage = true } = {}) {
  const hasPosts =
    (Array.isArray(listing?.discordPosts) && listing.discordPosts.length > 0) ||
    listing?.discordMessageId
  if (!hasPosts) return

  if (isBotReady()) {
    closeLfgMessage(listing, { deleteMessage })
  }

  void (async () => {
    try {
      for (const p of listing.discordPosts || []) {
        if (!p.webhookUrl || !p.messageId) continue
        await editLfgDiscord(p.webhookUrl, p.messageId, listing, { closed: true })
        if (deleteMessage) {
          await new Promise((r) => setTimeout(r, 2500))
          await deleteLfgDiscord(p.webhookUrl, p.messageId)
        }
      }
      const url = hubWebhookUrl()
      if (
        url &&
        listing.discordMessageId &&
        !(listing.discordPosts || []).some((p) => p.webhookUrl)
      ) {
        await editLfgDiscord(url, listing.discordMessageId, listing, { closed: true })
        if (deleteMessage) {
          await new Promise((r) => setTimeout(r, 2500))
          await deleteLfgDiscord(url, listing.discordMessageId)
        }
      }
    } catch (err) {
      console.warn(
        '[lfg-api] Discord close failed:',
        err instanceof Error ? err.message : err,
      )
    }
  })()
}

/** @deprecated use createHubDiscord */
export function notifyHubDiscord(listing) {
  void createHubDiscord(listing)
}
