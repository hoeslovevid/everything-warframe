import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, clipboard, dialog, shell } from 'electron'
import type {
  BugReportCategory,
  BugReportDraft,
  BugReportOpenResult,
} from '../../shared/types'
import { loadSettings } from '../settings'
import { listDisplayChoices, resolveOcrDisplay } from './display-target'
import { getRelicScanState } from './relic-scanner'
import { getRivenScanState } from './riven-scanner'

export type { BugReportCategory, BugReportDraft, BugReportOpenResult }

const REPO_ISSUES_NEW = 'https://github.com/hoeslovevid/everything-warframe/issues/new'
/** Keep under common browser URL limits. */
const MAX_URL_LEN = 7000

const CATEGORY_LABEL: Record<BugReportCategory, string> = {
  relics: 'Relic OCR / rewards',
  rivens: 'Riven grader',
  overlay: 'Overlay / layout',
  inventory: 'Inventory / foundry',
  linux: 'Linux / Proton',
  other: 'Other',
}

function redactPath(p: string): string {
  if (!p) return ''
  const home = app.getPath('home')
  return p.split(home).join('~').replace(/\\/g, '/')
}

function listRecentFiles(dir: string, limit = 8): string[] {
  try {
    if (!fs.existsSync(dir)) return []
    return fs
      .readdirSync(dir)
      .filter((f) => /\.(png|jpg|jpeg|webp|txt|log)$/i.test(f))
      .map((f) => {
        const full = path.join(dir, f)
        try {
          return { f, mtime: fs.statSync(full).mtimeMs }
        } catch {
          return { f, mtime: 0 }
        }
      })
      .sort((a, b) => b.mtime - a.mtime)
      .slice(0, limit)
      .map((x) => x.f)
  } catch {
    return []
  }
}

function debugDirs(): string[] {
  const base = app.getPath('userData')
  return [path.join(base, 'relic-debug'), path.join(base, 'riven-debug')].filter((d) =>
    fs.existsSync(d),
  )
}

export function buildDiagnosticsBlock(): string {
  const settings = loadSettings()
  const display = resolveOcrDisplay()
  const displays = listDisplayChoices()
  const relic = getRelicScanState()
  const riven = getRivenScanState()
  const enabled = Object.entries(settings.modules)
    .filter(([, on]) => on)
    .map(([id]) => id)
    .join(', ')

  const lines = [
    '### Diagnostics (from app)',
    '',
    '```',
    `version: ${app.getVersion()}`,
    `platform: ${process.platform} ${os.release()} (${process.arch})`,
    `electron: ${process.versions.electron}`,
    `chrome: ${process.versions.chrome}`,
    `ocrDisplay: ${display.id} ${display.bounds.width}×${display.bounds.height} @${display.scaleFactor} (setting=${settings.ocrDisplayId ?? 'primary'})`,
    `displays: ${displays.map((d) => `${d.id}:${d.width}x${d.height}${d.isPrimary ? '*' : ''}`).join(' | ') || 'n/a'}`,
    `modules: ${enabled || '(none)'}`,
    `fissurePathMode: ${settings.fissurePathMode}`,
    `fissureShowStorms: ${settings.fissureShowStorms}`,
    `overlayVisible: ${settings.overlayVisible}`,
    `overlayScale: ${settings.overlayScale}`,
    `eeLogPath: ${redactPath(settings.eeLogPath) || '(empty)'}`,
    `inventorySource: ${settings.inventorySource}`,
    `inventoryPath: ${redactPath(settings.inventoryPath) || '(empty)'}`,
    `userData: ${redactPath(app.getPath('userData'))}`,
    `cache: ${redactPath(path.join(app.getPath('userData'), 'cache'))}`,
    `appImage: ${process.env.APPIMAGE ? redactPath(process.env.APPIMAGE) : '(no)'}`,
    `relicScan: active=${relic.active} err=${relic.error || 'none'} rewards=${relic.rewards.length} squad=${relic.squadSize ?? 'n/a'}`,
    `rivenScan: active=${riven.active} err=${riven.error || 'none'} current=${riven.current?.weapon || '-'} reroll=${riven.reroll?.weapon || '-'}`,
  ]

  for (const dir of debugDirs()) {
    const files = listRecentFiles(dir)
    lines.push(`debug:${path.basename(dir)}: ${files.length ? files.join(', ') : '(empty)'}`)
  }

  lines.push('```')
  return lines.join('\n')
}

export function buildIssueBody(draft: BugReportDraft): string {
  const parts = [
    `### Area`,
    CATEGORY_LABEL[draft.category] || draft.category,
    '',
    `### What happened?`,
    draft.description.trim() || '_No description provided._',
    '',
    `### App version`,
    app.getVersion(),
    '',
    `### OS`,
    `${process.platform} ${os.release()} (${process.arch})`,
  ]
  if (draft.includeDiagnostics) {
    parts.push('', buildDiagnosticsBlock())
  }
  parts.push(
    '',
    '### Attachments',
    '_Please drag screenshots or OCR debug crops onto this issue if relevant._',
  )
  return parts.join('\n')
}

export function buildIssueUrl(draft: BugReportDraft): { url: string; truncated: boolean } {
  const title = (draft.title.trim() || `[Bug] ${CATEGORY_LABEL[draft.category]}`).slice(0, 120)
  let body = buildIssueBody(draft)
  let truncated = false

  const makeUrl = (b: string) => {
    const params = new URLSearchParams({
      title,
      body: b,
      labels: 'bug',
    })
    return `${REPO_ISSUES_NEW}?${params.toString()}`
  }

  let url = makeUrl(body)
  if (url.length > MAX_URL_LEN) {
    truncated = true
    // Drop diagnostics first, then trim description.
    const shortDraft = { ...draft, includeDiagnostics: false }
    body = buildIssueBody(shortDraft)
    url = makeUrl(body)
  }
  if (url.length > MAX_URL_LEN) {
    truncated = true
    const cut = draft.description.trim().slice(0, 800)
    body = buildIssueBody({ ...draft, description: `${cut}\n\n_(truncated)_`, includeDiagnostics: false })
    url = makeUrl(body)
  }
  return { url, truncated }
}

export async function openBugReport(draft: BugReportDraft): Promise<BugReportOpenResult> {
  try {
    const { url, truncated } = buildIssueUrl(draft)
    const dirs = debugDirs()
    await shell.openExternal(url)
    return {
      ok: true,
      url,
      truncated,
      stagingDir: null,
      debugDirs: dirs,
    }
  } catch (err) {
    return {
      ok: false,
      url: '',
      truncated: false,
      stagingDir: null,
      debugDirs: [],
      error: err instanceof Error ? err.message : String(err),
    }
  }
}

export function copyBugDiagnostics(draft?: Partial<BugReportDraft>): boolean {
  const body = buildIssueBody({
    title: draft?.title || 'Diagnostics',
    category: draft?.category || 'other',
    description: draft?.description || '',
    includeDiagnostics: true,
  })
  clipboard.writeText(body)
  return true
}

export async function pickBugScreenshots(): Promise<{ stagingDir: string; count: number } | null> {
  const result = await dialog.showOpenDialog({
    title: 'Select screenshots for your bug report',
    properties: ['openFile', 'multiSelections'],
    filters: [
      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
      { name: 'All files', extensions: ['*'] },
    ],
  })
  if (result.canceled || !result.filePaths.length) return null

  const stagingDir = path.join(app.getPath('userData'), 'bug-report-staging')
  fs.mkdirSync(stagingDir, { recursive: true })
  // Clear previous staging so the folder is only this report’s files.
  for (const f of fs.readdirSync(stagingDir)) {
    try {
      fs.unlinkSync(path.join(stagingDir, f))
    } catch {
      // ignore
    }
  }

  let count = 0
  for (const src of result.filePaths.slice(0, 8)) {
    const base = path.basename(src)
    const dest = path.join(stagingDir, base)
    try {
      fs.copyFileSync(src, dest)
      count++
    } catch {
      // skip unreadable
    }
  }
  if (count > 0) {
    await shell.openPath(stagingDir)
  }
  return { stagingDir, count }
}

export async function openBugDebugFolders(): Promise<string[]> {
  const dirs = [...debugDirs()]
  const staging = path.join(app.getPath('userData'), 'bug-report-staging')
  if (fs.existsSync(staging)) dirs.push(staging)
  if (!dirs.length) {
    const userData = app.getPath('userData')
    await shell.openPath(userData)
    return [userData]
  }
  for (const dir of dirs) {
    await shell.openPath(dir)
  }
  return dirs
}
