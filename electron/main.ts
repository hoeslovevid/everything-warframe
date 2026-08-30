import {
  app,
  BrowserWindow,
  dialog,
  globalShortcut,
  ipcMain,
  Menu,
  Notification,
  Tray,
  nativeImage,
  screen,
  shell,
  type WebContents,
} from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { getAppIcon, getTrayIcon } from './app-icon'
import { createOverlayWindow, setOverlayClickThrough } from './overlay-window'
import { loadSettings, setModuleEnabled, updateSettings } from './settings'
import {
  clearCloudSyncPath,
  pickCloudSyncFolder,
  pullSettingsFromCloud,
  pushSettingsToCloud,
  scheduleCloudSettingsPush,
} from './services/settings-cloud-sync'
import {
  getOcrDisplayInfo,
  listDisplayChoices,
  onDisplayRemount,
  resolveOcrDisplay,
  clearDisplayRemountWarning,
} from './services/display-target'
import {
  invalidateCaptureCache,
  setCaptureOverlayPause,
  warmScreenCapture,
} from './services/screen-capture'
import { disposePersistentCapture, schedulePersistentCaptureIdleRelease } from './services/persistent-screen-capture'
import {
  applyOverlayWindowBounds,
  getOverlayContentOrigin,
  setOverlayOriginListener,
  type OverlayContentOrigin,
} from './services/overlay-bounds'
import {
  clearUserDataAndQuit,
  getUninstallInfo,
  launchUninstaller,
  openUserDataFolder,
  openWindowsAppsSettings,
} from './services/uninstall'
import { ensureWfinfoPrices, isWfinfoPricesReady } from './services/wfinfo-prices'
import { defaultRivenAnchor } from '../shared/captureGeometry'
import { fetchWorldstate, hasExpiredWorldstate, nextWorldstateExpiryMs } from './services/worldstate'
import { detectEeLogPath } from './services/log-path'
import {
  browseInventory,
  clearInventoryData,
  getInventoryDiff,
  getInventoryIndex,
  getInventoryStatus,
  inferInventorySource,
  onInventoryUpdated,
  onInventorySyncProgress,
  reloadConfiguredInventory,
  setInventoryConsent,
  syncInventoryFromGame,
  isInventorySyncInFlight,
  useInventoryFile,
} from './services/inventory'
import { clearSessionHaul, getSessionHaul } from './services/session-haul'
import { LogWatcher } from './services/log-watcher'
import {
  ackRelicCelebration,
  clearRelicScan,
  getRelicScanState,
  onRelicScanUpdated,
  scanRelicRewards,
  setRelicSquadSizeHint,
  warmupRelicScanner,
} from './services/relic-scanner'
import {
  clearRivenScan,
  getRivenScanState,
  onRivenScanUpdated,
  scanRivens,
  warmupRivenScanner,
} from './services/riven-scanner'
import { shutdownOcr } from './services/ocr'
import { getFoundryTree, listFoundryItems } from './services/foundry'
import { getRelicPlanner } from './services/relic-planner'
import { ensureRelicCatalog, getDropSourcesForItem } from './services/relic-catalog'
import { getMasteryHelper } from './services/mastery-helper'
import {
  getWarframeProcessState,
  invalidateWarframeProcessCache,
  isWarframeForeground,
  isWarframeRunning,
} from './services/warframe-process'
import {
  checkForAppUpdates,
  getUpdateStatus,
  initAutoUpdater,
  quitAndInstallUpdate,
} from './services/updater'
import {
  BugReportDraft,
  copyBugDiagnostics,
  openBugDebugFolders,
  openBugReport,
  pickBugScreenshots,
} from './services/bug-report'
import {
  clearPendingCrash,
  getPendingCrash,
  installCrashReporting,
  readCrashLogTail,
} from './services/crash-reporting'
import { fetchItemQuotes, fetchUndercutSuggestion } from './services/market'
import { syncMarketBuyAlertsFromSettings } from './services/market-buy-alerts'
import {
  addMarketTrade,
  clearMarketTradeLog,
  getMarketTradeLog,
  removeMarketTrade,
} from './services/market-trade-log'
import {
  clearWfmJwt,
  createWfmContract,
  createWfmOrder,
  deleteWfmContract,
  deleteWfmOrder,
  fetchWfmMyContracts,
  fetchWfmMyOrders,
  getWfmSession,
  searchWfmItems,
  setWfmJwt,
  updateWfmOrder,
} from './services/wfm-auth'
import {
  setWidgetWorldstateProvider,
  syncWidgetServerFromSettings,
  getWidgetServerStatus,
  stopWidgetServer,
} from './services/widget-server'
import { configureLinuxStoragePaths } from './linux-paths'
import {
  AppSettings,
  FoundryListFilters,
  HotkeyRegistration,
  MasteryHelperQuery,
  ModuleId,
  MODULE_TOGGLE_HOTKEY_IDS,
  MODULE_TOGGLE_HOTKEY_TO_ID,
  OVERLAY_MODULE_IDS,
  RelicPlannerQuery,
  OcrWarmupStatus,
  WORLDSTATE_MODULE_IDS,
  WorldstateSnapshot,
} from '../shared/types'

// Ensure Chromium's optional FPS HUD is not enabled
try {
  app.commandLine.removeSwitch('show-fps-counter')
} catch {
  // ignore
}
app.setName('Everything Warframe')
if (process.platform === 'win32') {
  // Keep stable AUMID so Windows taskbar/jump lists stay linked across renames
  app.setAppUserModelId('com.voidlens.app')
}
if (process.platform === 'linux') {
  // Must run before any userData reads/writes (settings, caches, Chromium profile).
  configureLinuxStoragePaths()
  // Helps transparent always-on-top overlay above Proton / borderless clients
  app.commandLine.appendSwitch('enable-transparent-visuals')
  // PipeWire capturer — needed for reliable Wayland screen share + restore tokens
  app.commandLine.appendSwitch('enable-features', 'WebRTCPipeWireCapturer')
  // Keep OCR share alive across scans without re-prompting the portal every time
  // (matches the AppImage flags Linux users found working for persistent capture).
  app.commandLine.appendSwitch('auto-select-desktop-capture-source', 'Entire Screen')
  app.commandLine.appendSwitch('use-fake-ui-for-media-stream')
  // AppImage + Chromium sandbox often breaks PipeWire capture on Arch/CachyOS.
  // Opt out with EW_ELECTRON_SANDBOX=1 if you need the sandbox.
  if (process.env.APPIMAGE && process.env.EW_ELECTRON_SANDBOX !== '1') {
    app.commandLine.appendSwitch('no-sandbox')
  } else if (process.env.EW_NO_SANDBOX === '1' || process.env.EW_ELECTRON_NO_SANDBOX === '1') {
    app.commandLine.appendSwitch('no-sandbox')
  }
  // Pure Wayland cannot pin always-on-top above games — use XWayland for the overlay.
  // Override with ELECTRON_OZONE_PLATFORM_HINT=wayland if needed.
  if (
    process.env.WAYLAND_DISPLAY &&
    !process.env.ELECTRON_OZONE_PLATFORM_HINT &&
    !app.commandLine.hasSwitch('ozone-platform')
  ) {
    app.commandLine.appendSwitch('ozone-platform', 'x11')
    console.info(
      '[Everything Warframe] Using X11/XWayland so the overlay can stay above Warframe',
    )
  }
}

const isDev = !app.isPackaged
const DEV_URL = 'http://127.0.0.1:5173'

let companionWindow: BrowserWindow | null = null
let overlayWindow: BrowserWindow | null = null
let tray: Tray | null = null
let worldstateCache: WorldstateSnapshot | null = null
let worldstateTimer: NodeJS.Timeout | null = null
let expiryTimer: NodeJS.Timeout | null = null
let inventorySyncTimer: NodeJS.Timeout | null = null
let lastExpiryRefresh = 0
let lastHotkeyStatus: HotkeyRegistration[] = []
const logWatcher = new LogWatcher()

function preferLowerProcessPriority() {
  try {
    os.setPriority(os.constants.priority.PRIORITY_BELOW_NORMAL)
    console.info('[Everything Warframe] Process priority set to below-normal')
  } catch (err) {
    console.warn('[Everything Warframe] Could not lower process priority', err)
  }
}

function applyOverlayPerformanceMode(visible: boolean) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  // When hidden, let Chromium throttle; when shown, keep timers accurate for countdowns
  overlayWindow.webContents.setBackgroundThrottling(!visible)
}

async function runRelicScan(trigger: 'manual' | 'log', squadSize?: number | null) {
  const settings = loadSettings()
  if (!settings.modules.relics) {
    console.info('[Everything Warframe] Relic scan skipped — Relics module disabled')
    return getRelicScanState()
  }
  if (trigger === 'log') {
    invalidateWarframeProcessCache()
    const fg = await isWarframeForeground()
    const running = fg ? true : await isWarframeRunning()
    if (!running) {
      console.info('[Everything Warframe] Relic auto-scan skipped — Warframe not running')
      return getRelicScanState()
    }
    if (settings.requireWarframeFocusForAutoScan && !fg) {
      console.info(
        '[Everything Warframe] Relic auto-scan skipped — Warframe not focused (Settings → require focus)',
      )
      return getRelicScanState()
    }
  }
  if (!settings.overlayVisible) {
    const next = updateSettings({ overlayVisible: true })
    broadcastSettings(next)
  }
  // Manual hotkey: force the overlay up (same focus-race fix as riven).
  if (trigger === 'manual') {
    overlayWarframeGateOk = true
    applyOverlayWindowVisible(true, { silent: true })
  } else {
    await refreshOverlayWarframeGate({ force: true })
    syncOverlayWindowVisibility()
  }
  setRelicSquadSizeHint(squadSize ?? logWatcher.getSquadSizeHint())
  const state = await scanRelicRewards(trigger)
  broadcastRelicScan()
  noteCaptureIdleAfterScan()
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    restoreOverlayGeometry(overlayWindow)
  }
  if (state.rewards.length && !state.error) {
    if (settings.relicSoundEnabled) {
      const soundTarget =
        overlayWindow && !overlayWindow.isDestroyed()
          ? overlayWindow
          : companionWindow && !companionWindow.isDestroyed()
            ? companionWindow
            : null
      soundTarget?.webContents.send('relics:sound')
    }
    if (!settings.onboarding.firstRelicSuccessAck) {
      // celebration flag already on RelicScanState; companion listens
    }
  }
  return state
}

function dismissRelicPopup() {
  const state = clearRelicScan()
  broadcastRelicScan()
  return state
}

function broadcastRelicScan() {
  const state = getRelicScanState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('relics:updated', state)
  }
}

async function runRivenScan(trigger: 'manual' | 'log') {
  const settings = loadSettings()
  if (!settings.modules.rivens) {
    console.info('[Everything Warframe] Riven scan skipped — Rivens module disabled')
    return getRivenScanState()
  }
  if (trigger === 'log') {
    invalidateWarframeProcessCache()
    const fg = await isWarframeForeground()
    const running = fg ? true : await isWarframeRunning()
    if (!running) {
      console.info('[Everything Warframe] Riven auto-scan skipped — Warframe not running')
      return getRivenScanState()
    }
    if (settings.requireWarframeFocusForAutoScan && !fg) {
      console.info(
        '[Everything Warframe] Riven auto-scan skipped — Warframe not focused (Settings → require focus)',
      )
      return getRivenScanState()
    }
  }
  if (!settings.overlayVisible) {
    const next = updateSettings({ overlayVisible: true })
    broadcastSettings(next)
  }
  // Manual hotkey = user is looking at Cycle; don't let a focus race hide the overlay.
  if (trigger === 'manual') {
    overlayWarframeGateOk = true
    applyOverlayWindowVisible(true, { silent: true })
  } else {
    await refreshOverlayWarframeGate({ force: true })
    syncOverlayWindowVisibility()
  }
  const state = await scanRivens(trigger)
  broadcastRivenScan()
  noteCaptureIdleAfterScan()
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    restoreOverlayGeometry(overlayWindow)
  }
  if ((state.current || state.reroll) && !state.error && settings.rivenSoundEnabled) {
    const soundTarget =
      overlayWindow && !overlayWindow.isDestroyed()
        ? overlayWindow
        : companionWindow && !companionWindow.isDestroyed()
          ? companionWindow
          : null
    soundTarget?.webContents.send('rivens:sound')
  }
  return state
}

function dismissRivenPopup() {
  const state = clearRivenScan()
  broadcastRivenScan()
  return state
}

function broadcastRivenScan() {
  const state = getRivenScanState()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('rivens:updated', state)
  }
}

function broadcastSettings(settings: AppSettings, except?: WebContents) {
  for (const win of BrowserWindow.getAllWindows()) {
    if (except && win.webContents === except) continue
    win.webContents.send('settings:changed', settings)
  }
}

function broadcastWorldstate(data: WorldstateSnapshot) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('worldstate:updated', data)
  }
}

function broadcastOverlayVisibility(visible: boolean) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('overlay:visibility', visible)
  }
}

function broadcastInventory() {
  const status = getInventoryStatus()
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('inventory:updated', status)
  }
}

function broadcastHotkeyStatus() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('hotkeys:status', lastHotkeyStatus)
  }
}

function broadcastDisplayRemount(prompt: {
  previousId: number
  displays: ReturnType<typeof listDisplayChoices>
}) {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('display:remount', prompt)
  }
}

let ocrWarmupStatus: OcrWarmupStatus = {
  phase: 'idle',
  detail: '…',
  updatedAt: new Date(0).toISOString(),
}

function broadcastOcrWarmup() {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send('ocr:warmup', ocrWarmupStatus)
  }
}

function setOcrWarmup(phase: OcrWarmupStatus['phase'], detail: string) {
  ocrWarmupStatus = {
    phase,
    detail,
    updatedAt: new Date().toISOString(),
  }
  broadcastOcrWarmup()
}

function getOcrWarmupStatus(): OcrWarmupStatus {
  return ocrWarmupStatus
}

/** Load Tesseract (+ optional screen capture) and publish status for the UI. */
async function runOcrWarmup(opts?: { capture?: boolean }): Promise<void> {
  const settings = loadSettings()
  const wantRelics = settings.modules.relics
  const wantRivens = settings.modules.rivens
  if (!wantRelics && !wantRivens) {
    setOcrWarmup('skipped', 'Relics/Rivens off')
    return
  }

  setOcrWarmup('warming', 'OCR engines…')
  console.info('[Everything Warframe] Warming OCR / catalogs…')
  try {
    await Promise.all([
      wantRelics ? warmupRelicScanner() : Promise.resolve(),
      wantRivens ? warmupRivenScanner() : Promise.resolve(),
    ])
    const doCapture =
      opts?.capture !== false &&
      (process.platform !== 'linux' || settings.onboarding.linuxCaptureAck)
    if (doCapture) {
      setOcrWarmup('warming', 'Screen capture…')
      await warmScreenCapture().catch(() => {})
    }
    setOcrWarmup('ready', 'ready')
    console.info('[Everything Warframe] OCR / catalog warmup done')
  } catch (err) {
    setOcrWarmup('failed', 'warmup failed')
    console.warn(
      '[Everything Warframe] OCR warmup failed',
      err instanceof Error ? err.message : err,
    )
  }
}

async function warmFoundryAfterInventorySync() {
  try {
    const { ensureRecipeCatalog, getRecipeItems } = await import('./services/recipe-catalog')
    await ensureRecipeCatalog({ force: getRecipeItems().length === 0 })
  } catch (err) {
    console.warn('[Everything Warframe] Recipe catalog refresh after sync failed', err)
  }
}

/** Prefetch companion catalogs so Inventory / Foundry / Relic Planner open warm. */
async function warmCompanionCatalogs() {
  console.info('[Everything Warframe] Warming companion catalogs…')
  try {
    const [{ ensureRecipeCatalog }, { ensureItemCatalog }, { ensureRelicCatalog: ensureRelics }] =
      await Promise.all([
        import('./services/recipe-catalog'),
        import('./services/item-catalog'),
        import('./services/relic-catalog'),
      ])
    await Promise.all([
      ensureRecipeCatalog().catch((err) =>
        console.warn('[Everything Warframe] Recipe catalog warmup failed', err),
      ),
      ensureItemCatalog().catch((err) =>
        console.warn('[Everything Warframe] Item catalog warmup failed', err),
      ),
      ensureRelics().catch((err) =>
        console.warn('[Everything Warframe] Relic catalog warmup failed', err),
      ),
      ensureWfinfoPrices().catch((err) =>
        console.warn('[Everything Warframe] WFInfo price warmup failed', err),
      ),
    ])
    console.info('[Everything Warframe] Companion catalogs warm')
    void import('./services/lfg-hub')
      .then((m) => m.warmLfg())
      .then(() => console.info('[Everything Warframe] LFG hub warm'))
      .catch((err) =>
        console.warn('[Everything Warframe] LFG warmup failed', err instanceof Error ? err.message : err),
      )
  } catch (err) {
    console.warn(
      '[Everything Warframe] Companion catalog warmup failed',
      err instanceof Error ? err.message : err,
    )
  }
}

async function refreshWorldstate(force = false): Promise<WorldstateSnapshot> {
  if (!force && worldstateCache) {
    const age = Date.now() - new Date(worldstateCache.fetchedAt).getTime()
    if (age < 15_000) return worldstateCache
  }
  try {
    worldstateCache = await fetchWorldstate()
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Worldstate request failed'
    console.error('[Everything Warframe] Worldstate fetch failed', err)
    if (worldstateCache) {
      worldstateCache = {
        ...worldstateCache,
        error: message,
        stale: true,
      }
    } else {
      worldstateCache = {
        fetchedAt: '',
        error: message,
        stale: true,
        cycles: [],
        fissures: [],
        baro: null,
        nightwave: null,
        arbitration: null,
        invasions: [],
        archonHunt: null,
        deepArchimedea: null,
        sortie: null,
        alerts: [],
        circuit: null,
      }
    }
  }
  broadcastWorldstate(worldstateCache)
  try {
    if (worldstateCache.arbitration?.node) {
      const { noteActiveArbitration } = await import('./services/arbitration-log')
      noteActiveArbitration(worldstateCache.arbitration.node)
    }
  } catch {
    // ignore
  }
  try {
    const { checkBaroArrivalNotify } = await import('./services/baro-arrival')
    checkBaroArrivalNotify(worldstateCache)
  } catch {
    // ignore
  }
  scheduleWorldstateExpiryCheck()
  return worldstateCache
}

function raiseCompanion() {
  if (!companionWindow || companionWindow.isDestroyed()) return
  companionAutoMinimized = false
  // Same tier as overlay (screen-saver), then moveTop so the companion wins
  companionWindow.setAlwaysOnTop(true, 'screen-saver')
  companionWindow.show()
  companionWindow.focus()
  companionWindow.moveTop()
}

function loadCompanionContent(win: BrowserWindow) {
  const distIndex = path.join(__dirname, '../dist/index.html')

  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.error(`[Everything Warframe] Companion failed to load (${code}): ${desc} — ${url}`)
    if (isDev && url.startsWith(DEV_URL)) {
      console.warn('[Everything Warframe] Falling back to production dist build for companion')
      void win.loadFile(distIndex, { query: { window: 'companion' } })
    }
  })

  if (isDev) {
    void win.loadURL(`${DEV_URL}/?window=companion`)
  } else {
    void win.loadFile(distIndex, { query: { window: 'companion' } })
  }
}

function createCompanionWindow() {
  if (companionWindow && !companionWindow.isDestroyed()) {
    raiseCompanion()
    return companionWindow
  }

  const appIcon = getAppIcon()
  companionWindow = new BrowserWindow({
    width: 1100,
    height: 740,
    minWidth: 900,
    minHeight: 600,
    backgroundColor: '#0b1218',
    title: 'Everything Warframe',
    show: false,
    autoHideMenuBar: true,
    icon: appIcon.isEmpty() ? undefined : appIcon,
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  })

  loadCompanionContent(companionWindow)

  companionWindow.once('ready-to-show', () => {
    const settings = loadSettings()
    if (settings.quietMode && settings.onboarding.checklistDismissed) {
      companionWindow?.hide()
    } else {
      raiseCompanion()
    }
  })

  companionWindow.on('focus', () => {
    if (companionWindow && !companionWindow.isDestroyed()) {
      companionWindow.setAlwaysOnTop(true, 'screen-saver')
      companionWindow.moveTop()
    }
  })

  companionWindow.on('blur', () => {
    // Keep elevated so the overlay cannot bury the companion while it stays open
    if (companionWindow && !companionWindow.isDestroyed() && companionWindow.isVisible()) {
      companionWindow.setAlwaysOnTop(true, 'screen-saver')
    }
  })

  companionWindow.on('close', () => {
    const current = loadSettings()
    if (current.onboarding.trayTipShown) return
    const next = updateSettings({
      onboarding: { ...current.onboarding, trayTipShown: true },
    })
    broadcastSettings(next)
    if (Notification.isSupported()) {
      const openKey = current.hotkeys.openCompanion || 'Alt+Shift+C'
      const tip = new Notification({
        title: 'Everything Warframe is still running',
        body: `Companion closed to the tray. Click the tray icon or press ${openKey} to reopen.`,
      })
      tip.on('click', () => createCompanionWindow())
      tip.show()
    }
  })

  companionWindow.on('closed', () => {
    companionWindow = null
  })

  // Safety: show even if ready-to-show is delayed
  setTimeout(() => raiseCompanion(), 750)

  return companionWindow
}

function restoreOverlayGeometry(win: BrowserWindow) {
  try {
    applyOverlayWindowBounds(win, loadSettings())
  } catch {
    // Wayland may ignore programmatic moves; best-effort.
    try {
      const display = resolveOcrDisplay()
      win.setBounds({
        x: display.bounds.x,
        y: display.bounds.y,
        width: display.bounds.width,
        height: display.bounds.height,
      })
    } catch {
      // ignore
    }
  }
  try {
    win.setOpacity(1)
  } catch {
    // ignore
  }
  try {
    win.setAlwaysOnTop(true, 'screen-saver')
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  } catch {
    // ignore
  }
}

function syncLogWatcherInterval() {
  const settings = loadSettings()
  const ocrOn = settings.modules.relics || settings.modules.rivens
  // fs.watch drives near-instant ticks; poll is a reliability fallback only.
  const ms =
    process.platform === 'linux'
      ? ocrOn
        ? 1200
        : 2500
      : ocrOn
        ? settings.gamePerformanceMode
          ? 1600
          : 1200
        : 2500
  logWatcher.start(ms)
}

function noteCaptureIdleAfterScan() {
  if (!loadSettings().gamePerformanceMode) return
  // Relic/riven OCR needs a hot DXGI/PipeWire stream — don't cold-start mid-fissure.
  const ocrOn = loadSettings().modules.relics || loadSettings().modules.rivens
  if (ocrOn) return
  schedulePersistentCaptureIdleRelease(45_000)
}

function refreshTrayUi() {
  if (!tray) return
  const settings = loadSettings()
  const armed = settings.overlayVisible
  const showing = isOverlayEffectivelyVisible(settings)
  const tip = !armed
    ? 'Everything Warframe — Overlay OFF'
    : showing
      ? 'Everything Warframe — Overlay ON'
      : 'Everything Warframe — Overlay armed (waiting for Warframe)'
  try {
    tray.setToolTip(tip)
  } catch {
    // ignore
  }
  try {
    tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: 'Open Companion',
          click: () => createCompanionWindow(),
        },
        {
          label: armed
            ? showing
              ? 'Overlay: ON (click to hide)'
              : 'Overlay: armed — waiting for Warframe (click to disarm)'
            : 'Overlay: OFF (click to show)',
          click: () => setOverlayVisible(!loadSettings().overlayVisible, { announce: true }),
        },
        {
          label: settings.overlayOnlyInWarframe
            ? 'Only over Warframe: ON'
            : 'Only over Warframe: OFF',
          click: () => {
            const next = updateSettings({
              overlayOnlyInWarframe: !loadSettings().overlayOnlyInWarframe,
            })
            broadcastSettings(next)
            void refreshOverlayWarframeGate({ force: true }).then(() => {
              syncOverlayWindowVisibility({ silent: true })
              refreshTrayUi()
            })
          },
        },
        {
          label: 'Move / Lock Panels',
          click: () => toggleLayoutEditMode(),
        },
        { type: 'separator' },
        {
          label: 'Uninstall…',
          click: () => {
            void (async () => {
              const info = getUninstallInfo()
              const { response } = await dialog.showMessageBox({
                type: 'question',
                buttons: info.canLaunchUninstaller
                  ? ['Run uninstaller', 'Cancel']
                  : process.platform === 'win32'
                    ? ['Open Apps settings', 'Cancel']
                    : ['OK', 'Cancel'],
                defaultId: 0,
                cancelId: 1,
                title: 'Uninstall Everything Warframe',
                message: 'Remove Everything Warframe?',
                detail: info.guidance,
              })
              if (response !== 0) return
              if (info.canLaunchUninstaller || process.platform === 'win32') {
                await launchUninstaller()
              } else {
                createCompanionWindow()
              }
            })()
          },
        },
        {
          label: 'Quit',
          click: () => {
            app.quit()
          },
        },
      ]),
    )
  } catch {
    // ignore
  }
}

function announceOverlayVisibility(visible: boolean) {
  try {
    shell.beep()
  } catch {
    // ignore
  }
  if (Notification.isSupported()) {
    try {
      const tip = new Notification({
        title: visible ? 'Overlay ON' : 'Overlay OFF',
        body: visible
          ? 'Everything Warframe overlay is visible over the game.'
          : 'Everything Warframe overlay is hidden.',
        silent: false,
      })
      tip.show()
    } catch {
      // ignore
    }
  }
  refreshTrayUi()
}

let hideOverlayTimer: NodeJS.Timeout | null = null
/** Cached Warframe focus/running gate for overlayOnlyInWarframe. */
let overlayWarframeGateOk = true
let overlayGateTimer: NodeJS.Timeout | null = null
let overlayGateRefreshInFlight = false

function isOverlayEffectivelyVisible(settings = loadSettings()): boolean {
  if (!settings.overlayVisible) return false
  // Layout unlock makes the overlay focusable; clicking a panel steals OS focus from
  // Warframe and would otherwise trip overlayOnlyInWarframe → hide mid-drag.
  if (settings.layoutEditMode) return true
  if (!settings.overlayOnlyInWarframe) return true
  return overlayWarframeGateOk
}

/** Central overlay show/hide. Pass announce for hotkey/tray toggles. */
function setOverlayVisible(visible: boolean, opts?: { announce?: boolean }) {
  const next = updateSettings({ overlayVisible: visible })
  syncOverlayWindowVisibility({
    // Keep window up briefly so the on-screen OFF cue can paint.
    delayHideMs: opts?.announce && !visible ? 900 : 0,
    forceAnnounceVisible: opts?.announce ? visible : undefined,
  })
  broadcastSettings(next)
  if (opts?.announce) announceOverlayVisibility(next.overlayVisible)
  else refreshTrayUi()
  return next.overlayVisible
}

/**
 * Show/hide the overlay BrowserWindow from effective visibility
 * (user toggle ∧ optional Warframe-focus gate).
 */
function syncOverlayWindowVisibility(opts?: {
  delayHideMs?: number
  /** When announcing toggle OFF, pass false so the cue can paint before hide. */
  forceAnnounceVisible?: boolean
  /** Skip companion/overlay ON/OFF cue broadcasts (Warframe gate changes). */
  silent?: boolean
}) {
  const settings = loadSettings()
  const visible =
    opts?.forceAnnounceVisible === false
      ? false
      : isOverlayEffectivelyVisible(settings)
  applyOverlayWindowVisible(visible, opts)
}

function applyOverlayWindowVisible(
  visible: boolean,
  opts?: { delayHideMs?: number; silent?: boolean },
) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  if (hideOverlayTimer) {
    clearTimeout(hideOverlayTimer)
    hideOverlayTimer = null
  }
  if (visible) {
    applyOverlayPerformanceMode(true)
    restoreOverlayGeometry(overlayWindow)
    overlayWindow.showInactive()
    try {
      overlayWindow.setAlwaysOnTop(true, 'screen-saver')
    } catch {
      // ignore
    }
    // Re-raise companion so overlay creation/show never hides it
    if (companionWindow && !companionWindow.isDestroyed() && companionWindow.isVisible()) {
      raiseCompanion()
    }
    if (!opts?.silent) broadcastOverlayVisibility(true)
    return
  }

  if (!opts?.silent) broadcastOverlayVisibility(false)
  const hide = () => {
    hideOverlayTimer = null
    if (!overlayWindow || overlayWindow.isDestroyed()) return
    // Skip hide if the overlay should be showing again (toggle or Warframe focus).
    if (isOverlayEffectivelyVisible()) return
    overlayWindow.hide()
    applyOverlayPerformanceMode(false)
  }
  const delay = opts?.delayHideMs ?? 0
  if (delay > 0) hideOverlayTimer = setTimeout(hide, delay)
  else hide()
}

let companionAutoMinimized = false

async function refreshOverlayWarframeGate(opts?: { force?: boolean }) {
  if (overlayGateRefreshInFlight) return
  const settings = loadSettings()
  if (!settings.overlayOnlyInWarframe && !settings.autoMinimizeCompanionOnWarframeFocus) {
    if (!overlayWarframeGateOk) {
      overlayWarframeGateOk = true
      syncOverlayWindowVisibility({ silent: true })
    }
    return
  }

  overlayGateRefreshInFlight = true
  try {
    if (opts?.force) invalidateWarframeProcessCache()
    const state = await getWarframeProcessState()
    const nextOk = state.foreground

    if (settings.autoMinimizeCompanionOnWarframeFocus) {
      if (
        state.foreground &&
        companionWindow &&
        !companionWindow.isDestroyed() &&
        companionWindow.isVisible() &&
        !companionWindow.isMinimized()
      ) {
        companionWindow.minimize()
        companionAutoMinimized = true
      } else if (
        !state.foreground &&
        companionAutoMinimized &&
        companionWindow &&
        !companionWindow.isDestroyed() &&
        companionWindow.isMinimized()
      ) {
        companionWindow.restore()
        companionAutoMinimized = false
      }
    }

    if (!settings.overlayOnlyInWarframe) {
      if (!overlayWarframeGateOk) {
        overlayWarframeGateOk = true
        syncOverlayWindowVisibility({ silent: true })
      }
      return
    }

    if (nextOk === overlayWarframeGateOk) return
    overlayWarframeGateOk = nextOk
    console.info(
      `[Everything Warframe] Overlay Warframe gate → ${nextOk ? 'show' : 'hide'}` +
        ` (running=${state.running} foreground=${state.foreground})`,
    )
    syncOverlayWindowVisibility({ silent: true })
    refreshTrayUi()
  } finally {
    overlayGateRefreshInFlight = false
  }
}

function startOverlayWarframeGateWatcher() {
  if (overlayGateTimer) return
  // Assume blocked until the first poll when the gate is enabled (avoids a desktop flash).
  overlayWarframeGateOk = !loadSettings().overlayOnlyInWarframe
  void refreshOverlayWarframeGate({ force: true })
  overlayGateTimer = setInterval(() => {
    void refreshOverlayWarframeGate()
  }, 1500)
}

function stopOverlayWarframeGateWatcher() {
  if (!overlayGateTimer) return
  clearInterval(overlayGateTimer)
  overlayGateTimer = null
}

/** Migrate old side-panel riven anchors to the horizontal strip above Cycle cards. */
function fixLegacyRivenAnchor() {
  const settings = loadSettings()
  const rivens = settings.panelAnchors.rivens
  if (!rivens) return
  const { width, height } = resolveOcrDisplay().bounds
  const next = defaultRivenAnchor(width, height)
  const knownSidePanel =
    (rivens.x === 1460 && rivens.y === 290) ||
    (rivens.x === 1465 && rivens.y === 173) ||
    (rivens.x === 1555 && rivens.y === 167) ||
    (rivens.x === 1580 && rivens.y === 146)
  // Previous default sat beside the cards (far right, upper third).
  const looksLikeSidePanel = rivens.x > width * 0.55 && rivens.y < height * 0.4
  if (!knownSidePanel && !looksLikeSidePanel) return
  if (rivens.x === next.x && rivens.y === next.y) return
  updateSettings({
    panelAnchors: {
      ...settings.panelAnchors,
      rivens: next,
    },
  })
  console.info(
    `[Everything Warframe] Repositioned riven overlay above Cycle cards for ${width}×${height} → (${next.x}, ${next.y})`,
  )
}

function checkWorldstateExpiries() {
  if (!worldstateCache) return
  if (!hasExpiredWorldstate(worldstateCache)) return
  const now = Date.now()
  if (now - lastExpiryRefresh < 5000) return
  lastExpiryRefresh = now
  void refreshWorldstate(true).catch((err) =>
    console.error('[Everything Warframe] Expiry refresh failed', err),
  )
}

/** Fire once at the next known expiry instead of polling every 2s. */
function scheduleWorldstateExpiryCheck() {
  if (expiryTimer) {
    clearTimeout(expiryTimer)
    expiryTimer = null
  }
  const data = worldstateCache
  if (!data) {
    expiryTimer = setTimeout(() => {
      expiryTimer = null
      scheduleWorldstateExpiryCheck()
    }, 30_000)
    return
  }
  if (hasExpiredWorldstate(data)) {
    checkWorldstateExpiries()
    return
  }
  const nextMs = nextWorldstateExpiryMs(data)
  const delay =
    nextMs == null
      ? 60_000
      : Math.min(Math.max(nextMs - Date.now() + 250, 750), 5 * 60_000)
  expiryTimer = setTimeout(() => {
    expiryTimer = null
    checkWorldstateExpiries()
    scheduleWorldstateExpiryCheck()
  }, delay)
}

function applyLayoutEditMode(enabled: boolean) {
  if (!overlayWindow || overlayWindow.isDestroyed()) return
  setOverlayClickThrough(overlayWindow, !enabled)
}

const HOTKEY_FALLBACKS: Record<keyof AppSettings['hotkeys'], string[]> = {
  toggleOverlay: ['Alt+Shift+V', 'Alt+Shift+O', 'F8', 'CommandOrControl+Alt+V'],
  openCompanion: ['Alt+Shift+C', 'Alt+Shift+L', 'F9', 'CommandOrControl+Alt+C'],
  refreshWorldstate: ['Alt+Shift+R', 'F10', 'CommandOrControl+Alt+R'],
  scanRelics: ['Alt+Shift+F', 'F2', 'CommandOrControl+Alt+F'],
  dismissRelics: ['Alt+Shift+D', 'F3'],
  scanRivens: ['Alt+Shift+G', 'F4', 'CommandOrControl+Alt+G'],
  dismissRivens: ['Alt+Shift+H', 'F6'],
  editLayout: ['Control+Tab', 'Alt+Shift+E', 'Alt+Shift+X', 'F7'],
  toggleWorldstatePanels: ['Alt+Shift+W', 'CommandOrControl+Alt+W'],
  toggleQuietFocus: ['Alt+Shift+Q', 'CommandOrControl+Alt+Q'],
  toggleModuleCycles: [],
  toggleModuleFissures: [],
  toggleModuleBaro: [],
  toggleModuleNightwave: [],
  toggleModuleArbitration: [],
  toggleModuleInvasions: [],
  toggleModuleArchon: [],
  toggleModuleDeepArchimedea: [],
}

/** Snapshot of worldstate module enables before a clear — restored on next press. */
let worldstatePanelsSnapshot: Partial<Record<ModuleId, boolean>> | null = null

function toggleQuietFocus() {
  const settings = loadSettings()
  if (settings.quietFocusActive) {
    const backup = settings.quietFocusModulesBackup || worldstatePanelsSnapshot
    const modules = { ...settings.modules }
    if (backup) {
      for (const id of OVERLAY_MODULE_IDS) {
        if (backup[id] !== undefined) modules[id] = Boolean(backup[id])
      }
    } else {
      for (const id of WORLDSTATE_MODULE_IDS) {
        if (id !== 'fissures') modules[id] = true
      }
    }
    const next = updateSettings({
      modules,
      quietFocusActive: false,
      quietFocusModulesBackup: null,
    })
    broadcastSettings(next)
    console.info('[Everything Warframe] Quiet focus off — modules restored')
    return
  }

  const snap: Partial<Record<ModuleId, boolean>> = {}
  for (const id of OVERLAY_MODULE_IDS) {
    snap[id] = settings.modules[id]
  }
  const modules = { ...settings.modules }
  for (const id of OVERLAY_MODULE_IDS) {
    modules[id] = id === 'fissures' || id === 'relics' || id === 'rivens'
  }
  const next = updateSettings({
    modules,
    quietFocusActive: true,
    quietFocusModulesBackup: snap,
  })
  broadcastSettings(next)
  console.info('[Everything Warframe] Quiet focus on — fissures + OCR only')
}

function toggleModulePanel(id: ModuleId) {
  const settings = loadSettings()
  const next = setModuleEnabled(id, !settings.modules[id])
  broadcastSettings(next)
  console.info(
    `[Everything Warframe] Module ${id} → ${next.modules[id] ? 'on' : 'off'} (hotkey)`,
  )
}

function toggleWorldstatePanels() {
  const settings = loadSettings()
  const anyOn = WORLDSTATE_MODULE_IDS.some((id) => settings.modules[id])

  if (anyOn) {
    const snap: Partial<Record<ModuleId, boolean>> = {}
    for (const id of WORLDSTATE_MODULE_IDS) {
      snap[id] = settings.modules[id]
    }
    worldstatePanelsSnapshot = snap
    const modules = { ...settings.modules }
    for (const id of WORLDSTATE_MODULE_IDS) {
      modules[id] = false
    }
    const next = updateSettings({ modules })
    broadcastSettings(next)
    console.info('[Everything Warframe] Worldstate panels hidden (hotkey)')
    return
  }

  if (worldstatePanelsSnapshot) {
    const modules = { ...settings.modules }
    for (const id of WORLDSTATE_MODULE_IDS) {
      modules[id] = Boolean(worldstatePanelsSnapshot[id])
    }
    worldstatePanelsSnapshot = null
    const next = updateSettings({ modules })
    broadcastSettings(next)
    console.info('[Everything Warframe] Worldstate panels restored (hotkey)')
    return
  }

  // Nothing on and no snapshot — turn defaults back on for the common set.
  const modules = { ...settings.modules }
  for (const id of WORLDSTATE_MODULE_IDS) {
    modules[id] = true
  }
  const next = updateSettings({ modules })
  broadcastSettings(next)
  console.info('[Everything Warframe] Worldstate panels enabled (hotkey, no snapshot)')
}

function toggleLayoutEditMode() {
  const next = updateSettings({ layoutEditMode: !loadSettings().layoutEditMode })
  applyLayoutEditMode(next.layoutEditMode)
  if (next.layoutEditMode) {
    // Keep the window up while rearranging even if Warframe briefly loses focus.
    syncOverlayWindowVisibility({ silent: true })
  } else {
    void refreshOverlayWarframeGate({ force: true })
  }
  broadcastSettings(next)
}

function registerOneHotkey(
  preferred: string,
  fallbacks: string[],
  handler: () => void,
  label: string,
): string | null {
  const candidates = [preferred, ...fallbacks.filter((a) => a !== preferred)]
  for (const accelerator of candidates) {
    try {
      // Clear this accelerator first in case a prior attempt partially bound it
      globalShortcut.unregister(accelerator)
      const ok = globalShortcut.register(accelerator, handler)
      if (ok) {
        if (accelerator !== preferred) {
          console.warn(
            `[Everything Warframe] ${label}: "${preferred}" unavailable, using "${accelerator}"`,
          )
        } else {
          console.info(`[Everything Warframe] ${label}: registered "${accelerator}"`)
        }
        return accelerator
      }
    } catch (err) {
      console.warn(`[Everything Warframe] ${label}: error registering "${accelerator}"`, err)
    }
  }
  console.error(`[Everything Warframe] ${label}: all accelerators failed`)
  return null
}

function registerHotkeys() {
  globalShortcut.unregisterAll()
  const settings = loadSettings()
  const nextHotkeys = { ...settings.hotkeys }
  let changed = false
  const status: HotkeyRegistration[] = []

  const bind = (
    id: keyof AppSettings['hotkeys'],
    handler: () => void,
  ) => {
    const requested = settings.hotkeys[id]
    if (!requested?.trim()) {
      status.push({ id, requested: requested || '', registered: null, ok: false })
      return null
    }
    const registered = registerOneHotkey(requested, HOTKEY_FALLBACKS[id], handler, id)
    status.push({ id, requested, registered, ok: Boolean(registered) })
    if (registered && registered !== requested) {
      nextHotkeys[id] = registered
      changed = true
    }
    return registered
  }

  bind('toggleOverlay', () => {
    setOverlayVisible(!loadSettings().overlayVisible, { announce: true })
  })
  bind('openCompanion', () => {
    createCompanionWindow()
  })
  bind('refreshWorldstate', () => {
    void refreshWorldstate(true)
  })
  bind('scanRelics', () => {
    void runRelicScan('manual')
  })
  bind('dismissRelics', () => {
    dismissRelicPopup()
  })
  bind('scanRivens', () => {
    void runRivenScan('manual')
  })
  bind('dismissRivens', () => {
    dismissRivenPopup()
  })
  bind('editLayout', () => {
    toggleLayoutEditMode()
  })
  bind('toggleWorldstatePanels', () => {
    toggleWorldstatePanels()
  })
  bind('toggleQuietFocus', () => {
    toggleQuietFocus()
  })
  for (const hotkeyId of MODULE_TOGGLE_HOTKEY_IDS) {
    const moduleId = MODULE_TOGGLE_HOTKEY_TO_ID[hotkeyId]
    bind(hotkeyId, () => toggleModulePanel(moduleId))
  }

  lastHotkeyStatus = status
  broadcastHotkeyStatus()

  if (changed) {
    const next = updateSettings({ hotkeys: nextHotkeys })
    broadcastSettings(next)
  }
}

function createTray() {
  try {
    let icon = getTrayIcon()
    if (icon.isEmpty()) {
      console.warn('[Everything Warframe] Tray icon missing — using fallback glyph')
      icon = nativeImage.createFromDataURL(
        'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAACAAAAAgCAYAAABzenr0AAAAbElEQVR4Ae3XwQnAIAxA0Z7dO7iDR3ADZ3AEd3AER3AER3AHZ5DfQyCBhEBKeQehIeTjJUmSJEmS/g0A7gCuAO4ALgDOAI4A9gC2ANYAlgBmACYAhgA6AJoAKgCKAJIAYgDC/zvP8zzP8zzP8/wD2wM3J5oF2mYAAAAASUVORK5CYII=',
      )
    }
    tray = new Tray(icon)
    refreshTrayUi()
    tray.on('double-click', () => createCompanionWindow())
    tray.on('click', () => createCompanionWindow())
  } catch (err) {
    console.error('[Everything Warframe] Tray creation failed (non-fatal)', err)
  }
}

function getPrimaryDisplayInfo() {
  return getOcrDisplayInfo()
}

function registerIpc() {
  ipcMain.handle('settings:get', () => loadSettings())
  ipcMain.handle('settings:export', async () => {
    const settings = loadSettings()
    const result = await dialog.showSaveDialog({
      title: 'Export Everything Warframe settings',
      defaultPath: `everything-warframe-settings-${settings.lastSeenVersion || 'backup'}.json`,
      filters: [{ name: 'JSON', extensions: ['json'] }],
    })
    if (result.canceled || !result.filePath) return { ok: false, error: 'cancelled' }
    try {
      // Strip secrets that shouldn't leave the machine casually.
      const { ...safe } = settings
      const payload = {
        ...safe,
        // Keep JWT out of exports — re-link WFM after import.
        _note: 'warframe.market JWT is not included; re-link Account after import.',
      }
      fs.writeFileSync(result.filePath, JSON.stringify(payload, null, 2), 'utf8')
      return { ok: true, path: result.filePath }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Export failed' }
    }
  })
  ipcMain.handle('settings:import', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Import Everything Warframe settings',
      filters: [{ name: 'JSON', extensions: ['json'] }],
      properties: ['openFile'],
    })
    if (result.canceled || !result.filePaths[0]) return { ok: false, error: 'cancelled' }
    try {
      const raw = JSON.parse(fs.readFileSync(result.filePaths[0], 'utf8')) as Partial<AppSettings>
      delete (raw as { _note?: string })._note
      delete (raw as { _syncedAt?: string })._syncedAt
      const next = updateSettings(raw)
      broadcastSettings(next)
      registerHotkeys()
      syncOverlayWindowVisibility({ silent: true })
      scheduleCloudSettingsPush(next)
      return { ok: true }
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : 'Import failed' }
    }
  })
  ipcMain.handle('settings:cloudPickFolder', async () => {
    const res = await pickCloudSyncFolder()
    if (res.ok) broadcastSettings(loadSettings())
    return res
  })
  ipcMain.handle('settings:cloudClear', () => {
    clearCloudSyncPath()
    const next = loadSettings()
    broadcastSettings(next)
    return { ok: true }
  })
  ipcMain.handle('settings:cloudPush', () => {
    const res = pushSettingsToCloud()
    return res
  })
  ipcMain.handle('settings:cloudPull', (_e, force?: boolean) => {
    const res = pullSettingsFromCloud({ force: Boolean(force) })
    if (res.ok && res.imported) {
      const next = loadSettings()
      broadcastSettings(next)
      registerHotkeys()
      syncOverlayWindowVisibility({ silent: true })
      syncLogWatcherInterval()
    }
    return res
  })
  ipcMain.handle('settings:update', (e, partial: Partial<AppSettings>) => {
    const next = updateSettings(partial)
    if (partial.hotkeys) registerHotkeys()
    if (partial.layoutEditMode !== undefined) {
      applyLayoutEditMode(next.layoutEditMode)
      if (next.layoutEditMode) syncOverlayWindowVisibility({ silent: true })
      else void refreshOverlayWarframeGate({ force: true })
    }
    if (partial.overlayVisible !== undefined) {
      syncOverlayWindowVisibility()
      refreshTrayUi()
    }
    if (partial.overlayOnlyInWarframe !== undefined) {
      void refreshOverlayWarframeGate({ force: true }).then(() => {
        syncOverlayWindowVisibility({ silent: true })
        refreshTrayUi()
      })
    }
    if (partial.ocrDisplayId !== undefined) {
      clearDisplayRemountWarning()
      invalidateCaptureCache()
      disposePersistentCapture()
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        restoreOverlayGeometry(overlayWindow)
      }
    }
    if (partial.onboarding?.linuxCaptureAck === true && process.platform === 'linux') {
      void warmScreenCapture()
    }
    if (
      partial.widgetServerEnabled !== undefined ||
      partial.widgetServerPort !== undefined
    ) {
      void syncWidgetServerFromSettings()
    }
    if (
      partial.marketBuyAlertEnabled !== undefined ||
      partial.marketBuyTargets !== undefined ||
      partial.modules !== undefined
    ) {
      syncMarketBuyAlertsFromSettings()
    }
    if (
      partial.modules !== undefined ||
      partial.panelAnchors !== undefined ||
      partial.gamePerformanceMode !== undefined ||
      partial.overlayTightBounds !== undefined ||
      partial.overlayScale !== undefined ||
      partial.layoutEditMode !== undefined
    ) {
      if (overlayWindow && !overlayWindow.isDestroyed()) {
        restoreOverlayGeometry(overlayWindow)
      }
    }
    if (partial.modules !== undefined || partial.gamePerformanceMode !== undefined) {
      syncLogWatcherInterval()
    }
    scheduleCloudSettingsPush(next)
    // Caller already applied the returned settings — skip echoing to that window.
    broadcastSettings(next, e.sender)
    return next
  })
  ipcMain.handle('settings:setModule', (e, id: ModuleId, enabled: boolean) => {
    const next = setModuleEnabled(id, enabled)
    broadcastSettings(next, e.sender)
    if (id === 'market') syncMarketBuyAlertsFromSettings()
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      restoreOverlayGeometry(overlayWindow)
    }
    syncLogWatcherInterval()
    if (enabled && (id === 'relics' || id === 'rivens')) {
      void runOcrWarmup()
    } else if (
      (id === 'relics' || id === 'rivens') &&
      !next.modules.relics &&
      !next.modules.rivens
    ) {
      setOcrWarmup('skipped', 'Relics/Rivens off')
    }
    return next
  })
  ipcMain.handle('display:getPrimary', () => getPrimaryDisplayInfo())
  ipcMain.handle('display:list', () => listDisplayChoices())
  ipcMain.handle('worldstate:get', async () => refreshWorldstate(false))
  ipcMain.handle('worldstate:refresh', async () => refreshWorldstate(true))
  ipcMain.handle('overlay:toggle', () => {
    return setOverlayVisible(!loadSettings().overlayVisible, { announce: true })
  })
  ipcMain.handle('overlay:contentOrigin', () => getOverlayContentOrigin())
  ipcMain.handle('overlay:setLayoutEdit', (_e, enabled: boolean) => {
    const next = updateSettings({ layoutEditMode: enabled })
    applyLayoutEditMode(enabled)
    if (enabled) syncOverlayWindowVisibility({ silent: true })
    else void refreshOverlayWarframeGate({ force: true })
    broadcastSettings(next)
    return next
  })
  ipcMain.handle('companion:navigate', (_e, tab: string) => {
    createCompanionWindow()
    raiseCompanion()
    const t = typeof tab === 'string' ? tab.trim() : ''
    if (t && companionWindow && !companionWindow.isDestroyed()) {
      companionWindow.webContents.send('companion:navigate', t)
    }
    return true
  })
  ipcMain.handle('overlay:toggleQuietFocus', () => {
    toggleQuietFocus()
    return loadSettings()
  })
  ipcMain.handle('dialog:pickEeLog', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select Warframe EE.log',
      properties: ['openFile'],
      filters: [{ name: 'Log files', extensions: ['log', 'txt'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const next = updateSettings({ eeLogPath: result.filePaths[0] })
    logWatcher.setPath(result.filePaths[0])
    broadcastSettings(next)
    return result.filePaths[0]
  })
  ipcMain.handle('dialog:pickInventory', async () => {
    const result = await dialog.showOpenDialog({
      title: 'Select inventory.json or AlecaFrame lastData.dat',
      properties: ['openFile'],
      filters: [
        { name: 'Inventory', extensions: ['json', 'dat'] },
        { name: 'JSON', extensions: ['json'] },
        { name: 'AlecaFrame', extensions: ['dat'] },
      ],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const loaded = useInventoryFile(
      result.filePaths[0],
      result.filePaths[0].toLowerCase().endsWith('.dat') ? 'alecaframe' : 'manual',
    )
    broadcastSettings(loadSettings())
    broadcastInventory()
    return loaded.ok ? loaded.path ?? null : null
  })
  ipcMain.handle('log:detectEe', () => {
    const found = detectEeLogPath()
    if (found) {
      const next = updateSettings({ eeLogPath: found })
      logWatcher.setPath(found)
      broadcastSettings(next)
    }
    return found
  })
  ipcMain.handle('inventory:status', () => getInventoryStatus())
  ipcMain.handle('inventory:consent', (_e, consent: boolean) => {
    const status = setInventoryConsent(consent)
    broadcastSettings(loadSettings())
    broadcastInventory()
    return status
  })
  ipcMain.handle('inventory:detect', () => {
    const status = getInventoryStatus()
    broadcastInventory()
    return status
  })
  ipcMain.handle('inventory:use', (_e, filePath: string) => {
    const result = useInventoryFile(filePath, inferInventorySource(filePath))
    broadcastSettings(loadSettings())
    broadcastInventory()
    return result
  })
  ipcMain.handle('inventory:sync', async () => {
    try {
      const result = await syncInventoryFromGame()
      if (result.ok) {
        // Don't block the IPC reply on Foundry warm — a throw here used to strand the UI.
        void warmFoundryAfterInventorySync().catch((err) => {
          console.warn(
            '[Everything Warframe] Foundry warm after inventory sync failed',
            err instanceof Error ? err.message : err,
          )
        })
      }
      broadcastSettings(loadSettings())
      broadcastInventory()
      return result
    } catch (err) {
      console.error(
        '[Everything Warframe] Inventory sync crashed',
        err instanceof Error ? err.stack || err.message : err,
      )
      return {
        ok: false,
        error: err instanceof Error ? err.message : 'Inventory sync crashed — check logs',
      }
    }
  })
  ipcMain.handle('inventory:clear', () => {
    const status = clearInventoryData()
    broadcastSettings(loadSettings())
    broadcastInventory()
    return status
  })
  ipcMain.handle('inventory:index', () => getInventoryIndex())
  ipcMain.handle('inventory:diff', () => getInventoryDiff())
  ipcMain.handle('inventory:diffHistory', async () => {
    const { getInventoryDiffHistory } = await import('./services/inventory-diff-history')
    return getInventoryDiffHistory()
  })
  ipcMain.handle('inventory:diffHistoryClear', async () => {
    const { clearInventoryDiffHistory } = await import('./services/inventory-diff-history')
    return clearInventoryDiffHistory()
  })
  ipcMain.handle('session:haul', () => getSessionHaul())
  ipcMain.handle('session:haulClear', () => clearSessionHaul())
  ipcMain.handle('session:ledger', async () => {
    const { getSessionLedger } = await import('./services/session-ledger')
    return getSessionLedger()
  })
  ipcMain.handle('loadout:get', async () => {
    const { getLoadoutSnapshot } = await import('./services/loadout')
    return getLoadoutSnapshot()
  })
  ipcMain.handle('circuit:tracker', async () => {
    const { getCircuitTracker } = await import('./services/circuit-tracker')
    return getCircuitTracker(worldstateCache?.circuit ?? null)
  })
  ipcMain.handle('arb:log', async () => {
    const { getArbitrationLog } = await import('./services/arbitration-log')
    return getArbitrationLog()
  })
  ipcMain.handle('arb:analytics', async () => {
    const { getArbitrationAnalytics } = await import('./services/arbitration-log')
    return getArbitrationAnalytics()
  })
  ipcMain.handle('arb:logClear', async () => {
    const { clearArbitrationLog } = await import('./services/arbitration-log')
    return clearArbitrationLog()
  })
  ipcMain.handle('inventory:browse', async (_e, query) => {
    const sellableOnly = Boolean(query?.sellableOnly)
    const enrichPrices = sellableOnly || Boolean(query?.enrichPrices)
    const [{ ensureRecipeCatalog, isRecipeCatalogReady }, { ensureItemCatalog, isItemCatalogReady }] =
      await Promise.all([
        import('./services/recipe-catalog'),
        import('./services/item-catalog'),
      ])

    // Prefer sync path when already warm. Only await missing pieces; never refetch
    // prices on every keystroke once the DB is in memory.
    const tasks: Promise<unknown>[] = []
    if (!isRecipeCatalogReady()) {
      tasks.push(ensureRecipeCatalog().catch(() => {}))
    }
    if (enrichPrices) {
      if (!isItemCatalogReady()) tasks.push(ensureItemCatalog().catch(() => {}))
      if (!isWfinfoPricesReady()) tasks.push(ensureWfinfoPrices().catch(() => {}))
    }
    if (tasks.length) await Promise.all(tasks)
    return browseInventory(query)
  })
  ipcMain.handle('relics:get', () => getRelicScanState())
  ipcMain.handle('ocr:warmupStatus', () => getOcrWarmupStatus())
  ipcMain.handle('relics:scan', async () => runRelicScan('manual'))
  ipcMain.handle('relics:clear', () => dismissRelicPopup())
  ipcMain.handle('relics:ackCelebration', () => {
    const state = ackRelicCelebration()
    broadcastRelicScan()
    const settings = loadSettings()
    if (!settings.onboarding.firstRelicSuccessAck) {
      const next = updateSettings({
        onboarding: { ...settings.onboarding, firstRelicSuccessAck: true },
      })
      broadcastSettings(next)
    }
    return state
  })
  ipcMain.handle('rivens:get', () => getRivenScanState())
  ipcMain.handle('rivens:scan', async () => runRivenScan('manual'))
  ipcMain.handle('rivens:clear', () => dismissRivenPopup())
  ipcMain.handle('rivens:history', async () => {
    const { getRivenHistory } = await import('./services/riven-history')
    return getRivenHistory()
  })
  ipcMain.handle('rivens:historyClear', async () => {
    const { clearRivenHistory } = await import('./services/riven-history')
    return clearRivenHistory()
  })
  ipcMain.handle('foundry:list', async (_e, filters?: FoundryListFilters) =>
    listFoundryItems(filters || {}),
  )
  ipcMain.handle('foundry:tree', async (_e, uniqueName: string) => getFoundryTree(uniqueName || ''))
  ipcMain.handle('relicPlanner:list', async (_e, query?: RelicPlannerQuery) =>
    getRelicPlanner(query || {}),
  )
  ipcMain.handle('relicPlanner:drops', async (_e, nameOrUnique: string) => {
    await ensureRelicCatalog()
    return getDropSourcesForItem(nameOrUnique || '')
  })
  ipcMain.handle(
    'setFarm:get',
    async (_e, opts?: { uniqueName?: string; search?: string }) => {
      const { getSetFarm } = await import('./services/set-farm')
      return getSetFarm(opts || {})
    },
  )
  ipcMain.handle('setFarm:fissurePath', async (_e, uniqueName: string) => {
    const { getSetFissurePath } = await import('./services/set-farm')
    const ws = await refreshWorldstate(false)
    return getSetFissurePath(typeof uniqueName === 'string' ? uniqueName : '', ws.fissures || [])
  })
  ipcMain.handle('economy:trend', async () => {
    const { getEconomyTrend } = await import('./services/economy-snapshots')
    return getEconomyTrend()
  })
  ipcMain.handle('lfg:health', async () => {
    const { lfgHealth } = await import('./services/lfg-hub')
    return lfgHealth()
  })
  ipcMain.handle('lfg:list', async (_e, opts) => {
    const { listLfg } = await import('./services/lfg-hub')
    return listLfg(opts || {})
  })
  ipcMain.handle('lfg:relicOptions', async () => {
    const { getLfgRelicOptions } = await import('./services/lfg-relic-options')
    return getLfgRelicOptions()
  })
  ipcMain.handle('lfg:create', async (_e, input) => {
    const { createLfg } = await import('./services/lfg-hub')
    return createLfg(input || {})
  })
  ipcMain.handle('lfg:join', async (_e, input) => {
    const { joinLfg } = await import('./services/lfg-hub')
    return joinLfg(input || {})
  })
  ipcMain.handle('lfg:leave', async (_e, input) => {
    const { leaveLfg } = await import('./services/lfg-hub')
    return leaveLfg(input || {})
  })
  ipcMain.handle('lfg:delete', async (_e, input) => {
    const { deleteLfg } = await import('./services/lfg-hub')
    return deleteLfg(input || {})
  })
  ipcMain.handle('lfg:extend', async (_e, input) => {
    const { extendLfg } = await import('./services/lfg-hub')
    return extendLfg(input || {})
  })
  ipcMain.handle('lfg:report', async (_e, input) => {
    const { reportLfg } = await import('./services/lfg-hub')
    return reportLfg(input || {})
  })
  ipcMain.handle('ui:desktopNotify', async (_e, payload) => {
    const title = String(payload?.title || '').trim().slice(0, 80)
    const body = String(payload?.body || '').trim().slice(0, 200)
    if (!title || !Notification.isSupported()) return false
    const tip = new Notification({ title, body: body || undefined })
    tip.show()
    return true
  })
  ipcMain.handle(
    'setProgress:list',
    async (_e, opts?: { search?: string; incompleteOnly?: boolean; limit?: number }) => {
      const { listSetProgress } = await import('./services/set-progress')
      return listSetProgress(opts || {})
    },
  )
  ipcMain.handle('mastery:list', async (_e, query?: MasteryHelperQuery) =>
    getMasteryHelper(query || {}),
  )
  ipcMain.handle('hotkeys:status', () => lastHotkeyStatus)
  ipcMain.handle('app:version', () => app.getVersion())
  ipcMain.handle('update:status', () => getUpdateStatus())
  ipcMain.handle('update:check', async () => checkForAppUpdates())
  ipcMain.handle('update:install', () => quitAndInstallUpdate())
  ipcMain.handle('bugReport:open', async (_e, draft: BugReportDraft) => openBugReport(draft))
  ipcMain.handle('bugReport:copyDiagnostics', (_e, draft?: Partial<BugReportDraft>) =>
    copyBugDiagnostics(draft),
  )
  ipcMain.handle('bugReport:pickScreenshots', async () => pickBugScreenshots())
  ipcMain.handle('bugReport:openDebugFolders', async () => openBugDebugFolders())
  ipcMain.handle('crash:pending', () => getPendingCrash())
  ipcMain.handle('crash:clearPending', () => {
    clearPendingCrash()
    return true
  })
  ipcMain.handle('crash:logTail', () => readCrashLogTail())
  ipcMain.handle('app:uninstallInfo', () => getUninstallInfo())
  ipcMain.handle('app:launchUninstaller', async () => launchUninstaller())
  ipcMain.handle('app:openWindowsAppsSettings', async () => openWindowsAppsSettings())
  ipcMain.handle('app:openUserDataFolder', async () => openUserDataFolder())
  ipcMain.handle('app:clearUserDataAndQuit', () => clearUserDataAndQuit())
  ipcMain.handle('market:lookup', async (_e, names: string[]) => {
    const list = Array.isArray(names) ? names.filter((n) => typeof n === 'string') : []
    return fetchItemQuotes(list)
  })
  ipcMain.handle('market:undercut', async (_e, name: string) =>
    fetchUndercutSuggestion(typeof name === 'string' ? name : ''),
  )
  ipcMain.handle('market:priceHistory', async (_e, name: string) => {
    const { getMarketPriceHistory } = await import('./services/market-prices')
    return getMarketPriceHistory(typeof name === 'string' ? name : '')
  })
  ipcMain.handle('market:wfmSession', async () => getWfmSession())
  ipcMain.handle('market:wfmSetJwt', async (_e, jwt: string) =>
    setWfmJwt(typeof jwt === 'string' ? jwt : ''),
  )
  ipcMain.handle('market:wfmClear', async () => clearWfmJwt())
  ipcMain.handle('market:wfmOrders', async () => fetchWfmMyOrders())
  ipcMain.handle('market:wfmDeleteOrder', async (_e, orderId: string) =>
    deleteWfmOrder(typeof orderId === 'string' ? orderId : ''),
  )
  ipcMain.handle('market:wfmUpdateOrder', async (_e, input) => updateWfmOrder(input || {}))
  ipcMain.handle('market:tradeLog', async () => getMarketTradeLog())
  ipcMain.handle('market:tradeLogAdd', async (_e, input) => addMarketTrade(input || {}))
  ipcMain.handle('market:tradeLogRemove', async (_e, id: string) =>
    removeMarketTrade(typeof id === 'string' ? id : ''),
  )
  ipcMain.handle('market:tradeLogClear', async () => clearMarketTradeLog())
  ipcMain.handle('market:wfmContracts', async () => fetchWfmMyContracts())
  ipcMain.handle('market:wfmDeleteContract', async (_e, contractId: string) =>
    deleteWfmContract(typeof contractId === 'string' ? contractId : ''),
  )
  ipcMain.handle('market:wfmSearchItems', async (_e, query: string) =>
    searchWfmItems(typeof query === 'string' ? query : ''),
  )
  ipcMain.handle('market:wfmCreateOrder', async (_e, input) => createWfmOrder(input || {}))
  ipcMain.handle('market:wfmCreateContract', async (_e, input) => createWfmContract(input || {}))
  ipcMain.handle('shell:openExternal', async (_e, url: string) => {
    if (typeof url !== 'string' || !/^https?:\/\//i.test(url)) return false
    await shell.openExternal(url)
    return true
  })
  ipcMain.handle('capture:test', async () => {
    try {
      const ok = await warmScreenCapture()
      if (ok) {
        return {
          ok: true,
          message: 'Capture ready — screen share authorized for OCR.',
        }
      }
      return {
        ok: false,
        message:
          'Capture not ready. Accept the single screen-share dialog, pick Warframe’s monitor, and leave sharing on. If two dialogs appeared, cancel both and try again after updating.',
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : String(err)
      const timedOut = /timed out/i.test(raw)
      return {
        ok: false,
        message: timedOut
          ? 'Screen-share dialog timed out. Cancel any stuck portal windows, then click Authorize capture once.'
          : raw || 'Capture test failed',
      }
    }
  })
  ipcMain.handle('linux:health', async () => {
    const { getLinuxHealthSnapshot } = await import('./services/linux-health')
    return getLinuxHealthSnapshot()
  })
  ipcMain.handle('widgets:status', () => getWidgetServerStatus())
}

app.whenReady().then(async () => {
  installCrashReporting()
  registerIpc()
  setWidgetWorldstateProvider(() => worldstateCache)

  let settings = loadSettings()
  if (settings.settingsCloudSyncAuto && settings.settingsCloudSyncPath?.trim()) {
    const pull = pullSettingsFromCloud({ force: false })
    if (pull.ok && pull.imported) {
      console.info('[Everything Warframe] Pulled newer settings from cloud sync folder')
      settings = loadSettings()
    }
  }
  if (!settings.eeLogPath) {
    const found = detectEeLogPath()
    if (found) updateSettings({ eeLogPath: found })
  }

  createCompanionWindow()
  overlayWindow = createOverlayWindow(isDev ? DEV_URL : null)
  // Surface warmup ASAP so companion/overlay don't flash "idle" on first paint.
  if (loadSettings().modules.relics || loadSettings().modules.rivens) {
    setOcrWarmup('warming', 'Starting…')
  } else {
    setOcrWarmup('skipped', 'Relics/Rivens off')
  }
  setOverlayOriginListener((origin: OverlayContentOrigin) => {
    if (overlayWindow && !overlayWindow.isDestroyed()) {
      overlayWindow.webContents.send('overlay:contentOrigin', origin)
    }
  })
  void syncWidgetServerFromSettings()
  syncMarketBuyAlertsFromSettings()
  setCaptureOverlayPause(() => {
    const win = overlayWindow
    if (!win || win.isDestroyed()) return () => {}
    const wasVisible = win.isVisible()
    let prevOpacity = 1
    try {
      prevOpacity = win.getOpacity()
      win.setOpacity(0)
    } catch {
      // ignore
    }
    try {
      win.setContentProtection(true)
    } catch {
      // ignore
    }
    // Windows: contentProtection already excludes us from DWM capture.
    // Skip off-screen park — setBounds round-trips hitch the UI for little gain.
    const parkOffscreen = false
    const bounds = win.getBounds()
    if (parkOffscreen) {
      try {
        win.setBounds({ ...bounds, x: -10_000, y: -10_000 })
      } catch {
        // ignore
      }
    }
    win.hide()
    return () => {
      if (!overlayWindow || overlayWindow.isDestroyed()) return
      try {
        if (parkOffscreen) {
          overlayWindow.setBounds(bounds)
        } else {
          restoreOverlayGeometry(overlayWindow)
        }
        overlayWindow.setOpacity(prevOpacity > 0 ? prevOpacity : 1)
        overlayWindow.setContentProtection(true)
      } catch {
        // ignore
      }
      // Restore from the pre-pause visible flag — don't re-check the Warframe gate
      // here (it can briefly flip during capture and leave the overlay stuck hidden).
      if (wasVisible && loadSettings().overlayVisible) {
        restoreOverlayGeometry(overlayWindow)
        overlayWindow.showInactive()
        try {
          overlayWindow.setAlwaysOnTop(true, 'screen-saver')
        } catch {
          // ignore
        }
        syncOverlayWindowVisibility({ silent: true })
      }
    }
  })
  fixLegacyRivenAnchor()
  // Never boot unlocked — persisted layoutEditMode would steal game clicks.
  if (loadSettings().layoutEditMode) {
    updateSettings({ layoutEditMode: false })
  }
  startOverlayWarframeGateWatcher()
  syncOverlayWindowVisibility()
  applyLayoutEditMode(false)

  // Overlay is created after companion; ensure companion stays on top
  raiseCompanion()

  reloadConfiguredInventory()
  onDisplayRemount((prompt) => {
    invalidateCaptureCache()
    disposePersistentCapture()
    broadcastDisplayRemount(prompt)
    raiseCompanion()
  })
  onInventoryUpdated((status) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('inventory:updated', status)
    }
  })
  onInventorySyncProgress((progress) => {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('inventory:progress', progress)
    }
  })
  onRelicScanUpdated(() => broadcastRelicScan())
  onRivenScanUpdated(() => broadcastRivenScan())

  const bindEeLog = (reason: string) => {
    const eePath = loadSettings().eeLogPath || detectEeLogPath()
    if (eePath) {
      if (!loadSettings().eeLogPath) updateSettings({ eeLogPath: eePath })
      logWatcher.setPath(eePath)
      console.info(`[Everything Warframe] EE.log watcher bound (${reason}): ${eePath}`)
      return true
    }
    logWatcher.setPath(null)
    console.warn(`[Everything Warframe] EE.log watcher unbound (${reason}) — auto-scan off`)
    return false
  }
  bindEeLog('startup')
  // Proton prefixes appear after the first launch; keep trying on Linux.
  if (process.platform === 'linux') {
    setInterval(() => {
      if (loadSettings().eeLogPath && fs.existsSync(loadSettings().eeLogPath)) return
      bindEeLog('periodic-redetect')
    }, 45_000)
  }
  logWatcher.on('event', (event) => {
    if (event.type === 'relic_rewards') {
      if (!loadSettings().modules.relics) return
      if (getRelicScanState().scanning) {
        console.info('[Everything Warframe] EE.log relic rewards ignored — scan already in progress')
        return
      }
      console.info(
        `[Everything Warframe] EE.log relic rewards detected — scanning` +
          (event.squadSize ? ` (squad≈${event.squadSize})` : ''),
      )
      void runRelicScan('log', event.squadSize)
    } else if (event.type === 'relic_rewards_end') {
      // Don't wipe mid-OCR if a close marker arrives while the first pass is still running.
      if (getRelicScanState().scanning) {
        console.info('[Everything Warframe] EE.log relic end ignored — scan in progress')
        return
      }
      console.info('[Everything Warframe] EE.log relic rewards ended — dismissing popup')
      dismissRelicPopup()
    } else if (event.type === 'riven_reroll') {
      if (!loadSettings().modules.rivens) return
      console.info('[Everything Warframe] EE.log riven reroll detected — scanning')
      void runRivenScan('log')
    } else if (event.type === 'riven_reroll_end') {
      // Ignore while a scan is in flight (false end markers used to wipe mid-OCR).
      if (getRivenScanState().scanning) {
        console.info('[Everything Warframe] EE.log riven end ignored — scan in progress')
        return
      }
      console.info('[Everything Warframe] EE.log riven reroll ended — dismissing popup')
      dismissRivenPopup()
    } else if (event.type === 'mission_complete') {
      console.info('[Everything Warframe] EE.log mission complete — arming arbitration haul window')
      void import('./services/arbitration-log').then((m) => m.noteMissionComplete())
    }
  })
  // Interval applied via syncLogWatcherInterval() after windows exist (perf-aware).

  preferLowerProcessPriority()
  registerHotkeys()
  createTray()
  initAutoUpdater()

  try {
    await refreshWorldstate(true)
  } catch (err) {
    console.error('Initial worldstate fetch failed', err)
  }

  // Prefetch companion catalogs early so Inventory / Foundry / Planner aren't cold.
  setTimeout(() => {
    void warmCompanionCatalogs()
  }, 1200)

  // Keep Tesseract + capture hot whenever Relics/Rivens are enabled — cold first
  // scans defeat the overlay. Game performance mode still lowers process priority
  // and pauses inventory sync during OCR; it no longer delays OCR warmup.
  if (loadSettings().modules.relics || loadSettings().modules.rivens) {
    setTimeout(() => {
      void runOcrWarmup()
    }, 500)
  }

  // Linux/Wayland: warm PipeWire after authorize/ack so the first EE.log scan is hot.
  if (
    process.platform === 'linux' &&
    loadSettings().onboarding.linuxCaptureAck &&
    (loadSettings().modules.relics || loadSettings().modules.rivens)
  ) {
    setTimeout(() => {
      void warmScreenCapture()
    }, 1500)
  }

  worldstateTimer = setInterval(() => {
    void refreshWorldstate(true).catch((err) => console.error(err))
  }, 60_000)

  scheduleWorldstateExpiryCheck()

  inventorySyncTimer = setInterval(() => {
    void (async () => {
      const settings = loadSettings()
      if (!settings.inventoryAutoSync || !settings.inventoryConsent) return
      if (isInventorySyncInFlight()) return
      if (
        settings.gamePerformanceMode &&
        (getRelicScanState().scanning || getRivenScanState().scanning)
      ) {
        return
      }
      const running = await isWarframeRunning()
      if (!running) return
      const last = Date.parse(settings.inventoryLastSynced || '') || 0
      // Poll often so we catch Warframe launch; only sync when 10+ min stale.
      if (Date.now() - last < 10 * 60_000) return
      try {
        const result = await syncInventoryFromGame()
        if (result.ok) await warmFoundryAfterInventorySync()
        broadcastInventory()
        broadcastSettings(loadSettings())
      } catch {
        // quiet
      }
    })()
  }, 2 * 60_000)

  applyOverlayPerformanceMode(loadSettings().overlayVisible)
  syncLogWatcherInterval()
  if (overlayWindow && !overlayWindow.isDestroyed()) {
    restoreOverlayGeometry(overlayWindow)
  }

  app.on('activate', () => {
    createCompanionWindow()
  })
})

app.on('will-quit', () => {
  globalShortcut.unregisterAll()
  logWatcher.stop()
  stopOverlayWarframeGateWatcher()
  if (worldstateTimer) clearInterval(worldstateTimer)
  if (inventorySyncTimer) clearInterval(inventorySyncTimer)
  if (expiryTimer) clearTimeout(expiryTimer)
  void stopWidgetServer()
  void import('./services/lfg-hub')
    .then((m) => m.stopLocalLfgHub())
    .catch(() => {})
  disposePersistentCapture()
  void shutdownOcr()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Keep running via tray/overlay; quit only when user chooses Quit
  }
})
