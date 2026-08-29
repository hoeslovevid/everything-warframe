import { execFile, execSync } from 'node:child_process'
import fs from 'node:fs'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

/** Our app (and AppImage) must never count as the game. */
const OWN_APP_RE = /everything[_-]?warframe/i

/**
 * Real game binaries under Windows / Proton.
 * Avoid matching folder paths like `.../Local/Warframe/EE.log` or our AppImage name.
 */
const GAME_BINARY_RE = /(?:^|[\\/\s"'])warframe\.x64\.exe(?:\s|$|"')|(?:^|[\\/\s"'])warframe\.exe(?:\s|$|"')|(?:^|[\\/\s"'])warframe\.x64(?:\s|$|"')/i

let lastCheck = 0
let lastRunning = false
let lastForeground = false
/** Last time we positively observed Warframe running (debounce OCR CPU flakes). */
let lastRunningTrueAt = 0

export function cmdlineLooksLikeWarframeGame(cmdline: string): boolean {
  const text = cmdline.replace(/\0/g, ' ')
  if (!text.trim()) return false
  if (OWN_APP_RE.test(text)) return false
  return GAME_BINARY_RE.test(text)
}

async function queryWindows(): Promise<{ running: boolean; foreground: boolean }> {
  try {
    // NOTE: do not use $PID — it is a read-only automatic variable in PowerShell.
    // Guard Add-Type so we don't recompile the C# helper on every poll.
    const script = `
$procs = Get-Process -ErrorAction SilentlyContinue | Where-Object {
  $_.ProcessName -match '^(?i)Warframe(\\.x64)?$'
}
$running = $procs.Count -gt 0
$fg = $false
if ($running) {
  if (-not ('Fw' -as [type])) {
    Add-Type @"
using System;
using System.Runtime.InteropServices;
public class Fw {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint processId);
}
"@
  }
  $hwnd = [Fw]::GetForegroundWindow()
  $fgPid = 0
  [void][Fw]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)
  if ($fgPid -ne 0) {
    $fgProc = Get-Process -Id $fgPid -ErrorAction SilentlyContinue
    if ($fgProc -and ($fgProc.ProcessName -match '^(?i)Warframe(\\.x64)?$')) { $fg = $true }
  }
}
Write-Output ("{0}|{1}" -f $running, $fg)
`
    const { stdout } = await execFileAsync(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', script],
      { timeout: 2500, windowsHide: true },
    )
    const line = String(stdout).trim().split(/\r?\n/).pop() || ''
    const [running, foreground] = line.split('|')
    return {
      running: /^true$/i.test(running || ''),
      foreground: /^true$/i.test(foreground || ''),
    }
  } catch {
    try {
      const { stdout } = await execFileAsync(
        'tasklist',
        ['/FO', 'CSV', '/NH'],
        { timeout: 2500, windowsHide: true },
      )
      const running = String(stdout)
        .toLowerCase()
        .split(/\r?\n/)
        .some((line) => line.includes('warframe.x64.exe') || line.includes('"warframe.exe"'))
      return { running, foreground: running }
    } catch {
      // Keep last known state — OCR CPU load often times out PowerShell and
      // falsely reports Warframe as closed mid-scan.
      return { running: lastRunning, foreground: lastForeground }
    }
  }
}

/** Warframe under Proton appears as Warframe.x64.exe in the Linux process list. */
function scanProcForWarframe(): boolean {
  try {
    const self = String(process.pid)
    for (const dir of fs.readdirSync('/proc')) {
      if (!/^\d+$/.test(dir) || dir === self) continue
      try {
        const cmdline = fs.readFileSync(`/proc/${dir}/cmdline`, 'utf8')
        if (cmdlineLooksLikeWarframeGame(cmdline)) return true
      } catch {
        // ignore unreadable pids
      }
    }
  } catch {
    // ignore
  }
  return false
}

async function queryLinux(): Promise<{ running: boolean; foreground: boolean }> {
  let running = false
  try {
    // Tight pattern: require the .x64 / .exe game binary, not the word "warframe" alone
    // (which matches everything_warframe.AppImage and Steam path folders).
    const { stdout } = await execFileAsync(
      'pgrep',
      ['-af', String.raw`Warframe\.x64\.exe|Warframe\.exe|(?:^|/)warframe\.x64(?:\s|$)`],
      { timeout: 2500 },
    )
    running = stdout
      .split(/\n/)
      .some((line) => cmdlineLooksLikeWarframeGame(line.replace(/^\d+\s+/, '')))
  } catch {
    // pgrep exits 1 when no match
    running = false
  }
  if (!running) running = scanProcForWarframe()

  if (!running) return { running: false, foreground: false }

  // X11: optional active-window check. Wayland usually can't — treat running as playable.
  let foreground = running
  try {
    const { stdout } = await execFileAsync(
      'xdotool',
      ['getactivewindow', 'getwindowname'],
      { timeout: 1500 },
    )
    const name = stdout.toLowerCase()
    foreground = /warframe/.test(name) && !/everything/.test(name)
  } catch {
    foreground = running
  }
  return { running, foreground }
}

async function queryPlatform(): Promise<{ running: boolean; foreground: boolean }> {
  if (process.platform === 'win32') return queryWindows()
  if (process.platform === 'linux') return queryLinux()
  return { running: false, foreground: false }
}

/**
 * Sync check used by inventory status UI.
 * Linux: /proc cmdline scan for Warframe.x64.exe (ignores our AppImage).
 */
export function isWarframeGameRunningSync(): boolean {
  if (process.platform === 'linux') return scanProcForWarframe()
  if (process.platform === 'win32') {
    try {
      const out = execSync('tasklist /FI "IMAGENAME eq Warframe.x64.exe" /NH', {
        encoding: 'utf8',
        windowsHide: true,
        timeout: 5000,
      })
      return out.toLowerCase().includes('warframe.x64.exe')
    } catch {
      return false
    }
  }
  return false
}

export async function getWarframeProcessState(): Promise<{
  running: boolean
  foreground: boolean
}> {
  const now = Date.now()
  if (now - lastCheck < 2000) {
    return { running: lastRunning, foreground: lastForeground }
  }
  const next = await queryPlatform()
  // OCR spikes make PowerShell falsely report Warframe closed — hold "running"
  // for a few seconds after a positive sighting.
  if (!next.running && lastRunning && now - lastRunningTrueAt < 10_000) {
    lastCheck = now
    return { running: true, foreground: lastForeground || next.foreground }
  }
  lastCheck = now
  lastRunning = next.running
  lastForeground = next.foreground
  if (next.running) lastRunningTrueAt = now
  return next
}

export async function isWarframeForeground(): Promise<boolean> {
  const state = await getWarframeProcessState()
  return state.foreground
}

export async function isWarframeRunning(): Promise<boolean> {
  const state = await getWarframeProcessState()
  return state.running
}

/** Bust the short-lived cache (e.g. right before an auto-scan). */
export function invalidateWarframeProcessCache() {
  lastCheck = 0
}
