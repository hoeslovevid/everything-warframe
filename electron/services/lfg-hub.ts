/**
 * Local LFG hub (same protocol as lfg-api/server.mjs) for solo/LAN,
 * plus HTTP client for remote hosted boards.
 *
 * If the hosted Railway URL is blocked by railway-hikari edge (plain-text
 * "rate limited" 429), we automatically fall back to a local hub so LFG
 * still works on this PC until the public domain recovers.
 */
import { spawn } from 'node:child_process'
import type { ChildProcess } from 'node:child_process'
import http from 'node:http'
import https from 'node:https'
import path from 'node:path'
import { app, BrowserWindow } from 'electron'
import { loadSettings } from '../settings'
import type {
  LfgCreateInput,
  LfgDiscordAnnounceResult,
  LfgListing,
  LfgListResult,
  LfgJoinResult,
} from '../../shared/types'
import { DEFAULT_LFG_API_BASE_URL } from '../../shared/types'

const DEFAULT_PORT = 17864
const REMOTE_BLOCK_MS = 10 * 60_000
const REMOTE_PROBE_MS = 60_000

let child: ChildProcess | null = null
let localBaseUrl = `http://127.0.0.1:${DEFAULT_PORT}`
/** When set, skip remote hub until this timestamp (Railway edge 429). */
let remoteBlockedUntil = 0
let lastRemoteProbeAt = 0

function apiScriptPath() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'lfg-api', 'server.mjs')
  }
  return path.join(app.getAppPath(), 'lfg-api', 'server.mjs')
}

function configuredHubSetting(): string {
  return String(loadSettings().lfgApiBaseUrl || '').trim().replace(/\/+$/, '')
}

function wantsLocalOnly(): boolean {
  return configuredHubSetting().toLowerCase() === 'local'
}

/** Remote URL from settings / default, or null when user forced local. */
export function configuredRemoteUrl(): string | null {
  if (wantsLocalOnly()) return null
  const configured = configuredHubSetting()
  if (configured && configured.toLowerCase() !== 'local') return configured
  return DEFAULT_LFG_API_BASE_URL
}

function isRateLimitedError(err: unknown): boolean {
  const status = (err as { status?: number })?.status
  const msg = err instanceof Error ? err.message : String(err || '')
  return status === 429 || /rate\s*limited|too many requests|429/i.test(msg)
}

const EDGE_FALLBACK_WARNING =
  'Community hub rate-limited — using local board. ' +
  'Fix: Railway → Networking → generate a new domain (or add a custom domain), then paste it into Hub URL.'

export function getLfgBaseUrl(): string {
  if (wantsLocalOnly()) return localBaseUrl
  if (Date.now() < remoteBlockedUntil) return localBaseUrl
  return configuredRemoteUrl() || localBaseUrl
}

async function startLocalHub(): Promise<{ ok: boolean; baseUrl: string; error?: string }> {
  if (child && !child.killed) {
    return { ok: true, baseUrl: localBaseUrl }
  }
  try {
    const script = apiScriptPath()
    const dataFile = path.join(app.getPath('userData'), 'lfg.sqlite')
    child = spawn(process.execPath, [script], {
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        PORT: String(DEFAULT_PORT),
        LFG_DATA: dataFile,
        LFG_ORIGIN: '*',
      },
      stdio: 'ignore',
      windowsHide: true,
    })
    child.on('exit', () => {
      child = null
    })
    localBaseUrl = `http://127.0.0.1:${DEFAULT_PORT}`
    await new Promise((r) => setTimeout(r, 400))
    const health = await fetchJson(`${localBaseUrl}/health`).catch(() => null)
    if (!health?.ok) {
      return { ok: false, baseUrl: localBaseUrl, error: 'Local LFG hub did not start' }
    }
    return { ok: true, baseUrl: localBaseUrl }
  } catch (err) {
    return {
      ok: false,
      baseUrl: localBaseUrl,
      error: err instanceof Error ? err.message : 'Failed to start LFG hub',
    }
  }
}

function markRemoteBlocked() {
  remoteBlockedUntil = Date.now() + REMOTE_BLOCK_MS
  lastRemoteProbeAt = Date.now()
}

async function probeRemoteIfDue(remoteUrl: string): Promise<boolean> {
  const now = Date.now()
  if (now < remoteBlockedUntil && now - lastRemoteProbeAt < REMOTE_PROBE_MS) {
    return false
  }
  lastRemoteProbeAt = now
  try {
    await fetchJson(`${remoteUrl}/health`)
    remoteBlockedUntil = 0
    return true
  } catch (err) {
    if (isRateLimitedError(err)) markRemoteBlocked()
    return false
  }
}

/**
 * Resolve which hub to talk to. Spawns local when needed.
 */
export async function ensureLocalLfgHub(): Promise<{
  ok: boolean
  baseUrl: string
  error?: string
  warning?: string
  mode: 'remote' | 'local'
}> {
  if (wantsLocalOnly()) {
    const local = await startLocalHub()
    return { ...local, mode: 'local' }
  }

  const remote = configuredRemoteUrl()!
  if (Date.now() < remoteBlockedUntil) {
    await probeRemoteIfDue(remote)
  }

  if (Date.now() < remoteBlockedUntil) {
    const local = await startLocalHub()
    return {
      ok: local.ok,
      baseUrl: local.baseUrl,
      error: local.error,
      warning: EDGE_FALLBACK_WARNING,
      mode: 'local',
    }
  }

  return { ok: true, baseUrl: remote, mode: 'remote' }
}

export function stopLocalLfgHub() {
  stopLfgEventStream()
  if (child && !child.killed) {
    try {
      child.kill()
    } catch {
      // ignore
    }
  }
  child = null
}

async function fetchJson(url: string, init?: RequestInit): Promise<any> {
  const res = await fetch(url, {
    ...init,
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      ...(init?.headers || {}),
    },
  })
  const text = await res.text()
  let json: any = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }
  if (!res.ok) {
    const status = res.status
    const plain = (text || '').trim()
    const msg =
      json?.error ||
      (status === 429 || /rate\s*limited/i.test(plain)
        ? 'Community hub rate-limited — using local board'
        : `LFG HTTP ${status}`)
    const err = new Error(msg)
    ;(err as any).status = status
    throw err
  }
  return json
}

async function withHubFallback<T>(
  run: (baseUrl: string) => Promise<T>,
): Promise<{ result: T; baseUrl: string; warning?: string }> {
  const hub = await ensureLocalLfgHub()
  if (!hub.ok && hub.mode === 'local') {
    throw new Error(hub.error || 'LFG hub unavailable')
  }
  try {
    const result = await run(hub.baseUrl)
    return { result, baseUrl: hub.baseUrl, warning: hub.warning }
  } catch (err) {
    if (hub.mode === 'remote' && isRateLimitedError(err)) {
      markRemoteBlocked()
      const local = await startLocalHub()
      if (!local.ok) throw err
      const result = await run(local.baseUrl)
      return { result, baseUrl: local.baseUrl, warning: EDGE_FALLBACK_WARNING }
    }
    throw err
  }
}

export async function lfgHealth(): Promise<{
  ok: boolean
  listings?: number
  error?: string
  warning?: string
  baseUrl: string
  discord?: {
    botReady: boolean
    guildCount: number
    membersOnlyGuilds: number
    announceTargets: number
  }
}> {
  try {
    const { result, baseUrl, warning } = await withHubFallback((base) =>
      fetchJson(`${base}/health`),
    )
    return {
      ok: true,
      listings: result.listings,
      baseUrl,
      warning,
      discord: result.discord || undefined,
    }
  } catch (err) {
    return {
      ok: false,
      baseUrl: getLfgBaseUrl(),
      error: err instanceof Error ? err.message : 'Unreachable',
    }
  }
}

export async function listLfg(opts?: {
  region?: string
  platform?: string
  activity?: string
  intent?: string
  q?: string
}): Promise<LfgListResult> {
  const params = new URLSearchParams()
  if (opts?.region) params.set('region', opts.region)
  if (opts?.platform) params.set('platform', opts.platform)
  if (opts?.activity) params.set('activity', opts.activity)
  if (opts?.intent) params.set('intent', opts.intent)
  if (opts?.q) params.set('q', opts.q)
  const qs = params.toString()
  try {
    const { result, baseUrl, warning } = await withHubFallback((base) =>
      fetchJson(`${base}/listings${qs ? `?${qs}` : ''}`),
    )
    const listings = (result.listings || []) as LfgListing[]
    try {
      const { syncPersonalDiscordFromListings } = await import('./lfg-discord')
      syncPersonalDiscordFromListings(listings)
    } catch {
      // ignore
    }
    return {
      listings,
      baseUrl,
      error: null,
      warning: warning || null,
    }
  } catch (err) {
    return {
      listings: [],
      baseUrl: getLfgBaseUrl(),
      error: err instanceof Error ? err.message : 'Failed to list',
      warning: null,
    }
  }
}

export async function createLfg(
  input: LfgCreateInput,
): Promise<{
  ok: boolean
  listing?: LfgListing
  hostToken?: string
  error?: string
  warning?: string
  discord?: LfgDiscordAnnounceResult
}> {
  try {
    const { result, warning } = await withHubFallback((base) =>
      fetchJson(`${base}/listings`, {
        method: 'POST',
        body: JSON.stringify(input),
      }),
    )
    const listing = result.listing as LfgListing | undefined
    if (listing) {
      try {
        const { notifyPersonalCreate } = await import('./lfg-discord')
        void notifyPersonalCreate(listing)
      } catch {
        // ignore notify failures — listing already created
      }
    }
    return {
      ok: true,
      listing,
      hostToken: result.hostToken,
      warning,
      discord: result.discord || undefined,
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Create failed' }
  }
}

export async function joinLfg(input: {
  id: string
  ign: string
  clientId: string
}): Promise<LfgJoinResult> {
  try {
    const { result, warning } = await withHubFallback((base) =>
      fetchJson(`${base}/listings/${encodeURIComponent(input.id)}/join`, {
        method: 'POST',
        body: JSON.stringify({ ign: input.ign, clientId: input.clientId }),
      }),
    )
    return { ok: true, listing: result.listing, error: null, warning: warning || null }
  } catch (err) {
    return {
      ok: false,
      listing: null,
      error: err instanceof Error ? err.message : 'Join failed',
      warning: null,
    }
  }
}

export async function leaveLfg(input: { id: string; clientId: string }): Promise<{ ok: boolean; error?: string }> {
  try {
    await withHubFallback((base) =>
      fetchJson(`${base}/listings/${encodeURIComponent(input.id)}/leave`, {
        method: 'POST',
        body: JSON.stringify({ clientId: input.clientId }),
      }),
    )
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Leave failed' }
  }
}

export async function deleteLfg(input: {
  id: string
  hostToken: string
}): Promise<{ ok: boolean; error?: string }> {
  try {
    await withHubFallback((base) =>
      fetchJson(`${base}/listings/${encodeURIComponent(input.id)}`, {
        method: 'DELETE',
        headers: { 'X-LFG-Token': input.hostToken },
        body: JSON.stringify({ hostToken: input.hostToken }),
      }),
    )
    try {
      const { notifyPersonalClose } = await import('./lfg-discord')
      void notifyPersonalClose(input.id)
    } catch {
      // ignore
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Delete failed' }
  }
}

export async function extendLfg(input: {
  id: string
  hostToken: string
  addMs?: number
}): Promise<{ ok: boolean; listing?: LfgListing; error?: string }> {
  try {
    const { result } = await withHubFallback((base) =>
      fetchJson(`${base}/listings/${encodeURIComponent(input.id)}/extend`, {
        method: 'POST',
        headers: { 'X-LFG-Token': input.hostToken },
        body: JSON.stringify({
          hostToken: input.hostToken,
          addMs: input.addMs ?? 10 * 60_000,
        }),
      }),
    )
    return { ok: true, listing: result.listing as LfgListing }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Extend failed' }
  }
}

export async function reportLfg(input: {
  id: string
  clientId: string
  reason?: string
}): Promise<{ ok: boolean; reportCount?: number; hidden?: boolean; error?: string }> {
  try {
    const { result } = await withHubFallback((base) =>
      fetchJson(`${base}/listings/${encodeURIComponent(input.id)}/report`, {
        method: 'POST',
        body: JSON.stringify({
          clientId: input.clientId,
          reason: input.reason || '',
        }),
      }),
    )
    return {
      ok: true,
      reportCount: result.reportCount,
      hidden: Boolean(result.hidden),
    }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Report failed' }
  }
}

/* ── SSE live events ─────────────────────────────────────────────── */

type LfgEventPayload = { type?: string; id?: string; at?: string; [k: string]: unknown }

let sseReq: http.ClientRequest | null = null
let sseReconnectTimer: ReturnType<typeof setTimeout> | null = null
let sseBackoffMs = 1000
let sseRunning = false
const sseSubscribers = new Set<(ev: LfgEventPayload) => void>()

function emitLfgEvent(ev: LfgEventPayload) {
  for (const cb of sseSubscribers) {
    try {
      cb(ev)
    } catch {
      // ignore subscriber errors
    }
  }
  for (const win of BrowserWindow.getAllWindows()) {
    try {
      win.webContents.send('lfg:event', ev)
    } catch {
      // ignore
    }
  }
}

export function subscribeLfgEvents(cb: (ev: LfgEventPayload) => void): () => void {
  sseSubscribers.add(cb)
  if (!sseRunning) startLfgEventStream()
  return () => {
    sseSubscribers.delete(cb)
  }
}

function clearSseReconnect() {
  if (sseReconnectTimer) {
    clearTimeout(sseReconnectTimer)
    sseReconnectTimer = null
  }
}

function scheduleSseReconnect() {
  clearSseReconnect()
  if (!sseRunning) return
  const delay = sseBackoffMs
  sseBackoffMs = Math.min(60_000, Math.round(sseBackoffMs * 1.7))
  sseReconnectTimer = setTimeout(() => {
    sseReconnectTimer = null
    if (sseRunning) connectLfgEventStream()
  }, delay)
}

function connectLfgEventStream() {
  if (sseReq) {
    try {
      sseReq.destroy()
    } catch {
      // ignore
    }
    sseReq = null
  }
  const base = getLfgBaseUrl()
  let url: URL
  try {
    url = new URL(`${base.replace(/\/+$/, '')}/events`)
  } catch {
    scheduleSseReconnect()
    return
  }
  const lib = url.protocol === 'https:' ? https : http
  const req = lib.get(
    {
      hostname: url.hostname,
      port: url.port || (url.protocol === 'https:' ? 443 : 80),
      path: `${url.pathname}${url.search}`,
      headers: {
        Accept: 'text/event-stream',
        'Cache-Control': 'no-cache',
      },
      timeout: 0,
    },
    (res) => {
      if (res.statusCode === 429) {
        res.resume()
        scheduleSseReconnect()
        return
      }
      if (!res.statusCode || res.statusCode >= 400) {
        res.resume()
        scheduleSseReconnect()
        return
      }
      sseBackoffMs = 1000
      let buf = ''
      let eventName = 'message'
      res.setEncoding('utf8')
      res.on('data', (chunk: string) => {
        buf += chunk
        const parts = buf.split(/\n/)
        buf = parts.pop() || ''
        for (const line of parts) {
          if (line.startsWith('event:')) {
            eventName = line.slice(6).trim() || 'message'
          } else if (line.startsWith('data:')) {
            const raw = line.slice(5).trim()
            try {
              const data = raw ? JSON.parse(raw) : {}
              emitLfgEvent({
                type: eventName === 'message' ? data.type || 'update' : eventName,
                ...data,
              })
            } catch {
              emitLfgEvent({ type: eventName })
            }
            eventName = 'message'
          } else if (line.trim() === '') {
            eventName = 'message'
          }
        }
      })
      res.on('end', () => {
        if (sseReq === req) sseReq = null
        scheduleSseReconnect()
      })
      res.on('error', () => {
        if (sseReq === req) sseReq = null
        scheduleSseReconnect()
      })
    },
  )
  req.on('error', () => {
    if (sseReq === req) sseReq = null
    scheduleSseReconnect()
  })
  req.on('timeout', () => {
    try {
      req.destroy()
    } catch {
      // ignore
    }
  })
  sseReq = req
}

/** Begin (or restart) SSE against the active hub; reconnects with backoff. */
export function startLfgEventStream() {
  sseRunning = true
  clearSseReconnect()
  connectLfgEventStream()
}

export function stopLfgEventStream() {
  sseRunning = false
  clearSseReconnect()
  if (sseReq) {
    try {
      sseReq.destroy()
    } catch {
      // ignore
    }
    sseReq = null
  }
}

/** Prefetch relic options + hub listings so the LFG tab opens warm. */
export async function warmLfg(): Promise<void> {
  try {
    const { getLfgRelicOptions } = await import('./lfg-relic-options')
    await getLfgRelicOptions().catch(() => [])
  } catch {
    // ignore
  }
  try {
    await ensureLocalLfgHub()
    await listLfg({ region: 'all', activity: 'all' }).catch(() => null)
    startLfgEventStream()
  } catch {
    // ignore — tab can still open cold
  }
}
