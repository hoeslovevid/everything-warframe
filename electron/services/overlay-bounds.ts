/**
 * Shrink the overlay BrowserWindow to the union of visible panels so Windows
 * composites less fullscreen transparent area over Warframe.
 *
 * Panel CSS stays in full-display design coordinates; the renderer applies
 * `translate(-originX, -originY)` to match the shrunk window.
 */
import type { BrowserWindow } from 'electron'
import type { AppSettings, ModuleId, PanelAnchor } from '../../shared/types'
import { OVERLAY_MODULE_IDS } from '../../shared/types'
import { resolveOcrDisplay } from './display-target'

const PANEL_SIZE: Partial<Record<ModuleId, { w: number; h: number }>> = {
  cycles: { w: 300, h: 250 },
  fissures: { w: 320, h: 300 },
  baro: { w: 340, h: 260 },
  nightwave: { w: 320, h: 280 },
  relics: { w: 780, h: 220 },
  arbitration: { w: 300, h: 200 },
  invasions: { w: 320, h: 260 },
  archon: { w: 320, h: 240 },
  deepArchimedea: { w: 340, h: 260 },
  rivens: { w: 420, h: 360 },
  relicRecommend: { w: 320, h: 280 },
}

const PAD = 20
const STRIP = { y: 8, w: 560, h: 48 }

export type OverlayContentOrigin = {
  /** Design-space top-left of the tight window (0,0 = full display top-left). */
  x: number
  y: number
  /** Full design size (display size) — renderer keeps this layout space. */
  designWidth: number
  designHeight: number
  tight: boolean
}

let lastOrigin: OverlayContentOrigin | null = null
let onOriginChange: ((origin: OverlayContentOrigin) => void) | null = null

export function setOverlayOriginListener(fn: ((origin: OverlayContentOrigin) => void) | null) {
  onOriginChange = fn
}

export function getOverlayContentOrigin(): OverlayContentOrigin | null {
  return lastOrigin
}

function emitOrigin(origin: OverlayContentOrigin) {
  lastOrigin = origin
  onOriginChange?.(origin)
}

function enabledWorldModules(settings: AppSettings): ModuleId[] {
  return OVERLAY_MODULE_IDS.filter((id) => {
    if (id === 'relics' || id === 'rivens') return false
    return Boolean(settings.modules[id])
  })
}

function computeUnion(settings: AppSettings): {
  minX: number
  minY: number
  maxX: number
  maxY: number
} | null {
  const scale = Math.max(0.7, Math.min(1.4, settings.overlayScale || 1))
  const display = resolveOcrDisplay()
  const modules = enabledWorldModules(settings)

  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity

  const bump = (x: number, y: number, w: number, h: number) => {
    minX = Math.min(minX, x)
    minY = Math.min(minY, y)
    maxX = Math.max(maxX, x + w)
    maxY = Math.max(maxY, y + h)
  }

  for (const id of modules) {
    const anchor: PanelAnchor = settings.panelAnchors[id] || { x: 24, y: 24 }
    const size = PANEL_SIZE[id] || { w: 300, h: 220 }
    bump(anchor.x, anchor.y, size.w * scale, size.h * scale)
  }

  const stripW = STRIP.w * scale
  bump(display.bounds.width / 2 - stripW / 2, STRIP.y, stripW, STRIP.h * scale)

  if (settings.modules.relics) {
    const a = settings.panelAnchors.relics || { x: 410, y: 640 }
    const s = PANEL_SIZE.relics!
    bump(a.x, a.y, s.w * scale, s.h * scale)
  }
  if (settings.modules.rivens) {
    const a = settings.panelAnchors.rivens || { x: 720, y: 8 }
    const s = PANEL_SIZE.rivens!
    bump(a.x, a.y, s.w * scale, s.h * scale)
  }

  // OCR status chip (bottom-left-ish)
  bump(16, display.bounds.height - 64, 200, 48)

  if (!Number.isFinite(minX)) return null
  return { minX, minY, maxX, maxY }
}

/** Apply full-display or tight content bounds to the overlay window. */
export function applyOverlayWindowBounds(win: BrowserWindow, settings: AppSettings) {
  if (win.isDestroyed()) return
  const display = resolveOcrDisplay()
  const full = {
    x: display.bounds.x,
    y: display.bounds.y,
    width: display.bounds.width,
    height: display.bounds.height,
  }

  const useTight =
    settings.gamePerformanceMode &&
    settings.overlayTightBounds &&
    !settings.layoutEditMode

  if (!useTight) {
    win.setBounds(full)
    emitOrigin({
      x: 0,
      y: 0,
      designWidth: display.bounds.width,
      designHeight: display.bounds.height,
      tight: false,
    })
    return
  }

  const union = computeUnion(settings)
  if (!union) {
    win.setBounds(full)
    emitOrigin({
      x: 0,
      y: 0,
      designWidth: display.bounds.width,
      designHeight: display.bounds.height,
      tight: false,
    })
    return
  }

  const minX = Math.max(0, Math.floor(union.minX - PAD))
  const minY = Math.max(0, Math.floor(union.minY - PAD))
  const maxX = Math.min(display.bounds.width, Math.ceil(union.maxX + PAD))
  const maxY = Math.min(display.bounds.height, Math.ceil(union.maxY + PAD))
  const width = Math.max(160, maxX - minX)
  const height = Math.max(100, maxY - minY)

  if (width * height > display.bounds.width * display.bounds.height * 0.85) {
    win.setBounds(full)
    emitOrigin({
      x: 0,
      y: 0,
      designWidth: display.bounds.width,
      designHeight: display.bounds.height,
      tight: false,
    })
    return
  }

  win.setBounds({
    x: display.bounds.x + minX,
    y: display.bounds.y + minY,
    width,
    height,
  })
  emitOrigin({
    x: minX,
    y: minY,
    designWidth: display.bounds.width,
    designHeight: display.bounds.height,
    tight: true,
  })
}
