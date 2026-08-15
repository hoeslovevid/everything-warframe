import { screen } from 'electron'
import type { DisplayChoice, DisplayRemountPrompt, PrimaryDisplayInfo } from '../../shared/types'
import { loadSettings, updateSettings } from '../settings'

let warnedStaleDisplayId: number | null = null
const remountListeners = new Set<(prompt: DisplayRemountPrompt) => void>()

export function onDisplayRemount(cb: (prompt: DisplayRemountPrompt) => void) {
  remountListeners.add(cb)
  return () => remountListeners.delete(cb)
}

function emitDisplayRemount(previousId: number) {
  const prompt: DisplayRemountPrompt = {
    previousId,
    displays: listDisplayChoices(),
  }
  for (const cb of remountListeners) {
    try {
      cb(prompt)
    } catch {
      // ignore listener errors
    }
  }
}

/** Display used for OCR capture and overlay placement. */
export function resolveOcrDisplay(): Electron.Display {
  const settings = loadSettings()
  const id = settings.ocrDisplayId
  const displays = screen.getAllDisplays()
  if (id != null) {
    const found = displays.find((d) => d.id === id)
    if (found) return found

    // Windows remaps display IDs after GPU/driver/cable changes — stale settings
    // used to silently fall back while the UI still showed a dead monitor id (#8).
    if (warnedStaleDisplayId !== id) {
      warnedStaleDisplayId = id
      console.warn(
        `[Everything Warframe] OCR display id ${id} not found among ${displays
          .map((d) => d.id)
          .join(', ')} — prompting remount wizard, resetting to primary`,
      )
      emitDisplayRemount(id)
    }
    try {
      updateSettings({ ocrDisplayId: null })
    } catch {
      // ignore persist failures during early boot
    }
  }
  return screen.getPrimaryDisplay()
}

export function listDisplayChoices(): DisplayChoice[] {
  const primaryId = screen.getPrimaryDisplay().id
  return screen.getAllDisplays().map((d, i) => ({
    id: d.id,
    label: d.label?.trim() || `Display ${i + 1}`,
    width: d.bounds.width,
    height: d.bounds.height,
    scaleFactor: d.scaleFactor,
    isPrimary: d.id === primaryId,
  }))
}

export function getOcrDisplayInfo(): PrimaryDisplayInfo {
  const display = resolveOcrDisplay()
  const primaryId = screen.getPrimaryDisplay().id
  return {
    id: display.id,
    label: display.label?.trim() || undefined,
    width: display.bounds.width,
    height: display.bounds.height,
    scaleFactor: display.scaleFactor,
    isPrimary: display.id === primaryId,
  }
}

/** Clear the one-shot stale warning so a new remap can prompt again. */
export function clearDisplayRemountWarning() {
  warnedStaleDisplayId = null
}
