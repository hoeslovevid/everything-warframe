/**
 * Sync settings to a user-chosen cloud folder (Dropbox / OneDrive / etc.).
 * No account — just a JSON file both PCs can see.
 */
import fs from 'node:fs'
import path from 'node:path'
import { app, dialog } from 'electron'
import type { AppSettings } from '../../shared/types'
import { getSettingsFilePath, loadSettings, updateSettings } from '../settings'

const FILE_NAME = 'everything-warframe-settings.json'

let pushTimer: ReturnType<typeof setTimeout> | null = null

function cloudFile(dir: string) {
  return path.join(dir, FILE_NAME)
}

function safePayload(settings: AppSettings) {
  const { ...safe } = settings
  return {
    ...safe,
    _note:
      'Cloud sync file — warframe.market JWT is stored separately and not included; re-link Account after pull if needed.',
    _syncedAt: new Date().toISOString(),
  }
}

export function pushSettingsToCloud(settings = loadSettings()): { ok: boolean; error?: string } {
  const dir = settings.settingsCloudSyncPath?.trim()
  if (!dir) return { ok: false, error: 'Cloud sync path not set' }
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    const file = cloudFile(dir)
    fs.writeFileSync(file, JSON.stringify(safePayload(settings), null, 2), 'utf8')
    return { ok: true }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Cloud push failed' }
  }
}

export function scheduleCloudSettingsPush(settings = loadSettings()) {
  if (!settings.settingsCloudSyncPath?.trim()) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(() => {
    pushTimer = null
    const res = pushSettingsToCloud(loadSettings())
    if (!res.ok && res.error) {
      console.warn('[Everything Warframe] Cloud settings push failed:', res.error)
    }
  }, 1200)
}

export function pullSettingsFromCloud(opts?: {
  force?: boolean
}): { ok: boolean; imported?: boolean; error?: string; path?: string } {
  const settings = loadSettings()
  const dir = settings.settingsCloudSyncPath?.trim()
  if (!dir) return { ok: false, error: 'Cloud sync path not set' }
  const file = cloudFile(dir)
  if (!fs.existsSync(file)) {
    return { ok: false, error: 'No cloud settings file yet — push once first' }
  }
  try {
    const st = fs.statSync(file)
    let localMtime = 0
    try {
      const localPath = getSettingsFilePath()
      if (fs.existsSync(localPath)) localMtime = fs.statSync(localPath).mtimeMs
    } catch {
      localMtime = 0
    }
    if (!opts?.force && st.mtimeMs <= localMtime + 500) {
      return { ok: true, imported: false, path: file }
    }
    const raw = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AppSettings> & {
      _note?: string
      _syncedAt?: string
    }
    delete raw._note
    delete raw._syncedAt
    // Keep this machine's cloud path / auto flag so we don't wipe sync config.
    const keepPath = settings.settingsCloudSyncPath
    const keepAuto = settings.settingsCloudSyncAuto
    updateSettings({
      ...raw,
      settingsCloudSyncPath: keepPath,
      settingsCloudSyncAuto: keepAuto,
    })
    return { ok: true, imported: true, path: file }
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : 'Cloud pull failed' }
  }
}

export async function pickCloudSyncFolder(): Promise<{
  ok: boolean
  path?: string
  error?: string
}> {
  const result = await dialog.showOpenDialog({
    title: 'Choose cloud sync folder (Dropbox / OneDrive / …)',
    defaultPath: app.getPath('documents'),
    properties: ['openDirectory', 'createDirectory'],
  })
  if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'cancelled' }
  const dir = result.filePaths[0]
  updateSettings({ settingsCloudSyncPath: dir })
  const push = pushSettingsToCloud()
  if (!push.ok) return { ok: false, error: push.error, path: dir }
  return { ok: true, path: dir }
}

export function clearCloudSyncPath() {
  updateSettings({ settingsCloudSyncPath: '' })
}
