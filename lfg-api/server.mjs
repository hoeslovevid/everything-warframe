/**
 * Everything Warframe — LFG hub API.
 * Run: node lfg-api/server.mjs
 * Env: PORT=17864  LFG_DATA=/data/lfg.sqlite  LFG_DATA_DIR=/data  LFG_ORIGIN=*
 *      DISCORD_BOT_TOKEN (+ optional DISCORD_CHANNEL_ID) — bot; admins use /lfg setup
 *      DISCORD_WEBHOOK_URL — optional hub announce fallback
 *
 * Persist listings on a Railway volume (SQLite). JSON fallback for local Electron.
 */
import http from 'node:http'
import { randomBytes, randomUUID } from 'node:crypto'
import { openStore, resolveDataPath } from './store.mjs'
import {
  closeHubDiscord,
  createHubDiscord,
  updateHubDiscord,
} from './discord-webhook.mjs'

const PORT = Number(process.env.PORT || process.env.LFG_PORT || 17864)
const MAX_LISTINGS = 500
const DEFAULT_TTL_MS = 15 * 60_000
const MAX_TTL_MS = 120 * 60_000
const MIN_TTL_MS = 5 * 60_000
const RATE_WINDOW_MS = 60_000
/** Per-client write budget (create/join/leave/delete). Reads are unlimited — Railway edge already throttles abuse. */
const RATE_MAX_WRITE = 120

/**
 * @typedef {{
 *  id: string
 *  createdAt: string
 *  expiresAt: string
 *  hostIgn: string
 *  hostToken: string
 *  platform: string
 *  region: string
 *  language: string
 *  activity: string
 *  title: string
 *  notes: string
 *  relicKey: string | null
 *  refinement: string | null
 *  shareType: string | null
 *  steelPath: boolean
 *  missionHint: string | null
 *  slotsTotal: number
 *  discordMessageId?: string | null
 *  discordPosts?: Array<{ guildId?: string | null, channelId: string, messageId: string, webhookUrl?: string }>
 *  members: Array<{ ign: string, clientId: string, joinedAt: string, isHost: boolean }>
 * }} Listing
 */

/** @type {Map<string, number[]>} */
const rateHitsWrite = new Map()

/** @type {import('./store.mjs').LfgStore | null} */
let store = null

function clientIp(req) {
  // Railway / reverse proxies put the real client in X-Forwarded-For.
  // Without this, every user shares socket.remoteAddress (= proxy) and trips 429 together.
  const xff = req.headers['x-forwarded-for']
  if (typeof xff === 'string' && xff.trim()) {
    return xff.split(',')[0].trim()
  }
  const real = req.headers['x-real-ip']
  if (typeof real === 'string' && real.trim()) return real.trim()
  return req.socket.remoteAddress || 'local'
}

function rateOk(bucket, ip, max) {
  const now = Date.now()
  const prev = (bucket.get(ip) || []).filter((t) => now - t < RATE_WINDOW_MS)
  if (prev.length >= max) {
    bucket.set(ip, prev)
    return false
  }
  prev.push(now)
  bucket.set(ip, prev)
  return true
}

function publicListing(row) {
  const { hostToken, discordMessageId, discordPosts, ...rest } = row
  return {
    ...rest,
    slotsOpen: Math.max(0, row.slotsTotal - row.members.length),
    whisper: buildWhisper(row),
    inviteHint: `/invite ${row.hostIgn}`,
  }
}

/** Strip secrets then attach whisper for Discord edits. */
function listingForDiscord(row) {
  return {
    ...publicListing(row),
    discordMessageId: row.discordMessageId || null,
    discordPosts: Array.isArray(row.discordPosts) ? row.discordPosts : [],
  }
}

function purgeExpiredWithDiscord() {
  const removed = store.purgeExpired() || []
  for (const row of removed) {
    if (row.discordMessageId || (row.discordPosts && row.discordPosts.length)) {
      closeHubDiscord(listingForDiscord(row))
    }
  }
  return removed.length
}

function buildWhisper(row) {
  const bits = [`LFG ${row.title}`.trim()]
  if (row.relicKey) bits.push(row.relicKey)
  if (row.shareType) bits.push(row.shareType)
  if (row.steelPath) bits.push('SP')
  if (row.missionHint) bits.push(row.missionHint)
  bits.push(`${row.members.length}/${row.slotsTotal}`)
  bits.push(row.platform.toUpperCase())
  bits.push(row.region.toUpperCase())
  return `/w ${row.hostIgn} ${bits.join(' · ')}`.replace(/\s+/g, ' ').trim()
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (c) => chunks.push(c))
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8')
      if (!raw) return resolve({})
      try {
        resolve(JSON.parse(raw))
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

function send(res, status, body) {
  const json = JSON.stringify(body)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': process.env.LFG_ORIGIN || '*',
    'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, X-LFG-Token',
    'Cache-Control': 'no-store',
  })
  res.end(json)
}

function cleanStr(v, max = 80) {
  return String(v || '')
    .replace(/[\u0000-\u001f]/g, '')
    .trim()
    .slice(0, max)
}

function enforceCap() {
  while (store.count() >= MAX_LISTINGS) {
    const oldest = store.list({}).sort(
      (a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt),
    )[0]
    if (!oldest) break
    if (oldest.discordMessageId || (oldest.discordPosts && oldest.discordPosts.length)) {
      closeHubDiscord(listingForDiscord(oldest))
    }
    store.remove(oldest.id)
  }
}

const server = http.createServer(async (req, res) => {
  const ip = clientIp(req)
  if (req.method === 'OPTIONS') {
    send(res, 204, {})
    return
  }

  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`)
    const pathname = url.pathname.replace(/\/+$/, '') || '/'
    const isHealth = req.method === 'GET' && (pathname === '/' || pathname === '/health')
    const isWrite = req.method === 'POST' || req.method === 'DELETE'

    // Reads unlimited; writes capped per real client IP. /health never rate-limited.
    if (isWrite && !rateOk(rateHitsWrite, ip, RATE_MAX_WRITE)) {
      send(res, 429, { error: 'Too many requests — slow down a moment' })
      return
    }

    if (isHealth) {
      purgeExpiredWithDiscord()
      send(res, 200, {
        ok: true,
        service: 'everything-warframe-lfg',
        listings: store.count(),
        store: store.kind,
        dataPath: store.path,
        now: new Date().toISOString(),
      })
      return
    }

    if (req.method === 'GET' && pathname === '/listings') {
      purgeExpiredWithDiscord()
      const rows = store.list({
        region: url.searchParams.get('region') || '',
        platform: url.searchParams.get('platform') || '',
        activity: url.searchParams.get('activity') || '',
        q: url.searchParams.get('q') || '',
      })
      send(res, 200, { listings: rows.map(publicListing) })
      return
    }

    if (req.method === 'POST' && pathname === '/listings') {
      const body = await readBody(req)
      const hostIgn = cleanStr(body.hostIgn || body.ign, 24)
      const clientId = cleanStr(body.clientId, 64)
      if (!hostIgn || hostIgn.length < 2) {
        send(res, 400, { error: 'In-game name required' })
        return
      }
      if (!clientId) {
        send(res, 400, { error: 'clientId required' })
        return
      }
      const ttl = Math.min(
        MAX_TTL_MS,
        Math.max(MIN_TTL_MS, Number(body.ttlMs) || DEFAULT_TTL_MS),
      )
      const slotsTotal = Math.min(4, Math.max(2, Math.floor(Number(body.slotsTotal) || 4)))
      const now = Date.now()
      const id = randomUUID()
      const hostToken = randomBytes(18).toString('hex')
      /** @type {Listing} */
      const row = {
        id,
        createdAt: new Date(now).toISOString(),
        expiresAt: new Date(now + ttl).toISOString(),
        hostIgn,
        hostToken,
        platform: cleanStr(body.platform || 'pc', 16).toLowerCase() || 'pc',
        region: cleanStr(body.region || 'na', 8).toLowerCase() || 'na',
        language: cleanStr(body.language || 'en', 8).toLowerCase() || 'en',
        activity: cleanStr(body.activity || 'custom', 24).toLowerCase() || 'custom',
        title: cleanStr(body.title || 'LFG', 100) || 'LFG',
        notes: cleanStr(body.notes || '', 160),
        relicKey: body.relicKey ? cleanStr(body.relicKey, 40) : null,
        refinement: body.refinement ? cleanStr(body.refinement, 20).toLowerCase() : null,
        shareType: body.shareType ? cleanStr(body.shareType, 20).toLowerCase() : null,
        steelPath: Boolean(body.steelPath),
        missionHint: body.missionHint ? cleanStr(body.missionHint, 60) : null,
        slotsTotal,
        discordMessageId: null,
        discordPosts: [],
        members: [
          {
            ign: hostIgn,
            clientId,
            joinedAt: new Date(now).toISOString(),
            isHost: true,
          },
        ],
      }
      purgeExpiredWithDiscord()
      enforceCap()
      store.upsert(row)
      const pub = publicListing(row)
      send(res, 201, { listing: pub, hostToken })
      void createHubDiscord(pub).then((result) => {
        const messageId = result?.messageId || null
        const posts = result?.posts || []
        if (!messageId && !posts.length) return
        const fresh = store.get(id)
        if (!fresh) return
        fresh.discordMessageId = messageId
        fresh.discordPosts = posts
        store.upsert(fresh)
      })
      return
    }

    const joinMatch = pathname.match(/^\/listings\/([^/]+)\/join$/)
    if (req.method === 'POST' && joinMatch) {
      const row = store.get(joinMatch[1])
      if (!row || Date.parse(row.expiresAt) <= Date.now()) {
        send(res, 404, { error: 'Listing not found or expired' })
        return
      }
      const body = await readBody(req)
      const ign = cleanStr(body.ign || body.hostIgn, 24)
      const clientId = cleanStr(body.clientId, 64)
      if (!ign || !clientId) {
        send(res, 400, { error: 'ign and clientId required' })
        return
      }
      if (row.members.some((m) => m.clientId === clientId)) {
        send(res, 200, { listing: publicListing(row), alreadyJoined: true })
        return
      }
      if (row.members.length >= row.slotsTotal) {
        send(res, 409, { error: 'Squad full' })
        return
      }
      row.members.push({
        ign,
        clientId,
        joinedAt: new Date().toISOString(),
        isHost: false,
      })
      store.upsert(row)
      send(res, 200, { listing: publicListing(row) })
      updateHubDiscord(listingForDiscord(row))
      return
    }

    const leaveMatch = pathname.match(/^\/listings\/([^/]+)\/leave$/)
    if (req.method === 'POST' && leaveMatch) {
      const row = store.get(leaveMatch[1])
      if (!row) {
        send(res, 404, { error: 'Listing not found' })
        return
      }
      const body = await readBody(req)
      const clientId = cleanStr(body.clientId, 64)
      const before = row.members.length
      row.members = row.members.filter((m) => m.clientId !== clientId)
      if (!row.members.length || !row.members.some((m) => m.isHost)) {
        store.remove(row.id)
        closeHubDiscord(listingForDiscord(row))
      } else if (row.members.length !== before) {
        store.upsert(row)
        updateHubDiscord(listingForDiscord(row))
      }
      send(res, 200, { ok: true })
      return
    }

    const extendMatch = pathname.match(/^\/listings\/([^/]+)\/extend$/)
    if (req.method === 'POST' && extendMatch) {
      const row = store.get(extendMatch[1])
      if (!row || Date.parse(row.expiresAt) <= Date.now()) {
        send(res, 404, { error: 'Listing not found or expired' })
        return
      }
      const body = await readBody(req)
      const token =
        cleanStr(req.headers['x-lfg-token'], 80) || cleanStr(body.hostToken, 80)
      if (token !== row.hostToken) {
        send(res, 403, { error: 'Host token required' })
        return
      }
      const addMs = Math.min(
        MAX_TTL_MS,
        Math.max(60_000, Number(body.addMs) || 10 * 60_000),
      )
      const now = Date.now()
      const base = Math.max(Date.parse(row.expiresAt) || now, now)
      const next = Math.min(base + addMs, now + MAX_TTL_MS)
      row.expiresAt = new Date(next).toISOString()
      store.upsert(row)
      send(res, 200, { listing: publicListing(row) })
      return
    }

    const delMatch = pathname.match(/^\/listings\/([^/]+)$/)
    if (req.method === 'DELETE' && delMatch) {
      const row = store.get(delMatch[1])
      if (!row) {
        send(res, 404, { error: 'Listing not found' })
        return
      }
      const token =
        cleanStr(req.headers['x-lfg-token'], 80) ||
        cleanStr((await readBody(req).catch(() => ({}))).hostToken, 80)
      if (token !== row.hostToken) {
        send(res, 403, { error: 'Host token required' })
        return
      }
      store.remove(row.id)
      closeHubDiscord(listingForDiscord(row))
      send(res, 200, { ok: true })
      return
    }

    send(res, 404, { error: 'Not found' })
  } catch (err) {
    send(res, 500, { error: err instanceof Error ? err.message : 'Server error' })
  }
})

async function main() {
  const dataPath = resolveDataPath()
  store = await openStore(dataPath)
  purgeExpiredWithDiscord()
  setInterval(() => {
    if (store) purgeExpiredWithDiscord()
  }, 30_000)

  try {
    const { startDiscordBot, isBotConfigured } = await import('./discord-bot.mjs')
    if (isBotConfigured()) {
      const ok = await startDiscordBot(() => store)
      if (!ok) {
        console.warn('[LFG] Discord bot not ready — webhook fallback still available')
      }
    }
  } catch (err) {
    console.warn(
      '[LFG] Discord bot failed to start:',
      err instanceof Error ? err.message : err,
    )
  }

  server.listen(PORT, '0.0.0.0', () => {
    console.info(`[LFG] Everything Warframe LFG hub on http://0.0.0.0:${PORT}`)
    console.info(`[LFG] Store: ${store.kind} @ ${store.path}`)
  })
}

main().catch((err) => {
  console.error('[LFG] Failed to start:', err)
  process.exit(1)
})
