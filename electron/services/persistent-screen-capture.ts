import { app, BrowserWindow, desktopCapturer, session } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { resolveOcrDisplay } from './display-target'

/**
 * Keeps a single getDisplayMedia stream alive so Linux/Wayland (PipeWire portal)
 * only asks for screen-share permission once per session, and subsequent OCR
 * captures are just frame grabs (much faster than desktopCapturer thumbnails).
 */

type FrameResult = {
  png: Buffer
  width: number
  height: number
  /** Unscaled video size when `scale` < 1. */
  sourceWidth?: number
  sourceHeight?: number
}

let win: BrowserWindow | null = null
let initPromise: Promise<void> | null = null
let streamReady = false
let handlerInstalled = false

/** Portal pickers can hang forever if a second getSources races the first. */
const ENSURE_STREAM_TIMEOUT_MS = 120_000

const CAPTURE_PAGE = `<!DOCTYPE html>
<html><head><meta charset="utf-8" /></head><body>
<script>
(() => {
  let stream = null
  let video = null
  let canvas = null

  async function ensureStream() {
    if (stream && stream.getVideoTracks().some((t) => t.readyState === 'live')) {
      return true
    }
    stream = await navigator.mediaDevices.getDisplayMedia({
      audio: false,
      video: {
        frameRate: { ideal: 15, max: 30 },
      },
    })
    video = document.createElement('video')
    video.muted = true
    video.playsInline = true
    video.srcObject = stream
    await video.play()
    for (let i = 0; i < 40 && (!video.videoWidth || !video.videoHeight); i++) {
      await new Promise((r) => setTimeout(r, 25))
    }
    canvas = document.createElement('canvas')
    const track = stream.getVideoTracks()[0]
    track?.addEventListener('ended', () => {
      stream = null
      video = null
      canvas = null
    })
    return true
  }

  async function grabFrame(opts) {
    await ensureStream()
    if (!video || !canvas) throw new Error('capture stream not ready')
    const w = video.videoWidth
    const h = video.videoHeight
    if (!w || !h) throw new Error('capture video has no dimensions')
    // Readiness polls should never encode full 1440p/4K — that alone was multi-second.
    const scale = Math.min(1, Math.max(0.12, (opts && opts.scale) || 1))
    const cw = Math.max(1, Math.round(w * scale))
    const ch = Math.max(1, Math.round(h * scale))
    canvas.width = cw
    canvas.height = ch
    const ctx = canvas.getContext('2d', { alpha: false })
    ctx.drawImage(video, 0, 0, cw, ch)
    const wantPng = opts && opts.format === 'png'
    const quality = (opts && opts.quality) || 0.7
    const dataUrl = wantPng
      ? canvas.toDataURL('image/png')
      : canvas.toDataURL('image/jpeg', quality)
    return { dataUrl, width: cw, height: ch, sourceWidth: w, sourceHeight: h }
  }

  /** Crop regions directly from the live video — no full-desktop PNG encode. */
  async function grabRegions(regions, opts) {
    await ensureStream()
    if (!video) throw new Error('capture stream not ready')
    const vw = video.videoWidth
    const vh = video.videoHeight
    if (!vw || !vh) throw new Error('capture video has no dimensions')
    const wantPng = !opts || opts.format !== 'jpeg'
    const out = []
    for (const r of regions || []) {
      const x = Math.max(0, Math.min(Math.round(r.x), vw - 1))
      const y = Math.max(0, Math.min(Math.round(r.y), vh - 1))
      const width = Math.max(1, Math.min(Math.round(r.width), vw - x))
      const height = Math.max(1, Math.min(Math.round(r.height), vh - y))
      const c = document.createElement('canvas')
      c.width = width
      c.height = height
      const ctx = c.getContext('2d', { alpha: false })
      ctx.drawImage(video, x, y, width, height, 0, 0, width, height)
      out.push({
        dataUrl: wantPng ? c.toDataURL('image/png') : c.toDataURL('image/jpeg', 0.92),
        x, y, width, height,
      })
    }
    return { crops: out, width: vw, height: vh }
  }

  async function isLive() {
    return Boolean(stream && stream.getVideoTracks().some((t) => t.readyState === 'live'))
  }

  async function stopStream() {
    try {
      stream?.getTracks()?.forEach((t) => t.stop())
    } catch (_) {}
    stream = null
    video = null
    canvas = null
  }

  window.__ewCapture = { ensureStream, grabFrame, grabRegions, isLive, stopStream }
})()
</script>
</body></html>`

function captureSession() {
  return session.fromPartition('persist:ew-screen-capture')
}

function installDisplayMediaHandler() {
  if (handlerInstalled) return
  handlerInstalled = true
  const ses = captureSession()

  /**
   * Linux: prefer auto-picking a screen (works with WebRTCPipeWireCapturer +
   * auto-select / fake-ui flags) so OCR stays persistent. Fall back to the
   * system PipeWire picker only when no source is available.
   *
   * Avoid racing a second getSources while a portal is already open — that
   * historically deadlocked Authorize capture.
   */
  if (process.platform === 'linux') {
    ses.setDisplayMediaRequestHandler(async (_request, callback) => {
      try {
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: 0, height: 0 },
        })
        const target = resolveOcrDisplay()
        const preferredId = String(target.id)
        const source =
          sources.find((s) => s.display_id === preferredId) ||
          sources.find((s) => Number(s.display_id) === target.id) ||
          sources.find((s) => /entire screen|screen 1|screen/i.test(s.name)) ||
          sources.find((s) => s.id.includes('screen')) ||
          sources[0]
        if (source) {
          callback({ video: source })
          return
        }
      } catch (err) {
        console.warn('[Everything Warframe] Linux auto screen pick failed', err)
      }
      try {
        callback({})
      } catch (err) {
        console.warn('[Everything Warframe] display media callback failed', err)
      }
    }, { useSystemPicker: true })
    return
  }

  ses.setDisplayMediaRequestHandler(async (_request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen'],
        thumbnailSize: { width: 0, height: 0 },
      })
      const target = resolveOcrDisplay()
      const preferredId = String(target.id)
      const source =
        sources.find((s) => s.display_id === preferredId) ||
        sources.find((s) => Number(s.display_id) === target.id) ||
        sources.find((s) => s.id.includes('screen')) ||
        sources[0]
      if (!source) {
        callback({})
        return
      }
      callback({ video: source })
    } catch (err) {
      console.warn('[Everything Warframe] display media handler failed', err)
      callback({})
    }
  })
}

function captureHostPath() {
  const dir = app.getPath('userData')
  const file = path.join(dir, 'capture-host.html')
  fs.writeFileSync(file, CAPTURE_PAGE, 'utf8')
  return file
}

async function ensureWindow(): Promise<BrowserWindow> {
  if (win && !win.isDestroyed()) return win
  installDisplayMediaHandler()
  win = new BrowserWindow({
    show: false,
    width: 64,
    height: 64,
    skipTaskbar: true,
    paintWhenInitiallyHidden: true,
    webPreferences: {
      partition: 'persist:ew-screen-capture',
      backgroundThrottling: false,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  win.on('closed', () => {
    win = null
    streamReady = false
    initPromise = null
  })
  // file:// host is a proper secure context for getDisplayMedia (data: URLs are flaky).
  await win.loadFile(captureHostPath())
  return win
}

async function exec<T>(js: string): Promise<T> {
  const w = await ensureWindow()
  return w.webContents.executeJavaScript(js, true) as Promise<T>
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${Math.round(ms / 1000)}s`))
    }, ms)
    promise.then(
      (v) => {
        clearTimeout(timer)
        resolve(v)
      },
      (err) => {
        clearTimeout(timer)
        reject(err)
      },
    )
  })
}

/** Start (or resume) the persistent screen stream. May show a portal picker once. */
export async function ensurePersistentCapture(): Promise<boolean> {
  if (streamReady) {
    try {
      const live = await exec<boolean>('window.__ewCapture.isLive()')
      if (live) return true
      streamReady = false
    } catch {
      streamReady = false
    }
  }
  if (!initPromise) {
    initPromise = (async () => {
      await ensureWindow()
      await withTimeout(
        exec('window.__ewCapture.ensureStream()'),
        ENSURE_STREAM_TIMEOUT_MS,
        'Screen share authorization',
      )
      streamReady = true
      console.info('[Everything Warframe] Persistent screen capture stream ready')
    })()
      .catch(async (err) => {
        streamReady = false
        try {
          await exec('window.__ewCapture.stopStream()')
        } catch {
          // ignore
        }
        throw err
      })
      .finally(() => {
        initPromise = null
      })
  }
  try {
    await initPromise
    return streamReady
  } catch (err) {
    streamReady = false
    console.warn('[Everything Warframe] Persistent screen capture unavailable', err)
    return false
  }
}

export function isPersistentCaptureLive(): boolean {
  return streamReady
}

/** Stop the desktop-duplication stream but keep the host window for faster re-auth. */
export async function releasePersistentCaptureStream(): Promise<void> {
  streamReady = false
  initPromise = null
  if (!win || win.isDestroyed()) return
  try {
    await win.webContents.executeJavaScript('window.__ewCapture?.stopStream?.()', true)
    console.info('[Everything Warframe] Persistent screen capture stream released (idle)')
  } catch {
    // ignore
  }
}

let idleReleaseTimer: ReturnType<typeof setTimeout> | null = null

/** Tear down the capture stream after `ms` of no OCR use (reduces GPU contention with Warframe). */
export function schedulePersistentCaptureIdleRelease(ms = 45_000) {
  if (idleReleaseTimer) clearTimeout(idleReleaseTimer)
  idleReleaseTimer = setTimeout(() => {
    idleReleaseTimer = null
    void releasePersistentCaptureStream()
  }, Math.max(5_000, ms))
}

export function cancelPersistentCaptureIdleRelease() {
  if (idleReleaseTimer) {
    clearTimeout(idleReleaseTimer)
    idleReleaseTimer = null
  }
}

/** Grab one full-desktop frame from the live stream (no new permission prompt). */
export async function grabPersistentFrame(opts?: {
  /** PNG for OCR accuracy; JPEG (default) for readiness polls. */
  format?: 'png' | 'jpeg'
  /** Downscale factor (0–1). Use ~0.25 for readiness — full-res encode is multi-second. */
  scale?: number
  quality?: number
}): Promise<FrameResult | null> {
  cancelPersistentCaptureIdleRelease()
  const ok = await ensurePersistentCapture()
  if (!ok) return null
  try {
    const format = opts?.format === 'png' ? 'png' : 'jpeg'
    const scale = opts?.scale
    const quality = opts?.quality
    const frame = await exec<{
      dataUrl: string
      width: number
      height: number
      sourceWidth?: number
      sourceHeight?: number
    }>(`window.__ewCapture.grabFrame(${JSON.stringify({ format, scale, quality })})`)
    if (!frame?.dataUrl) return null
    const b64 = frame.dataUrl.replace(/^data:image\/\w+;base64,/, '')
    const png = Buffer.from(b64, 'base64')
    return {
      png,
      width: frame.width,
      height: frame.height,
      sourceWidth: frame.sourceWidth || frame.width,
      sourceHeight: frame.sourceHeight || frame.height,
    }
  } catch (err) {
    streamReady = false
    console.warn('[Everything Warframe] Persistent frame grab failed', err)
    return null
  }
}

/** Grab only the listed screen regions (card crops) — skips full-desktop encode. */
export async function grabPersistentRegions(
  regions: Array<{ x: number; y: number; width: number; height: number }>,
): Promise<{
  crops: Buffer[]
  width: number
  height: number
  regions: Array<{ x: number; y: number; width: number; height: number }>
} | null> {
  cancelPersistentCaptureIdleRelease()
  const ok = await ensurePersistentCapture()
  if (!ok || !regions.length) return null
  try {
    const frame = await exec<{
      crops: Array<{ dataUrl: string; x: number; y: number; width: number; height: number }>
      width: number
      height: number
    }>(`window.__ewCapture.grabRegions(${JSON.stringify(regions)}, ${JSON.stringify({ format: 'png' })})`)
    if (!frame?.crops?.length) return null
    const crops = frame.crops.map((c) => {
      const b64 = c.dataUrl.replace(/^data:image\/\w+;base64,/, '')
      return Buffer.from(b64, 'base64')
    })
    return {
      crops,
      width: frame.width,
      height: frame.height,
      regions: frame.crops.map((c) => ({
        x: c.x,
        y: c.y,
        width: c.width,
        height: c.height,
      })),
    }
  } catch (err) {
    streamReady = false
    console.warn('[Everything Warframe] Persistent region grab failed', err)
    return null
  }
}

export function disposePersistentCapture() {
  cancelPersistentCaptureIdleRelease()
  streamReady = false
  initPromise = null
  if (win && !win.isDestroyed()) {
    try {
      void win.webContents.executeJavaScript('window.__ewCapture?.stopStream?.()', true)
    } catch {
      // ignore
    }
    win.destroy()
  }
  win = null
}
