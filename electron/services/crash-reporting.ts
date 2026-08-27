/**
 * Opt-in local crash log + pending prompt for GitHub bug report.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { loadSettings } from '../settings'

function crashLogPath() {
  return path.join(app.getPath('userData'), 'crash.log')
}

function pendingPath() {
  return path.join(app.getPath('userData'), 'crash-pending.json')
}

export function installCrashReporting() {
  const append = (label: string, err: unknown) => {
    try {
      if (!loadSettings().crashReportingConsent) return
      const stack =
        err instanceof Error
          ? err.stack || err.message
          : typeof err === 'string'
            ? err
            : String(err)
      const line = `\n----- ${new Date().toISOString()} ${label} -----\n${stack}\n`
      fs.appendFileSync(crashLogPath(), line, 'utf8')
      fs.writeFileSync(
        pendingPath(),
        JSON.stringify({
          at: new Date().toISOString(),
          label,
          preview: stack.slice(0, 2000),
        }),
        'utf8',
      )
    } catch {
      // never throw from crash handlers
    }
  }

  process.on('uncaughtException', (err) => {
    console.error('[Everything Warframe] uncaughtException', err)
    append('uncaughtException', err)
  })
  process.on('unhandledRejection', (reason) => {
    console.error('[Everything Warframe] unhandledRejection', reason)
    append('unhandledRejection', reason)
  })
}

export type PendingCrash = {
  at: string
  label: string
  preview: string
}

export function getPendingCrash(): PendingCrash | null {
  try {
    if (!loadSettings().crashReportingConsent) return null
    if (!fs.existsSync(pendingPath())) return null
    const raw = JSON.parse(fs.readFileSync(pendingPath(), 'utf8')) as PendingCrash
    if (!raw?.at || !raw?.preview) return null
    return raw
  } catch {
    return null
  }
}

export function clearPendingCrash() {
  try {
    if (fs.existsSync(pendingPath())) fs.unlinkSync(pendingPath())
  } catch {
    // ignore
  }
}

export function readCrashLogTail(maxChars = 6000): string {
  try {
    if (!fs.existsSync(crashLogPath())) return ''
    const full = fs.readFileSync(crashLogPath(), 'utf8')
    return full.slice(-maxChars)
  } catch {
    return ''
  }
}
