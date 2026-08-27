import { contextBridge, ipcRenderer } from 'electron'
import type {
  AppSettings,
  AppUpdateStatus,
  BugReportDraft,
  FoundryListFilters,
  HotkeyRegistration,
  InventoryStatus,
  MasteryHelperQuery,
  ModuleId,
  DisplayChoice,
  PrimaryDisplayInfo,
  RelicPlannerQuery,
  RelicScanState,
  RivenScanState,
  UninstallInfo,
  VoidLensApi,
  WorldstateSnapshot,
} from '../shared/types'

const api: VoidLensApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  updateSettings: (partial) => ipcRenderer.invoke('settings:update', partial),
  setModuleEnabled: (id: ModuleId, enabled: boolean) =>
    ipcRenderer.invoke('settings:setModule', id, enabled),
  getPrimaryDisplay: () => ipcRenderer.invoke('display:getPrimary') as Promise<PrimaryDisplayInfo>,
  listDisplays: () => ipcRenderer.invoke('display:list') as Promise<DisplayChoice[]>,
  getWorldstate: () => ipcRenderer.invoke('worldstate:get'),
  refreshWorldstate: () => ipcRenderer.invoke('worldstate:refresh'),
  toggleOverlay: () => ipcRenderer.invoke('overlay:toggle'),
  setLayoutEditMode: (enabled: boolean) => ipcRenderer.invoke('overlay:setLayoutEdit', enabled),
  navigateCompanion: (tab: string) => ipcRenderer.invoke('companion:navigate', tab),
  toggleQuietFocus: () => ipcRenderer.invoke('overlay:toggleQuietFocus'),
  pickEeLogPath: () => ipcRenderer.invoke('dialog:pickEeLog'),
  pickInventoryPath: () => ipcRenderer.invoke('dialog:pickInventory'),
  detectEeLogPath: () => ipcRenderer.invoke('log:detectEe'),
  getInventoryStatus: () => ipcRenderer.invoke('inventory:status'),
  setInventoryConsent: (consent: boolean) => ipcRenderer.invoke('inventory:consent', consent),
  detectInventorySources: () => ipcRenderer.invoke('inventory:detect'),
  useInventoryCandidate: (path: string) => ipcRenderer.invoke('inventory:use', path),
  syncInventoryFromGame: () => ipcRenderer.invoke('inventory:sync'),
  clearInventory: () => ipcRenderer.invoke('inventory:clear'),
  getInventoryIndex: () => ipcRenderer.invoke('inventory:index'),
  browseInventory: (query) => ipcRenderer.invoke('inventory:browse', query),
  getRelicScan: () => ipcRenderer.invoke('relics:get'),
  scanRelicRewards: () => ipcRenderer.invoke('relics:scan'),
  clearRelicScan: () => ipcRenderer.invoke('relics:clear'),
  ackRelicCelebration: () => ipcRenderer.invoke('relics:ackCelebration'),
  getRivenScan: () => ipcRenderer.invoke('rivens:get'),
  scanRivens: () => ipcRenderer.invoke('rivens:scan'),
  clearRivenScan: () => ipcRenderer.invoke('rivens:clear'),
  getRivenHistory: () => ipcRenderer.invoke('rivens:history'),
  clearRivenHistory: () => ipcRenderer.invoke('rivens:historyClear'),
  getFoundryItems: (filters?: FoundryListFilters) => ipcRenderer.invoke('foundry:list', filters),
  getFoundryTree: (uniqueName: string) => ipcRenderer.invoke('foundry:tree', uniqueName),
  getRelicPlanner: (query) => ipcRenderer.invoke('relicPlanner:list', query),
  getDropSources: (nameOrUnique: string) => ipcRenderer.invoke('relicPlanner:drops', nameOrUnique),
  getSetFarm: (opts) => ipcRenderer.invoke('setFarm:get', opts),
  getSetFissurePath: (uniqueName) => ipcRenderer.invoke('setFarm:fissurePath', uniqueName),
  getEconomyTrend: () => ipcRenderer.invoke('economy:trend'),
  lfgHealth: () => ipcRenderer.invoke('lfg:health'),
  listLfg: (opts) => ipcRenderer.invoke('lfg:list', opts),
  getLfgRelicOptions: () => ipcRenderer.invoke('lfg:relicOptions'),
  createLfg: (input) => ipcRenderer.invoke('lfg:create', input),
  joinLfg: (input) => ipcRenderer.invoke('lfg:join', input),
  leaveLfg: (input) => ipcRenderer.invoke('lfg:leave', input),
  deleteLfg: (input) => ipcRenderer.invoke('lfg:delete', input),
  extendLfg: (input) => ipcRenderer.invoke('lfg:extend', input),
  desktopNotify: (payload) => ipcRenderer.invoke('ui:desktopNotify', payload),
  getSetProgress: (opts) => ipcRenderer.invoke('setProgress:list', opts),
  getInventoryDiff: () => ipcRenderer.invoke('inventory:diff'),
  getSessionHaul: () => ipcRenderer.invoke('session:haul'),
  clearSessionHaul: () => ipcRenderer.invoke('session:haulClear'),
  getLoadoutSnapshot: () => ipcRenderer.invoke('loadout:get'),
  getCircuitTracker: () => ipcRenderer.invoke('circuit:tracker'),
  getArbitrationLog: () => ipcRenderer.invoke('arb:log'),
  clearArbitrationLog: () => ipcRenderer.invoke('arb:logClear'),
  suggestMarketUndercut: (name) => ipcRenderer.invoke('market:undercut', name),
  getMasteryHelper: (query) => ipcRenderer.invoke('mastery:list', query),
  getHotkeyStatus: () => ipcRenderer.invoke('hotkeys:status') as Promise<HotkeyRegistration[]>,
  getAppVersion: () => ipcRenderer.invoke('app:version') as Promise<string>,
  getUpdateStatus: () => ipcRenderer.invoke('update:status'),
  checkForUpdates: () => ipcRenderer.invoke('update:check'),
  installUpdate: () => ipcRenderer.invoke('update:install'),
  openBugReport: (draft: BugReportDraft) => ipcRenderer.invoke('bugReport:open', draft),
  copyBugDiagnostics: (draft?: Partial<BugReportDraft>) =>
    ipcRenderer.invoke('bugReport:copyDiagnostics', draft),
  pickBugScreenshots: () => ipcRenderer.invoke('bugReport:pickScreenshots'),
  openBugDebugFolders: () => ipcRenderer.invoke('bugReport:openDebugFolders'),
  getPendingCrash: () => ipcRenderer.invoke('crash:pending'),
  clearPendingCrash: () => ipcRenderer.invoke('crash:clearPending'),
  readCrashLogTail: () => ipcRenderer.invoke('crash:logTail'),
  getUninstallInfo: () => ipcRenderer.invoke('app:uninstallInfo') as Promise<UninstallInfo>,
  exportSettings: () => ipcRenderer.invoke('settings:export'),
  importSettings: () => ipcRenderer.invoke('settings:import'),
  launchUninstaller: () => ipcRenderer.invoke('app:launchUninstaller'),
  openWindowsAppsSettings: () => ipcRenderer.invoke('app:openWindowsAppsSettings'),
  openUserDataFolder: () => ipcRenderer.invoke('app:openUserDataFolder'),
  clearUserDataAndQuit: () => ipcRenderer.invoke('app:clearUserDataAndQuit'),
  lookupMarketPrices: (names) => ipcRenderer.invoke('market:lookup', names),
  getWfmSession: () => ipcRenderer.invoke('market:wfmSession'),
  setWfmJwt: (jwt) => ipcRenderer.invoke('market:wfmSetJwt', jwt),
  clearWfmJwt: () => ipcRenderer.invoke('market:wfmClear'),
  getWfmOrders: () => ipcRenderer.invoke('market:wfmOrders'),
  deleteWfmOrder: (orderId) => ipcRenderer.invoke('market:wfmDeleteOrder', orderId),
  updateWfmOrder: (input) => ipcRenderer.invoke('market:wfmUpdateOrder', input),
  getMarketTradeLog: () => ipcRenderer.invoke('market:tradeLog'),
  addMarketTrade: (input) => ipcRenderer.invoke('market:tradeLogAdd', input),
  removeMarketTrade: (id) => ipcRenderer.invoke('market:tradeLogRemove', id),
  clearMarketTradeLog: () => ipcRenderer.invoke('market:tradeLogClear'),
  getWfmContracts: () => ipcRenderer.invoke('market:wfmContracts'),
  deleteWfmContract: (contractId) => ipcRenderer.invoke('market:wfmDeleteContract', contractId),
  searchWfmItems: (query) => ipcRenderer.invoke('market:wfmSearchItems', query),
  createWfmOrder: (input) => ipcRenderer.invoke('market:wfmCreateOrder', input),
  createWfmContract: (input) => ipcRenderer.invoke('market:wfmCreateContract', input),
  openExternal: (url) => ipcRenderer.invoke('shell:openExternal', url),
  testScreenCapture: () => ipcRenderer.invoke('capture:test'),
  getLinuxHealth: () => ipcRenderer.invoke('linux:health'),
  getWidgetServerStatus: () => ipcRenderer.invoke('widgets:status'),
  onSettingsChanged: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, settings: AppSettings) => cb(settings)
    ipcRenderer.on('settings:changed', listener)
    return () => ipcRenderer.removeListener('settings:changed', listener)
  },
  onWorldstateUpdated: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, data: WorldstateSnapshot) => cb(data)
    ipcRenderer.on('worldstate:updated', listener)
    return () => ipcRenderer.removeListener('worldstate:updated', listener)
  },
  onOverlayVisibilityChanged: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, visible: boolean) => cb(visible)
    ipcRenderer.on('overlay:visibility', listener)
    return () => ipcRenderer.removeListener('overlay:visibility', listener)
  },
  onOverlayContentOrigin: (cb) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      origin: import('../shared/types').OverlayContentOrigin,
    ) => cb(origin)
    ipcRenderer.on('overlay:contentOrigin', listener)
    return () => ipcRenderer.removeListener('overlay:contentOrigin', listener)
  },
  getOverlayContentOrigin: () => ipcRenderer.invoke('overlay:contentOrigin'),
  onInventoryUpdated: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, status: InventoryStatus) => cb(status)
    ipcRenderer.on('inventory:updated', listener)
    return () => ipcRenderer.removeListener('inventory:updated', listener)
  },
  onInventoryProgress: (cb) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      progress: { stage: string; message: string },
    ) => cb(progress)
    ipcRenderer.on('inventory:progress', listener)
    return () => ipcRenderer.removeListener('inventory:progress', listener)
  },
  onRelicScanUpdated: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, state: RelicScanState) => cb(state)
    ipcRenderer.on('relics:updated', listener)
    return () => ipcRenderer.removeListener('relics:updated', listener)
  },
  onRivenScanUpdated: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, state: RivenScanState) => cb(state)
    ipcRenderer.on('rivens:updated', listener)
    return () => ipcRenderer.removeListener('rivens:updated', listener)
  },
  onUpdateStatus: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, status: AppUpdateStatus) => cb(status)
    ipcRenderer.on('update:status', listener)
    return () => ipcRenderer.removeListener('update:status', listener)
  },
  onRelicSound: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('relics:sound', listener)
    return () => ipcRenderer.removeListener('relics:sound', listener)
  },
  onRivenSound: (cb) => {
    const listener = () => cb()
    ipcRenderer.on('rivens:sound', listener)
    return () => ipcRenderer.removeListener('rivens:sound', listener)
  },
  onHotkeyStatus: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, status: HotkeyRegistration[]) => cb(status)
    ipcRenderer.on('hotkeys:status', listener)
    return () => ipcRenderer.removeListener('hotkeys:status', listener)
  },
  onDisplayRemount: (cb) => {
    const listener = (
      _: Electron.IpcRendererEvent,
      prompt: { previousId: number; displays: DisplayChoice[] },
    ) => cb(prompt)
    ipcRenderer.on('display:remount', listener)
    return () => ipcRenderer.removeListener('display:remount', listener)
  },
  onCompanionNavigate: (cb) => {
    const listener = (_: Electron.IpcRendererEvent, tab: string) => cb(tab)
    ipcRenderer.on('companion:navigate', listener)
    return () => ipcRenderer.removeListener('companion:navigate', listener)
  },
}

contextBridge.exposeInMainWorld('voidlens', api)
