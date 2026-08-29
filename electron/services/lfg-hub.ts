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
import path from 'node:path'
import { app } from 'electron'
import { loadSettings } from '../settings'
import type {
  LfgCreateInput,
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
  'Hosted LFG board blocked by Railway edge (429). Using a local board on this PC. ' +
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
        ? 'LFG hub rate limited — retrying shortly'
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
}> {
  try {
    const { result, baseUrl, warning } = await withHubFallback((base) =>
      fetchJson(`${base}/health`),
    )
    return { ok: true, listings: result.listings, baseUrl, warning }
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
  q?: string
}): Promise<LfgListResult> {
  const params = new URLSearchParams()
  if (opts?.region) params.set('region', opts.region)
  if (opts?.platform) params.set('platform', opts.platform)
  if (opts?.activity) params.set('activity', opts.activity)
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
): Promise<{ ok: boolean; listing?: LfgListing; hostToken?: string; error?: string; warning?: string }> {
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
    return { ok: true, listing, hostToken: result.hostToken, warning }
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
  } catch {
    // ignore — tab can still open cold
  }
}
