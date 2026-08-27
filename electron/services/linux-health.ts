/**
 * Linux diagnostics for inventory sync, overlay capture, and Proton parity.
 */
import fs from 'node:fs'
import { execFileSync } from 'node:child_process'
import {
  findWarframeWineLauncher,
  warframeProtonPrefix,
} from './steam-paths'

export type LinuxPtraceStatus = {
  /** YAMA ptrace_scope value, or null if unavailable. */
  scope: number | null
  /** True when helpers can attach to same-UID processes (scope 0). */
  permissive: boolean
  /** Short UI label. */
  label: string
  detail: string
  fixCommand: string
  tip: string
}

const FIX_CMD = 'sudo sysctl -w kernel.yama.ptrace_scope=0'

/**
 * Read kernel.yama.ptrace_scope. Scope 1+ blocks warframe-api-helper from
 * reading Warframe.exe memory (“Failed to gruzzle the crumbs”).
 */
export function getLinuxPtraceStatus(): LinuxPtraceStatus {
  if (process.platform !== 'linux') {
    return {
      scope: null,
      permissive: true,
      label: 'n/a',
      detail: 'Windows does not use YAMA ptrace',
      fixCommand: '',
      tip: '',
    }
  }

  const tip =
    'Inventory sync reads Warframe’s session from process memory. Stay logged in on the Orbiter, then Sync. Do not run the whole AppImage as root — allow ptrace for your user instead.'

  try {
    const raw = fs.readFileSync('/proc/sys/kernel/yama/ptrace_scope', 'utf8').trim()
    const scope = Number.parseInt(raw, 10)
    if (!Number.isFinite(scope)) {
      return {
        scope: null,
        permissive: false,
        label: 'unknown',
        detail: 'could not parse ptrace_scope',
        fixCommand: FIX_CMD,
        tip,
      }
    }
    if (scope === 0) {
      return {
        scope: 0,
        permissive: true,
        label: 'permissive',
        detail: 'ptrace_scope=0 — memory attach allowed',
        fixCommand: FIX_CMD,
        tip,
      }
    }
    return {
      scope,
      permissive: false,
      label: 'restricted',
      detail: `ptrace_scope=${scope} — blocks inventory memory read (gruzzle)`,
      fixCommand: FIX_CMD,
      tip,
    }
  } catch {
    return {
      scope: null,
      permissive: false,
      label: 'unknown',
      detail: 'YAMA ptrace_scope unreadable',
      fixCommand: FIX_CMD,
      tip,
    }
  }
}

function steamRunning(): boolean {
  if (process.platform !== 'linux') return false
  try {
    execFileSync('pgrep', ['-x', 'steam'], { stdio: 'ignore', timeout: 1500 })
    return true
  } catch {
    try {
      execFileSync('pgrep', ['-f', 'steam'], { stdio: 'ignore', timeout: 1500 })
      return true
    } catch {
      return false
    }
  }
}

export type LinuxHealthSnapshot = {
  platform: string
  ptrace: LinuxPtraceStatus
  steamRunning: boolean
  wineLauncherFound: boolean
  protonPrefix: string | null
}

export function getLinuxHealthSnapshot(): LinuxHealthSnapshot {
  if (process.platform !== 'linux') {
    return {
      platform: process.platform,
      ptrace: getLinuxPtraceStatus(),
      steamRunning: false,
      wineLauncherFound: false,
      protonPrefix: null,
    }
  }
  let wine = false
  try {
    wine = Boolean(findWarframeWineLauncher())
  } catch {
    wine = false
  }
  let prefix: string | null = null
  try {
    prefix = warframeProtonPrefix() || null
  } catch {
    prefix = null
  }
  return {
    platform: process.platform,
    ptrace: getLinuxPtraceStatus(),
    steamRunning: steamRunning(),
    wineLauncherFound: wine,
    protonPrefix: prefix,
  }
}
