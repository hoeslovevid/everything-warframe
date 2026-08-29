export type ModuleId =
  | 'cycles'
  | 'fissures'
  | 'baro'
  | 'nightwave'
  | 'relics'
  | 'arbitration'
  | 'invasions'
  | 'archon'
  | 'deepArchimedea'
  | 'rivens'
  | 'foundry'
  | 'market'
  | 'relicPlanner'
  | 'relicRecommend'
  | 'mastery'

/** Soft UI chime style for relic / riven scan alerts. */
export type SoundPackId = 'soft' | 'bright' | 'double' | 'low'

/** Warframe UI theme ids used by WFInfo-style relic OCR. */
export type WfThemeId =
  | 'Vitruvian'
  | 'Stalker'
  | 'Baruuk'
  | 'Corpus'
  | 'Fortuna'
  | 'Grineer'
  | 'Lotus'
  | 'Nidus'
  | 'Orokin'
  | 'Tenno'
  | 'HighContrast'
  | 'Legacy'
  | 'Equinox'
  | 'DarkLotus'
  | 'Zephyr'

export const WF_THEME_OPTIONS: WfThemeId[] = [
  'Vitruvian',
  'Stalker',
  'Baruuk',
  'Corpus',
  'Fortuna',
  'Grineer',
  'Lotus',
  'Nidus',
  'Orokin',
  'Tenno',
  'HighContrast',
  'Legacy',
  'Equinox',
  'DarkLotus',
  'Zephyr',
]

export type PanelAnchor = {
  x: number
  y: number
}

/**
 * Normalized OCR crop rectangle as fractions of the capture frame (0–1).
 * Used so scan areas scale across resolutions / ultrawide.
 */
export type OcrRegionNorm = {
  x: number
  y: number
  width: number
  height: number
}

/**
 * User-tuned OCR capture areas. `null` fields fall back to built-in
 * Relic / Riven geometry (WFInfo-style reward strip, Kuva Cycle cards).
 */
export type OcrScanRegions = {
  /** Horizontal band covering all relic reward name slots. */
  relicStrip: OcrRegionNorm | null
  /** Left Kuva Cycle card (current roll). */
  rivenCurrent: OcrRegionNorm | null
  /** Right Kuva Cycle card (reroll). */
  rivenReroll: OcrRegionNorm | null
}

export const DEFAULT_OCR_SCAN_REGIONS: OcrScanRegions = {
  relicStrip: null,
  rivenCurrent: null,
  rivenReroll: null,
}

export type HotkeyConfig = {
  toggleOverlay: string
  openCompanion: string
  refreshWorldstate: string
  scanRelics: string
  dismissRelics: string
  scanRivens: string
  dismissRivens: string
  editLayout: string
  /** Hide/restore all persistent worldstate panels (not relics/rivens). */
  toggleWorldstatePanels: string
  /** Focus mode: only fissures + relic/riven OCR panels. */
  toggleQuietFocus: string
  toggleModuleCycles: string
  toggleModuleFissures: string
  toggleModuleBaro: string
  toggleModuleNightwave: string
  toggleModuleArbitration: string
  toggleModuleInvasions: string
  toggleModuleArchon: string
  toggleModuleDeepArchimedea: string
}

export type RivenTier = 'S' | 'A' | 'B' | 'C' | 'D' | 'F'

export type RivenStatLine = {
  raw: string
  name: string
  value: number
  unit: '%' | 'flat'
  negative: boolean
  /** 0–100 quality for this line vs typical max (approx). */
  quality: number
  desirable: boolean
}

export type RivenRoll = {
  side: 'current' | 'reroll'
  weapon: string
  ocrText: string
  stats: RivenStatLine[]
  score: number
  tier: RivenTier
  /** True when Megrim/Valkyrial sheet prefs were used for this score. */
  prefsMatched?: boolean
  prefsNotes?: string
  /** Median warframe.market buyout for similar auctions (estimate). */
  platinum?: number | null
  marketVolume?: number | null
  /** How tightly the auction query matched OCR stats. */
  marketMatch?: 'exact' | 'stats' | 'loose' | null
  /** Madurai / Vazarin / Naramon / Zenurik when OCR sees polarity. */
  polarity?: string | null
  /** Weapon disposition when OCR / text exposes it (0.5–1.55 typical). */
  disposition?: number | null
  /** Mastery rank requirement when OCR sees MR. */
  masteryRank?: number | null
  /** Average quality % of desirable stats (0–100). */
  avgQuality?: number | null
  /** Plain-language keep / reroll verdict for the card alone. */
  verdict?: 'godroll' | 'keeper' | 'reroll' | 'trash' | null
  verdictNote?: string | null
  /** Deep-link into warframe.market riven auction search. */
  marketUrl?: string | null
}

export type RivenScanState = {
  active: boolean
  scanning: boolean
  scannedAt: string
  trigger: 'manual' | 'log' | 'none'
  error: string | null
  current: RivenRoll | null
  reroll: RivenRoll | null
  recommendation: 'keep' | 'take' | 'similar' | 'none'
  /** Extra tip when plat or prefs drove the recommendation. */
  recommendationNote?: string | null
}

export type InventorySource = 'none' | 'manual' | 'detected' | 'helper' | 'alecaframe'

export type FissureSort = 'eta' | 'tier'

/** Which Void Fissure difficulty track(s) to list. */
export type FissurePathMode = 'normal' | 'steel' | 'both'

/** App + overlay color themes (4 dark, 4 light) + user custom. */
export type ColorThemeId =
  | 'void'
  | 'ember'
  | 'glacier'
  | 'obsidian'
  | 'snow'
  | 'parchment'
  | 'mist'
  | 'harbor'
  | 'custom'

/** Seed colors for the Custom theme; other tokens are derived at apply time. */
export type CustomPalette = {
  mode: 'dark' | 'light'
  background: string
  text: string
  muted: string
  accentA: string
  accentB: string
}

export type PresetColorThemeId = Exclude<ColorThemeId, 'custom'>

/** Seed palettes used by presets and “Start from…” for Custom. */
export const PRESET_PALETTE_SEEDS: Record<PresetColorThemeId, CustomPalette> = {
  void: {
    mode: 'dark',
    background: '#060a0e',
    text: '#c5d4de',
    muted: '#7f96a6',
    accentA: '#b8944f',
    accentB: '#4ab5ac',
  },
  ember: {
    mode: 'dark',
    background: '#120a08',
    text: '#efe2d4',
    muted: '#a89888',
    accentA: '#c87840',
    accentB: '#e8a878',
  },
  glacier: {
    mode: 'dark',
    background: '#071018',
    text: '#d4e4ec',
    muted: '#8eb6c9',
    accentA: '#8eb6c9',
    accentB: '#5ec4d4',
  },
  obsidian: {
    mode: 'dark',
    background: '#010101',
    text: '#d8dce0',
    muted: '#9aa0a6',
    accentA: '#9aa0a6',
    accentB: '#6e7a84',
  },
  snow: {
    mode: 'light',
    background: '#f3f6f8',
    text: '#2a3540',
    muted: '#5a6f7e',
    accentA: '#1a6b66',
    accentB: '#2a9a92',
  },
  parchment: {
    mode: 'light',
    background: '#f2efe8',
    text: '#2c2924',
    muted: '#6a6358',
    accentA: '#8a6a32',
    accentB: '#a08048',
  },
  mist: {
    mode: 'light',
    background: '#eef2f5',
    text: '#243040',
    muted: '#6a7a88',
    accentA: '#9a8048',
    accentB: '#5a8a88',
  },
  harbor: {
    mode: 'light',
    background: '#f7fbfb',
    text: '#1e3338',
    muted: '#4f6a6e',
    accentA: '#2a8f86',
    accentB: '#1ea89c',
  },
}

export const DEFAULT_CUSTOM_PALETTE: CustomPalette = { ...PRESET_PALETTE_SEEDS.void }

export const COLOR_THEME_META: Record<
  ColorThemeId,
  { label: string; mode: 'dark' | 'light'; description: string; swatches: [string, string, string] }
> = {
  void: {
    label: 'Void',
    mode: 'dark',
    description: 'Default night void with gold and teal',
    swatches: ['#060a0e', '#c9b07a', '#4ab5ac'],
  },
  ember: {
    label: 'Ember',
    mode: 'dark',
    description: 'Warm forge tones — copper on charcoal',
    swatches: ['#120a08', '#d4956a', '#e8c4a0'],
  },
  glacier: {
    label: 'Glacier',
    mode: 'dark',
    description: 'Cool steel and ice on deep navy',
    swatches: ['#071018', '#8eb6c9', '#5ec4d4'],
  },
  obsidian: {
    label: 'Obsidian',
    mode: 'dark',
    description: 'Near-black with muted silver accents',
    swatches: ['#010101', '#9aa0a6', '#6e7a84'],
  },
  snow: {
    label: 'Snow',
    mode: 'light',
    description: 'Clean cool light with teal accents',
    swatches: ['#f3f6f8', '#1a6b66', '#2a3540'],
  },
  parchment: {
    label: 'Parchment',
    mode: 'light',
    description: 'Soft warm paper with ink and brass',
    swatches: ['#f2efe8', '#8a6a32', '#2c2924'],
  },
  mist: {
    label: 'Mist',
    mode: 'light',
    description: 'Airy blue-gray with muted gold',
    swatches: ['#eef2f5', '#9a8048', '#243040'],
  },
  harbor: {
    label: 'Harbor',
    mode: 'light',
    description: 'Bright coastal white with seafoam accents',
    swatches: ['#f7fbfb', '#2a8f86', '#1e3338'],
  },
  custom: {
    label: 'Custom',
    mode: 'dark',
    description: 'Your own palette — pick accents below',
    swatches: ['#060a0e', '#b8944f', '#4ab5ac'],
  },
}

/** Modules that can appear on the live overlay (excludes companion-only). */
export const OVERLAY_MODULE_IDS: ModuleId[] = [
  'cycles',
  'fissures',
  'baro',
  'nightwave',
  'relics',
  'arbitration',
  'invasions',
  'archon',
  'deepArchimedea',
  'rivens',
  'relicRecommend',
]

/** Persistent worldstate panels (excludes transient relic/riven popups). */
export const WORLDSTATE_MODULE_IDS: ModuleId[] = [
  'cycles',
  'fissures',
  'baro',
  'nightwave',
  'arbitration',
  'invasions',
  'archon',
  'deepArchimedea',
  'relicRecommend',
]

/** HotkeyConfig keys that toggle a single worldstate module. */
export const MODULE_TOGGLE_HOTKEY_IDS = [
  'toggleModuleCycles',
  'toggleModuleFissures',
  'toggleModuleBaro',
  'toggleModuleNightwave',
  'toggleModuleArbitration',
  'toggleModuleInvasions',
  'toggleModuleArchon',
  'toggleModuleDeepArchimedea',
] as const satisfies ReadonlyArray<keyof HotkeyConfig>

export const MODULE_TOGGLE_HOTKEY_TO_ID: Record<
  (typeof MODULE_TOGGLE_HOTKEY_IDS)[number],
  ModuleId
> = {
  toggleModuleCycles: 'cycles',
  toggleModuleFissures: 'fissures',
  toggleModuleBaro: 'baro',
  toggleModuleNightwave: 'nightwave',
  toggleModuleArbitration: 'arbitration',
  toggleModuleInvasions: 'invasions',
  toggleModuleArchon: 'archon',
  toggleModuleDeepArchimedea: 'deepArchimedea',
}

export type SessionGoalKind =
  | 'relic_scans'
  | 'needed_parts'
  | 'plat_seen'
  | 'inventory_item'

export type SessionGoal = {
  id: string
  kind: SessionGoalKind
  target: number
  /** Substring match on inventory display names (inventory_item). */
  matchName?: string
  label?: string
}

export type AppSettings = {
  modules: Record<ModuleId, boolean>
  panelAnchors: Partial<Record<ModuleId, PanelAnchor>>
  /**
   * Legacy global opacity fallback. Prefer `moduleOpacity` per panel;
   * kept so older settings files still load cleanly.
   */
  opacity: number
  /** Per-overlay panel opacity (0.4–1). Missing keys fall back to `opacity`. */
  moduleOpacity: Partial<Record<ModuleId, number>>
  /** Visual scale for overlay panels (WFHelper-style). */
  overlayScale: number
  /**
   * Overlay information density.
   * compact = tighter panels; readable = larger type + more padding (also bumps scale).
   */
  overlayDensity: 'compact' | 'normal' | 'readable'
  /** Companion + overlay color palette. */
  colorTheme: ColorThemeId
  /** Seed colors when `colorTheme` is `custom`. */
  customPalette: CustomPalette
  hotkeys: HotkeyConfig
  eeLogPath: string
  inventoryPath: string
  inventorySource: InventorySource
  inventoryConsent: boolean
  inventoryLastSynced: string
  fissureTiers: string[]
  /** Normal (star chart), Steel Path only, or both. */
  fissurePathMode: FissurePathMode
  /** When false, hide Railjack / Void Storm fissures. */
  fissureShowStorms: boolean
  fissureSort: FissureSort
  /**
   * Electron `Display.id` used for OCR capture + overlay placement.
   * `null` = system primary display.
   */
  ocrDisplayId: number | null
  /**
   * Force Warframe UI theme for relic OCR text isolation.
   * `null` = auto-detect from the screenshot (WFInfo-style).
   */
  wfThemeOverride: WfThemeId | null
  /**
   * Force 3 or 4 reward slots. `null` = EE.log hint, then image detect.
   */
  relicSquadSizeOverride: 3 | 4 | null
  /**
   * User-edited OCR crop areas (Layout tab). Null fields use built-in geometry.
   */
  ocrScanRegions: OcrScanRegions
  overlayVisible: boolean
  /**
   * When true, the overlay window is only shown while Warframe is the
   * foreground app (falls back to “game running” when focus can’t be read).
   */
  overlayOnlyInWarframe: boolean
  layoutEditMode: boolean
  /** After the user has dragged a live overlay once, hide the move-hint chip. */
  overlayDragHintDismissed: boolean
  /** Starred Baro item names (case-insensitive match). */
  baroWishlist: string[]
  /** Farm favorites — set/part names floated in Relic Planner + recommend overlay. */
  farmFavorites: string[]
  /** Query pushed from Relic Planner → recommend overlay. */
  relicRecommend: {
    sort: RelicPlannerSort
    ownedOnly: boolean
    tier: string
    prime: FoundryPrimeFilter
    favoritesFirst: boolean
    limit: number
  }
  /** How “Best” is chosen on fissure reward cards. */
  relicBestPickMode: RelicBestPickMode
  /** Locally completed Nightwave challenge ids. */
  nightwaveDoneIds: string[]
  /** Soft chime when relic OCR finishes. */
  relicSoundEnabled: boolean
  /** Soft chime when riven OCR finishes. */
  rivenSoundEnabled: boolean
  /** Chime style for relic/riven alerts. */
  soundPack: SoundPackId
  /** Last applied session profile id (UI highlight only). */
  activePlayProfile: string | null
  /** Item names to track on the Market tab (warframe.market). */
  marketWatchlist: string[]
  /**
   * Buy targets — alert when live sell floor ≤ maxPlatinum.
   * Names match watchlist-style display names.
   */
  marketBuyTargets: Array<{ name: string; maxPlatinum: number; quantity?: number }>
  /** Display names never auto-listed from Stock / Sellables assistant. */
  marketListBlacklist: string[]
  /** Sell is “stale” when your price is this many plat above live floor. */
  marketStaleMargin: number
  /** Per-item minimum sell platinum (listing assistant / reprice never go below). */
  marketMinPrices: Array<{ name: string; minPlatinum: number }>
  /** Desktop notify when a buy-target floor drops to max. */
  marketBuyAlertEnabled: boolean
  /** Owned rivens queued to sell (manual stock shelf). */
  marketRivenStock: Array<{
    id: string
    weapon: string
    minPlatinum: number
    polarity?: string
    note?: string
    addedAt: string
  }>
  /** Min median−floor spread to flag as a flip opportunity. */
  marketFlipMinSpread: number
  /**
   * LFG hub base URL.
   * Default = official hosted board. Set to `local` for a private hub on this PC.
   */
  lfgApiBaseUrl: string
  /** Warframe IGN shown on LFG listings. */
  lfgIgn: string
  lfgPlatform: 'pc' | 'psn' | 'xbox' | 'switch' | 'mobile'
  lfgRegion: 'na' | 'eu' | 'asia' | 'sa' | 'oce'
  lfgLanguage: string
  /**
   * Companion UI language (subset of chrome strings). Overlay OCR stays English.
   * `system` follows OS locale when a pack exists, else English.
   */
  uiLocale: 'system' | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'zh'
  /** Stable client id for join/leave (generated once). */
  lfgClientId: string
  /** Host tokens for listings you created (id → token). */
  lfgHostTokens: Record<string, string>
  /** Serve localhost HTML widgets for OBS / external overlays. */
  widgetServerEnabled: boolean
  /** Port for the widget HTTP server (127.0.0.1 only). */
  widgetServerPort: number
  /** After first-run checklist, minimize companion to tray on launch. */
  quietMode: boolean
  /**
   * In-mission focus: overlay shows only fissures + relic/riven OCR.
   * Toggled by hotkey / mission strip; modules restored on exit.
   */
  quietFocusActive: boolean
  /** Module snapshot restored when leaving quiet focus (null when inactive). */
  quietFocusModulesBackup: Partial<Record<ModuleId, boolean>> | null
  /**
   * Reduce GPU/CPU contention with Warframe: deferred OCR warmup, capture stream
   * idle release, slower overlay clock, optional tight overlay bounds, single OCR
   * by default, skip inventory auto-sync while OCR is running.
   */
  gamePerformanceMode: boolean
  /** Tesseract worker count. 1 = less contention; 2 = faster multi-slot relic/riven OCR. */
  ocrPoolSize: 1 | 2
  /**
   * Shrink the overlay BrowserWindow to the union of visible panels (less fullscreen
   * transparent compositing). Disabled automatically while layout editing.
   */
  overlayTightBounds: boolean
  /**
   * In-mission HUD: hide worldstate overlay panels until a relic/riven reward
   * screen is active (mission strip + OCR chip stay). Complements quiet focus.
   */
  overlayRewardHudOnly: boolean
  /**
   * When true, uncaught main-process errors are appended to userData/crash.log
   * and a prompt can open a prefilled GitHub issue on next launch.
   */
  crashReportingConsent: boolean
  /**
   * Folder for cloud / multi-PC settings sync (Dropbox, OneDrive, etc.).
   * Empty = disabled. Writes everything-warframe-settings.json into that folder.
   */
  settingsCloudSyncPath: string
  /** Auto-pull newer cloud settings on launch (when path is set). */
  settingsCloudSyncAuto: boolean
  /** Collapse companion sidebar to icon-only. */
  navCollapsed: boolean
  /** Pinned companion tabs shown under Favorites (tab ids). */
  navPinnedTabs: string[]
  /**
   * When Warframe is foreground, minimize the companion window (optional).
   * Hotkeys / tray still work; raise companion via tray or Alt+Shift+C.
   */
  autoMinimizeCompanionOnWarframeFocus: boolean
  /**
   * EE.log auto relic/riven scans only when Warframe is the foreground window.
   * Manual hotkeys always work.
   */
  requireWarframeFocusForAutoScan: boolean
  /** Persist last Market companion sub-tab. */
  marketLastTab: string
  /** Persist Inventory browser kind filter. */
  inventoryLastKind: string
  /** Persist Inventory search string. */
  inventoryLastSearch: string
  /** Auto-resync inventory while Warframe is running. */
  inventoryAutoSync: boolean
  /** Toast when inventory is stale and Warframe is running. */
  inventoryRemindWhenRunning: boolean
  /** Desktop notification when Baro arrives at a relay. */
  baroArrivalNotify: boolean
  /** Last Baro visit key we already notified for (departure/arrival). */
  baroArrivalNotifiedKey: string
  /**
   * Session goals — live counters from relic OCR + inventory haul this app session.
   */
  sessionGoals: SessionGoal[]
  /** Hide Market session guide. */
  marketSessionGuideDismissed: boolean
  /** Last app version for which “What’s new” was dismissed. */
  lastSeenVersion: string
  /** First-run checklist + tour state */
  onboarding: {
    checklistDismissed: boolean
    borderlessAck: boolean
    modulesTouched: boolean
    layoutVisited: boolean
    inventoryTouched: boolean
    tourCompleted: boolean
    trayTipShown: boolean
    firstRelicSuccessAck: boolean
    firstInventorySyncAck: boolean
    firstMarketListAck: boolean
    /** Linux: finished or skipped the screen-capture wizard. */
    linuxCaptureAck: boolean
    /** Confirmed OCR / Game monitor selection (or primary). */
    ocrMonitorAck: boolean
    /** Confirmed EE.log path is set / detected. */
    eeLogAck: boolean
    /** First-run: enabled Relics + confirmed a test OCR path. */
    firstRunRelicTestAck: boolean
    /** Finished or skipped the OCR calibration wizard. */
    ocrCalibWizardAck: boolean
  }
}

export const MODULE_META: Record<
  ModuleId,
  { label: string; description: string; phase: 1 | 2 | 3 }
> = {
  cycles: {
    label: 'World Cycles',
    description: 'Cetus, Vallis, Cambion, Duviri, Zariman, and Albrecht cycles',
    phase: 1,
  },
  fissures: {
    label: 'Fissures',
    description: 'Active Void Fissures filtered by relic tier',
    phase: 1,
  },
  baro: {
    label: "Baro Ki'Teer",
    description: 'Arrival status, shop inventory, and wishlist alerts',
    phase: 1,
  },
  nightwave: {
    label: 'Nightwave',
    description: 'Season status and active daily / weekly challenges',
    phase: 1,
  },
  relics: {
    label: 'Relic Rewards',
    description:
      'Popup when a fissure reward screen is detected (EE.log / hotkey) — AlecaFrame-style',
    phase: 2,
  },
  arbitration: {
    label: 'Arbitration',
    description: 'Current Arbitration node plus upcoming hours in the rotation',
    phase: 1,
  },
  invasions: {
    label: 'Invasions',
    description: 'Active invasions and progress',
    phase: 1,
  },
  archon: {
    label: 'Archon Hunt',
    description: 'Weekly Archon Hunt boss and missions',
    phase: 1,
  },
  deepArchimedea: {
    label: 'Deep Archimedea',
    description: 'Current Deep Archimedea missions and modifiers',
    phase: 1,
  },
  rivens: {
    label: 'Riven Grader',
    description:
      'Popup while rerolling: grades current vs new roll and recommends which to keep',
    phase: 2,
  },
  foundry: {
    label: 'Foundry Planner',
    description:
      'Companion crafting planner: browse recipes, owned/mastered status, and crafting trees',
    phase: 2,
  },
  market: {
    label: 'Market',
    description:
      'warframe.market watchlist, JWT sign-in for your orders, and ties into relic / riven scans',
    phase: 3,
  },
  relicPlanner: {
    label: 'Relic Planner',
    description:
      'Rank owned relics by missing parts, platinum, or ducats — companion-only',
    phase: 2,
  },
  relicRecommend: {
    label: 'Relic Recommend',
    description:
      'Overlay: best owned relics to run next (from Relic Planner filters)',
    phase: 2,
  },
  mastery: {
    label: 'Mastery Helper',
    description:
      'Next craftable / owned-unmastered gear for MR progress — companion-only',
    phase: 2,
  },
}

/** Official hosted LFG board (Railway). Override with another URL, or `local` for a private hub. */
export const DEFAULT_LFG_API_BASE_URL =
  'https://everything-warframe-production.up.railway.app'

export const DEFAULT_SETTINGS: AppSettings = {
  modules: {
    cycles: true,
    fissures: true,
    baro: true,
    nightwave: true,
    relics: true,
    arbitration: true,
    invasions: false,
    archon: true,
    deepArchimedea: false,
    rivens: true,
    foundry: true,
    market: true,
    relicPlanner: true,
    relicRecommend: true,
    mastery: true,
  },
  panelAnchors: {
    cycles: { x: 24, y: 24 },
    fissures: { x: 24, y: 280 },
    baro: { x: 24, y: 560 },
    nightwave: { x: 320, y: 24 },
    relics: { x: 410, y: 640 },
    arbitration: { x: 420, y: 420 },
    invasions: { x: 720, y: 24 },
    archon: { x: 720, y: 320 },
    deepArchimedea: { x: 720, y: 560 },
    /** Above Kuva Cycle compare cards on 1920×1080; Layout reset scales per display. */
    rivens: { x: 720, y: 8 },
    relicRecommend: { x: 24, y: 420 },
  },
  opacity: 0.92,
  moduleOpacity: {
    cycles: 0.92,
    fissures: 0.92,
    baro: 0.92,
    nightwave: 0.92,
    relics: 0.92,
    arbitration: 0.92,
    invasions: 0.92,
    archon: 0.92,
    deepArchimedea: 0.92,
    rivens: 0.92,
    relicRecommend: 0.92,
  },
  overlayScale: 1,
  overlayDensity: 'normal',
  colorTheme: 'void',
  customPalette: { ...DEFAULT_CUSTOM_PALETTE },
  hotkeys: {
    toggleOverlay: 'Alt+Shift+V',
    openCompanion: 'Alt+Shift+C',
    refreshWorldstate: 'Alt+Shift+R',
    scanRelics: 'Alt+Shift+F',
    dismissRelics: 'Alt+Shift+D',
    scanRivens: 'Alt+Shift+G',
    dismissRivens: 'Alt+Shift+H',
    editLayout: 'Control+Tab',
    toggleWorldstatePanels: 'Alt+Shift+W',
    toggleQuietFocus: 'Alt+Shift+Q',
    toggleModuleCycles: '',
    toggleModuleFissures: '',
    toggleModuleBaro: '',
    toggleModuleNightwave: '',
    toggleModuleArbitration: '',
    toggleModuleInvasions: '',
    toggleModuleArchon: '',
    toggleModuleDeepArchimedea: '',
  },
  eeLogPath: '',
  inventoryPath: '',
  inventorySource: 'none',
  inventoryConsent: false,
  inventoryLastSynced: '',
  fissureTiers: ['Lith', 'Meso', 'Neo', 'Axi', 'Requiem'],
  fissurePathMode: 'both',
  fissureShowStorms: true,
  fissureSort: 'eta',
  ocrDisplayId: null,
  wfThemeOverride: null,
  relicSquadSizeOverride: null,
  ocrScanRegions: { ...DEFAULT_OCR_SCAN_REGIONS },
  overlayVisible: true,
  overlayOnlyInWarframe: true,
  layoutEditMode: false,
  overlayDragHintDismissed: false,
  baroWishlist: [],
  farmFavorites: [],
  relicRecommend: {
    sort: 'missing',
    ownedOnly: true,
    tier: 'all',
    prime: 'any',
    favoritesFirst: true,
    limit: 8,
  },
  relicBestPickMode: 'balanced',
  nightwaveDoneIds: [],
  relicSoundEnabled: true,
  rivenSoundEnabled: true,
  soundPack: 'soft',
  activePlayProfile: null,
  marketWatchlist: [],
  marketBuyTargets: [],
  marketListBlacklist: [],
  marketStaleMargin: 3,
  marketMinPrices: [],
  marketBuyAlertEnabled: true,
  marketRivenStock: [],
  marketFlipMinSpread: 5,
  lfgApiBaseUrl: DEFAULT_LFG_API_BASE_URL,
  lfgIgn: '',
  lfgPlatform: 'pc',
  lfgRegion: 'na',
  lfgLanguage: 'en',
  uiLocale: 'system',
  lfgClientId: '',
  lfgHostTokens: {},
  widgetServerEnabled: false,
  widgetServerPort: 17862,
  quietMode: false,
  quietFocusActive: false,
  quietFocusModulesBackup: null,
  gamePerformanceMode: true,
  ocrPoolSize: 2,
  overlayTightBounds: true,
  overlayRewardHudOnly: true,
  crashReportingConsent: false,
  settingsCloudSyncPath: '',
  settingsCloudSyncAuto: true,
  navCollapsed: false,
  navPinnedTabs: [],
  autoMinimizeCompanionOnWarframeFocus: false,
  requireWarframeFocusForAutoScan: true,
  marketLastTab: 'watchlist',
  inventoryLastKind: 'all',
  inventoryLastSearch: '',
  inventoryAutoSync: true,
  inventoryRemindWhenRunning: true,
  baroArrivalNotify: true,
  baroArrivalNotifiedKey: '',
  sessionGoals: [
    { id: 'goal-scans', kind: 'relic_scans', target: 10, label: 'Relic scans' },
    { id: 'goal-needed', kind: 'needed_parts', target: 3, label: 'Needed parts' },
  ],
  marketSessionGuideDismissed: false,
  lastSeenVersion: '',
  onboarding: {
    checklistDismissed: false,
    borderlessAck: false,
    modulesTouched: false,
    layoutVisited: false,
    inventoryTouched: false,
    tourCompleted: false,
    trayTipShown: false,
    firstRelicSuccessAck: false,
    firstInventorySyncAck: false,
    firstMarketListAck: false,
    linuxCaptureAck: false,
    ocrMonitorAck: false,
    eeLogAck: false,
    firstRunRelicTestAck: false,
    ocrCalibWizardAck: false,
  },
}

export type CycleInfo = {
  id: string
  name: string
  state: string
  timeLeft: string
  expiry: string
}

export type FissureInfo = {
  id: string
  node: string
  missionType: string
  enemy: string
  tier: string
  eta: string
  isHard: boolean
  /** Railjack / Void Storm fissure. */
  isStorm: boolean
  expiry: string
}

export type BaroInventoryItem = {
  uniqueName: string
  item: string
  ducats: number
  credits: number
}

export type BaroInfo = {
  active: boolean
  location: string
  arrival: string
  departure: string
  eta: string
  inventory: BaroInventoryItem[]
}

export type NightwaveChallenge = {
  id: string
  title: string
  description: string
  reputation: number
  isDaily: boolean
  isElite: boolean
  expiry: string
}

export type NightwaveInfo = {
  active: boolean
  season: number
  tag: string
  expiry: string
  phase: number
  challenges: NightwaveChallenge[]
}

export type ArbitrationSlot = {
  node: string
  nodeKey: string
  type: string
  enemy: string
  activation: string
  expiry: string
  eta: string
}

export type ArbitrationInfo = ArbitrationSlot & {
  /** Next hours in the rotation (does not include current). */
  upcoming: ArbitrationSlot[]
}

export type InvasionInfo = {
  id: string
  node: string
  desc: string
  attacker: string
  defender: string
  completion: number
  eta: string
  expiry: string
}

export type SortieMission = {
  node: string
  missionType: string
  modifier: string
}

export type SortieInfo = {
  id: string
  boss: string
  faction: string
  rewardPool: string
  expiry: string
  eta: string
  missions: SortieMission[]
}

export type AlertInfo = {
  id: string
  node: string
  missionType: string
  faction: string
  reward: string
  expiry: string
  eta: string
}

export type ArchonHuntInfo = {
  boss: string
  faction: string
  expiry: string
  eta: string
  missions: Array<{ node: string; type: string }>
}

export type DeepArchimedeaInfo = {
  id: string
  expiry: string
  eta: string
  missions: Array<{ node: string; type: string }>
  riskVariables: string[]
}

export type WorldstateSnapshot = {
  fetchedAt: string
  error: string | null
  stale: boolean
  cycles: CycleInfo[]
  fissures: FissureInfo[]
  baro: BaroInfo | null
  nightwave: NightwaveInfo | null
  arbitration: ArbitrationInfo | null
  invasions: InvasionInfo[]
  archonHunt: ArchonHuntInfo | null
  deepArchimedea: DeepArchimedeaInfo | null
  sortie: SortieInfo | null
  alerts: AlertInfo[]
  /** Steel Path / Circuit weekly offering when warframestat exposes it. */
  circuit: CircuitInfo | null
}

export type CircuitInfo = {
  expiry: string
  eta: string
  currentReward: string | null
  rotation: string[]
  isActive: boolean
}

export type CircuitRewardRow = {
  name: string
  isCurrent: boolean
  owned: boolean
  ownedCount: number
  uniqueName: string | null
  note: string
}

export type CircuitTrackerSnapshot = {
  expiry: string
  eta: string
  isActive: boolean
  currentReward: string | null
  rewards: CircuitRewardRow[]
  ownedCount: number
  missingCount: number
  inventoryLoaded: boolean
}

export type InventoryIndex = Record<string, number>

/** Per-item mastery/owned info from inventory export (may be incomplete). */
export type MasteryEntry = {
  owned: number
  xpLevel: number | null
  /** null = unknown (export lacked XP data) */
  mastered: boolean | null
  /** Applied Forma / polarity slots when export included Polarity[]. */
  formaCount: number | null
}

export type MasteryIndex = Record<string, MasteryEntry>

export type LoadoutCategory =
  | 'warframe'
  | 'primary'
  | 'secondary'
  | 'melee'
  | 'companion'
  | 'archwing'
  | 'other'

export type LoadoutCoachTag = 'unranked' | 'under_forma' | 'forma_ok' | 'sp_ready' | 'unknown_rank'

export type LoadoutItem = {
  uniqueName: string
  name: string
  category: LoadoutCategory
  owned: number
  xpLevel: number | null
  mastered: boolean | null
  formaCount: number
  tags: LoadoutCoachTag[]
  note: string
}

export type LoadoutSnapshot = {
  playerLevel: number | null
  loaded: boolean
  items: LoadoutItem[]
  summary: {
    warframes: number
    weapons: number
    unranked: number
    underForma: number
    spReady: number
  }
}

export type ArbitrationDropHit = {
  displayName: string
  uniqueName: string
  delta: number
  rare: boolean
}

export type ArbitrationRunEntry = {
  id: string
  at: string
  source: 'mission_complete' | 'inventory_sync'
  node: string | null
  drops: ArbitrationDropHit[]
}

export type ArbitrationLogSnapshot = {
  runs: ArbitrationRunEntry[]
  sessionStartedAt: string
}

/** Multi-day Arbitration haul analytics (persisted). */
export type ArbitrationAnalytics = {
  sessionStartedAt: string
  /** Recent runs (newest first), including older persisted history. */
  runs: ArbitrationRunEntry[]
  totals: {
    runs: number
    vitusEssence: number
    rareDrops: number
    totalDropStacks: number
  }
  byNode: Array<{ node: string; runs: number; vitus: number; rareDrops: number }>
  byDay: Array<{ day: string; runs: number; vitus: number }>
  /** Vitus gained / hours spanned by history (null if < 1 run). */
  vitusPerHour: number | null
  historyDays: number
}

export type FoundryCategory =
  | 'warframe'
  | 'primary'
  | 'secondary'
  | 'melee'
  | 'companion'
  | 'archwing'
  | 'other'

export type RecipeComponent = {
  name: string
  uniqueName: string
  itemCount: number
  /** CDN basename from warframestat (e.g. `braton-prime-barrel.png`). */
  imageName: string | null
  /** Nested recipe when present on the API payload. */
  components?: RecipeComponent[]
}

export type RecipeItem = {
  uniqueName: string
  name: string
  category: FoundryCategory
  masteryReq: number | null
  buildPrice: number | null
  buildTime: number | null
  vaulted: boolean | null
  isPrime: boolean
  /** CDN basename from warframestat (e.g. `excalibur-prime.png`). */
  imageName: string | null
  components: RecipeComponent[]
}

export type FoundryOwnedFilter = 'any' | 'owned' | 'unowned'
export type FoundryMasteryFilter = 'any' | 'mastered' | 'unmastered' | 'unknown'
export type FoundryReadyFilter = 'any' | 'ready' | 'not_ready'
export type FoundryPrimeFilter = 'any' | 'prime' | 'normal'
export type FoundryVaultedFilter = 'any' | 'vaulted' | 'unvaulted'
/** inventory = owned gear + ready-to-build; all = full recipe catalog */
export type FoundryScopeFilter = 'inventory' | 'all'

export type FoundryListFilters = {
  search?: string
  category?: FoundryCategory | 'all'
  prime?: FoundryPrimeFilter
  owned?: FoundryOwnedFilter
  mastery?: FoundryMasteryFilter
  ready?: FoundryReadyFilter
  vaulted?: FoundryVaultedFilter
  /** Defaults to inventory-scoped list for performance. */
  scope?: FoundryScopeFilter
}

export type FoundryListItem = {
  uniqueName: string
  name: string
  category: FoundryCategory
  masteryReq: number | null
  buildPrice: number | null
  buildTime: number | null
  vaulted: boolean | null
  isPrime: boolean
  imageName: string | null
  owned: boolean
  /** Own the main recipe blueprint (not necessarily the finished item). */
  hasBlueprint: boolean
  ownedCount: number
  mastered: boolean | null
  readyToBuild: boolean
  missingDirect: number
}

export type FoundryTreeNode = {
  name: string
  uniqueName: string
  required: number
  owned: number
  missing: number
  imageName: string | null
  children: FoundryTreeNode[]
}

export type FoundryTotalLine = {
  name: string
  uniqueName: string
  required: number
  owned: number
  missing: number
  imageName: string | null
}

export type FoundryTreeResult = {
  item: FoundryListItem | null
  tree: FoundryTreeNode | null
  totals: FoundryTotalLine[]
  /** Direct-part checklist + owned-relic farm hints for the selected recipe. */
  setFarm: SetFarmResult | null
  inventoryLoaded: boolean
  error: string | null
}

export type RelicDropSource = {
  key: string
  tier: string
  rarity: string
  chance: number | null
  vaulted: boolean | null
}

/** Relic that drops a set part, with how many you own of that relic type. */
export type SetFarmRelicSource = RelicDropSource & {
  owned: number
}

export type SetFarmPart = {
  name: string
  uniqueName: string
  imageName: string | null
  required: number
  owned: number
  missing: number
  /** True when owned >= required for this direct component. */
  have: boolean
  /** Relics you own that can drop this part (sorted by owned count). */
  sourcesOwned: SetFarmRelicSource[]
  /** Other relics (unowned / vaulted) — shown when you own none. */
  sourcesOther: SetFarmRelicSource[]
}

export type SetFarmResult = {
  uniqueName: string
  name: string
  imageName: string | null
  /** Finished item already in inventory. */
  ownedFinished: boolean
  parts: SetFarmPart[]
  haveCount: number
  missingCount: number
  inventoryLoaded: boolean
  error: string | null
}

export type RelicBestPickMode = 'balanced' | 'needed' | 'platinum' | 'ducats'

export type RelicPlannerSort =
  | 'missing'
  | 'platinum'
  | 'ducats'
  | 'owned'
  | 'name'
  | 'upgradePlat'
  | 'upgradeDucats'

export type RelicPlannerReward = {
  name: string
  uniqueName: string | null
  rarity: string
  chance: number | null
  owned: number
  needed: boolean
  platinum: number | null
  ducats: number | null
}

export type RelicRefinementCounts = {
  intact: number
  exceptional: number
  flawless: number
  radiant: number
}

export type RelicPlannerRow = {
  key: string
  name: string
  tier: string
  owned: number
  /** Per-refinement owned stacks when inventory is loaded. */
  refinements: RelicRefinementCounts
  vaulted: boolean | null
  missingCount: number
  bestPlatinum: number | null
  bestDucats: number | null
  /** Plat per void-trace to push one relic to Radiant (higher = better upgrade ROI). */
  upgradePlatScore: number | null
  /** Ducats per void-trace to Radiant. */
  upgradeDucatsScore: number | null
  /** Traces needed to upgrade one cheapest non-radiant copy to Radiant. */
  tracesToRadiant: number | null
  hasFavorite: boolean
  rewards: RelicPlannerReward[]
}

export type RelicPlannerResult = {
  rows: RelicPlannerRow[]
  ownedRelicTypes: number
  inventoryLoaded: boolean
  error: string | null
}

export type RelicPlannerQuery = {
  ownedOnly?: boolean
  sort?: RelicPlannerSort
  search?: string
  tier?: string
  /** Filter relics by whether rewards include Prime parts. */
  prime?: FoundryPrimeFilter
  /** Float farm-favorite rewards to the top. */
  favoritesFirst?: boolean
  /** Cap rows (recommend overlay). */
  limit?: number
}

export type MasteryHelperItem = {
  uniqueName: string
  name: string
  category: FoundryCategory
  masteryReq: number | null
  owned: boolean
  mastered: boolean | null
  xpLevel: number | null
  readyToBuild: boolean
  isPrime: boolean
  imageName: string | null
}

export type MasteryHelperResult = {
  items: MasteryHelperItem[]
  summary: {
    mastered: number
    ownedUnmastered: number
    readyUnmastered: number
    unknown: number
  }
  inventoryLoaded: boolean
  error: string | null
}

export type MasteryHelperQuery = {
  filter?: 'next' | 'owned_unmastered' | 'ready' | 'all'
  search?: string
}

export type InventoryCandidate = {
  path: string
  label: string
  source: InventorySource
  mtime: string
}

/** warframe.market browser JWT session (no password stored). */
export type WfmSession = {
  linked: boolean
  ingameName: string | null
  platform: string | null
  reputation: number | null
  status: string | null
  error: string | null
}

export type WfmOrder = {
  id: string
  orderType: 'buy' | 'sell'
  platinum: number
  quantity: number
  visible: boolean
  itemName: string
  itemUrlName: string | null
  lastUpdate: string | null
}

export type WfmUpdateOrderInput = {
  orderId: string
  platinum?: number
  quantity?: number
  visible?: boolean
}

export type MarketQuote = {
  name: string
  /** Median sell platinum. */
  platinum: number
  /** Lowest visible sell order. */
  floor: number
  volume: number
}

export type MarketBuyTarget = {
  name: string
  maxPlatinum: number
  /** How many you still want (optional). */
  quantity?: number
}

export type MarketMinPrice = {
  name: string
  minPlatinum: number
}

export type MarketRivenStockItem = {
  id: string
  weapon: string
  minPlatinum: number
  polarity?: string
  note?: string
  addedAt: string
}

/** Local trade / sold log (manual mark-sold + optional buys). */
export type MarketTradeEntry = {
  id: string
  at: string
  side: 'sell' | 'buy'
  itemName: string
  platinum: number
  quantity: number
  note?: string
}

export type MarketTradeLogResult = {
  entries: MarketTradeEntry[]
  soldPlat: number
  boughtPlat: number
  netPlat: number
  /** App-session boundary for session P/L (ISO). */
  sessionStartedAt: string
  sessionSoldPlat: number
  sessionBoughtPlat: number
  sessionNetPlat: number
}

export type MarketTradeInput = {
  side: 'sell' | 'buy'
  itemName: string
  platinum: number
  quantity?: number
  note?: string
}

export type EconomySnapshot = {
  at: string
  credits: number
  ducats: number
  platinum: number
}

export type EconomyTrendResult = {
  snapshots: EconomySnapshot[]
  latest: EconomySnapshot | null
  delta: {
    credits: number
    ducats: number
    platinum: number
  } | null
}

export type SetFissureMatch = {
  fissureId: string
  node: string
  missionType: string
  tier: string
  eta: string
  isHard: boolean
  isStorm: boolean
  /** Relic keys from this set that drop on this tier. */
  relicKeys: string[]
  /** Missing part names this fissure can help. */
  missingParts: string[]
  score: number
}

export type SetFissurePathResult = {
  setName: string
  uniqueName: string
  matches: SetFissureMatch[]
  missingParts: string[]
  inventoryLoaded: boolean
  error: string | null
}

export type LfgPlatform = 'pc' | 'psn' | 'xbox' | 'switch' | 'mobile'
export type LfgRegion = 'na' | 'eu' | 'asia' | 'sa' | 'oce'
export type LfgActivity = 'relic' | 'fissure' | 'farm' | 'boss' | 'custom'
export type LfgShareType = 'radshare' | 'intactshare' | 'any'

export type LfgMember = {
  ign: string
  clientId: string
  joinedAt: string
  isHost: boolean
}

export type LfgListing = {
  id: string
  createdAt: string
  expiresAt: string
  hostIgn: string
  platform: string
  region: string
  language: string
  activity: string
  title: string
  notes: string
  relicKey: string | null
  refinement: string | null
  shareType: string | null
  steelPath: boolean
  missionHint: string | null
  slotsTotal: number
  members: LfgMember[]
  slotsOpen: number
  whisper: string
  inviteHint: string
}

export type LfgCreateInput = {
  hostIgn: string
  clientId: string
  platform?: string
  region?: string
  language?: string
  activity?: string
  title: string
  notes?: string
  relicKey?: string | null
  refinement?: string | null
  shareType?: string | null
  steelPath?: boolean
  missionHint?: string | null
  slotsTotal?: number
  ttlMs?: number
}

export type LfgListResult = {
  listings: LfgListing[]
  baseUrl: string
  error: string | null
  /** Soft notice (e.g. Railway edge fallback to local). */
  warning?: string | null
}

export type LfgJoinResult = {
  ok: boolean
  listing: LfgListing | null
  error: string | null
  warning?: string | null
}

/** warframe.market auction contract (riven / lich / sister). */
export type WfmContract = {
  id: string
  kind: 'riven' | 'lich' | 'sister' | 'unknown'
  title: string
  detail: string | null
  startingPrice: number
  buyoutPrice: number | null
  topBid: number | null
  isDirectSell: boolean
  visible: boolean
  closed: boolean
  marketUrl: string
  lastUpdate: string | null
}

export type WfmCreateOrderInput = {
  itemId?: string
  itemSlugOrName?: string
  orderType: 'buy' | 'sell'
  platinum: number
  quantity: number
  visible?: boolean
  rank?: number | null
}

export type WfmCreateContractInput = {
  kind: 'riven' | 'lich' | 'sister'
  weaponUrlName: string
  startingPrice: number
  buyoutPrice?: number | null
  isDirectSell?: boolean
  visible?: boolean
  note?: string
  /** Riven */
  rivenName?: string
  modRank?: number
  reRolls?: number
  polarity?: string
  masteryLevel?: number
  /** Lines like "+critical_chance 187.2" or "-ammo_maximum 6" */
  attributesText?: string
  /** Lich / Sister */
  element?: string
  damage?: number
  havingEphemera?: boolean
  quirk?: string
}

export type WfmItemHint = {
  id: string
  slug: string
  name: string
}

export type InventoryStatus = {
  path: string
  source: InventorySource
  consent: boolean
  lastSynced: string
  itemCount: number
  uniqueCount: number
  /**
   * Bumps on every successful inventory load/sync so UI (Foundry, relics)
   * can refresh even when uniqueCount stays the same.
   */
  revision: number
  loaded: boolean
  helperReady: boolean
  /** Bundled warframe-api-helper release tag (e.g. 1.1.2). */
  helperVersion: string
  warframeRunning: boolean
  /** True when lastSynced is missing or older than ~6 hours. */
  stale: boolean
  /** Milliseconds since lastSynced, or null if never synced. */
  staleAgeMs: number | null
  /** Node process.platform */
  platform: string
  /** Linux: Warframe Steam/Proton prefix detected */
  protonPlay: boolean
  error: string | null
  candidates: InventoryCandidate[]
  /** Account / player mastery rank from inventory export when present. */
  playerLevel: number | null
}

export type InventoryBrowseKind = 'part' | 'gear' | 'relic' | 'resource' | 'currency' | 'other'

export type InventoryBrowseItem = {
  uniqueName: string
  displayName: string
  count: number
  kind: InventoryBrowseKind
  isBlueprint: boolean
  isComponent: boolean
  /** Median sell platinum when known (WFInfo / market). */
  platinum: number | null
  ducats: number | null
  /** Units beyond one kept copy (parts) — useful for sell / ducat dump. */
  excess: number
}

export type InventoryBrowseSort = 'count' | 'name' | 'platinum' | 'ducats' | 'excess'

export type InventoryBrowseQuery = {
  search?: string
  kind?: InventoryBrowseKind | 'all'
  /** Only parts/BPs with excess + a known platinum (or ducats) price. */
  sellableOnly?: boolean
  /** Attach platinum/ducats (also implied by sellableOnly). Off by default for speed. */
  enrichPrices?: boolean
  /** Default: platinum for sellable, else count. */
  sort?: InventoryBrowseSort
  limit?: number
}

export type InventoryDiffEntry = {
  uniqueName: string
  displayName: string
  before: number
  after: number
  delta: number
}

export type InventoryDiff = {
  syncedAt: string
  added: InventoryDiffEntry[]
  removed: InventoryDiffEntry[]
  changed: InventoryDiffEntry[]
  summary: {
    addedStacks: number
    removedStacks: number
    changedStacks: number
    netUnits: number
  }
}

/** One persisted sync diff for history browsing. */
export type InventoryDiffHistoryEntry = {
  id: string
  syncedAt: string
  summary: InventoryDiff['summary']
  added: InventoryDiffEntry[]
  removed: InventoryDiffEntry[]
  changed: InventoryDiffEntry[]
}

export type InventoryDiffHistoryResult = {
  entries: InventoryDiffHistoryEntry[]
}

export type InventorySyncResult = {
  ok: boolean
  path?: string
  source?: InventorySource
  itemCount?: number
  uniqueCount?: number
  error?: string
  /** Present when a previous inventory was loaded before this sync. */
  diff?: InventoryDiff | null
}

/** In-memory “tonight’s haul” for the current app session. */
export type SessionHaulRelicHit = {
  at: string
  name: string
  needed: boolean
  platinum: number | null
  setName: string | null
}

export type SessionHaulSnapshot = {
  startedAt: string
  relicScans: number
  relicHits: SessionHaulRelicHit[]
  neededParts: number
  platEstimate: number
  inventoryAdded: InventoryDiffEntry[]
  inventoryChanged: InventoryDiffEntry[]
  lastSyncAt: string | null
}

/** Unified session view: haul + trades + rivens + arbitration. */
export type SessionLedgerSnapshot = {
  startedAt: string
  haul: SessionHaulSnapshot
  trades: {
    soldPlat: number
    boughtPlat: number
    netPlat: number
    count: number
  }
  rivens: {
    scans: number
    lastWeapon: string | null
  }
  arbitration: {
    runs: number
    vitus: number
    rareDrops: number
  }
}

/** Fired when a saved OCR display id is gone (Windows remount / driver remap). */
export type DisplayRemountPrompt = {
  previousId: number
  displays: DisplayChoice[]
}

export type SetProgressPart = {
  name: string
  uniqueName: string
  owned: number
  needed: boolean
}

export type SetProgressRow = {
  uniqueName: string
  name: string
  category: FoundryCategory
  vaulted: boolean | null
  ownedParts: number
  totalParts: number
  missingParts: number
  complete: boolean
  percent: number
  parts: SetProgressPart[]
}

export type SetProgressResult = {
  rows: SetProgressRow[]
  inventoryLoaded: boolean
  error: string | null
}

export type MarketUndercutSuggestion = {
  name: string
  floor: number
  median: number
  suggest: number
  volume: number
}

export type MarketPricePoint = {
  at: number
  avg: number
  min: number
  max: number
  volume: number
}

/** warframe.market statistics for charts (48h + 90d). */
export type MarketPriceHistory = {
  name: string
  slug: string
  points48h: MarketPricePoint[]
  points90d: MarketPricePoint[]
  error: string | null
}

export type SetPartOwned = {
  partName: string
  itemName: string
  owned: number
}

export type RewardEval = {
  slot: number
  ocrText: string
  name: string
  uniqueName: string | null
  setName: string | null
  partName: string | null
  owned: number
  needed: boolean
  setOwnedParts: number
  setTotalParts: number
  setParts: SetPartOwned[]
  /** Match confidence 0–1 (1 = exact catalog match). */
  matchScore: number
  ducats: number | null
  /** Median warframe.market platinum (sell orders), if available. */
  platinum: number | null
  volume: number | null
  /** Best overall pick among the four rewards. */
  bestPick: boolean
  /** Prime set is currently vaulted (when known from catalog). */
  vaulted: boolean | null
}

export type RelicScanMeta = {
  theme: string | null
  slotHint: number | null
  trimmedTo: number | null
  formaSlots: number
}

export type RelicScanState = {
  active: boolean
  scanning: boolean
  scannedAt: string
  trigger: 'manual' | 'log' | 'none'
  error: string | null
  rewards: RewardEval[]
  inventoryLoaded: boolean
  celebration: boolean
  /** EE.log squad-size hint (1–4) when available. */
  squadSize: number | null
  /** Last successful (or failed) scan diagnostics for Settings hints. */
  scanMeta: RelicScanMeta | null
}

export type RivenHistoryEntry = {
  id: string
  scannedAt: string
  weapon: string
  side: 'current' | 'reroll'
  /** True when this side was the recommended pick. */
  picked: boolean
  score: number
  tier: RivenTier
  platinum: number | null
  polarity: string | null
  marketUrl: string | null
  statsSummary: string
}

export type RivenHistoryResult = {
  entries: RivenHistoryEntry[]
  /** Newest→oldest platinum samples for a simple trend (picked side preferred). */
  platTrend: Array<{ scannedAt: string; platinum: number; weapon: string }>
}

export type AppUpdateStatus = {
  supported: boolean
  checking: boolean
  available: boolean
  downloading: boolean
  downloaded: boolean
  currentVersion: string
  latestVersion: string | null
  progress: number
  error: string | null
  message: string
}

export type PrimaryDisplayInfo = {
  width: number
  height: number
  scaleFactor: number
  /** Electron display id when available. */
  id?: number
  label?: string
  isPrimary?: boolean
}

export type DisplayChoice = {
  id: number
  label: string
  width: number
  height: number
  scaleFactor: number
  isPrimary: boolean
}

export type HotkeyRegistration = {
  id: keyof HotkeyConfig
  requested: string
  registered: string | null
  ok: boolean
}

export type BugReportCategory =
  | 'relics'
  | 'rivens'
  | 'overlay'
  | 'inventory'
  | 'linux'
  | 'other'

export type BugReportDraft = {
  title: string
  category: BugReportCategory
  description: string
  includeDiagnostics: boolean
}

export type BugReportOpenResult = {
  ok: boolean
  url: string
  truncated: boolean
  stagingDir: string | null
  debugDirs: string[]
  error?: string
}

export type InstallKind = 'nsis' | 'portable' | 'appimage' | 'deb' | 'dev' | 'unknown'

export type UninstallInfo = {
  kind: InstallKind
  canLaunchUninstaller: boolean
  uninstallerPath: string | null
  installDir: string | null
  userDataPath: string
  guidance: string
}

export type OverlayContentOrigin = {
  x: number
  y: number
  designWidth: number
  designHeight: number
  tight: boolean
}

export type VoidLensApi = {
  getSettings: () => Promise<AppSettings>
  updateSettings: (partial: Partial<AppSettings>) => Promise<AppSettings>
  setModuleEnabled: (id: ModuleId, enabled: boolean) => Promise<AppSettings>
  getPrimaryDisplay: () => Promise<PrimaryDisplayInfo>
  listDisplays: () => Promise<DisplayChoice[]>
  getWorldstate: () => Promise<WorldstateSnapshot>
  refreshWorldstate: () => Promise<WorldstateSnapshot>
  toggleOverlay: () => Promise<boolean>
  setLayoutEditMode: (enabled: boolean) => Promise<AppSettings>
  /** Raise companion and switch to a tab (e.g. settings, market). */
  navigateCompanion: (tab: string) => Promise<boolean>
  /** Toggle fissures + OCR-only quiet focus mode. */
  toggleQuietFocus: () => Promise<AppSettings>
  pickEeLogPath: () => Promise<string | null>
  pickInventoryPath: () => Promise<string | null>
  detectEeLogPath: () => Promise<string | null>
  getInventoryStatus: () => Promise<InventoryStatus>
  setInventoryConsent: (consent: boolean) => Promise<InventoryStatus>
  detectInventorySources: () => Promise<InventoryStatus>
  useInventoryCandidate: (path: string) => Promise<InventorySyncResult>
  syncInventoryFromGame: () => Promise<InventorySyncResult>
  clearInventory: () => Promise<InventoryStatus>
  getInventoryIndex: () => Promise<InventoryIndex>
  browseInventory: (query?: InventoryBrowseQuery) => Promise<InventoryBrowseItem[]>
  getRelicScan: () => Promise<RelicScanState>
  scanRelicRewards: () => Promise<RelicScanState>
  clearRelicScan: () => Promise<RelicScanState>
  ackRelicCelebration: () => Promise<RelicScanState>
  getRivenScan: () => Promise<RivenScanState>
  scanRivens: () => Promise<RivenScanState>
  clearRivenScan: () => Promise<RivenScanState>
  getRivenHistory: () => Promise<RivenHistoryResult>
  clearRivenHistory: () => Promise<RivenHistoryResult>
  getFoundryItems: (filters?: FoundryListFilters) => Promise<FoundryListItem[]>
  getFoundryTree: (uniqueName: string) => Promise<FoundryTreeResult>
  getRelicPlanner: (query?: RelicPlannerQuery) => Promise<RelicPlannerResult>
  getDropSources: (nameOrUnique: string) => Promise<RelicDropSource[]>
  getSetFarm: (opts?: {
    uniqueName?: string
    search?: string
    prime?: FoundryPrimeFilter
  }) => Promise<SetFarmResult | null>
  getSetFissurePath: (uniqueName: string) => Promise<SetFissurePathResult>
  getSetProgress: (opts?: {
    search?: string
    incompleteOnly?: boolean
    completion?: 'incomplete' | 'complete' | 'all'
    limit?: number
  }) => Promise<SetProgressResult>
  getInventoryDiff: () => Promise<InventoryDiff | null>
  getInventoryDiffHistory: () => Promise<InventoryDiffHistoryResult>
  clearInventoryDiffHistory: () => Promise<InventoryDiffHistoryResult>
  getLoadoutSnapshot: () => Promise<LoadoutSnapshot>
  getCircuitTracker: () => Promise<CircuitTrackerSnapshot>
  getArbitrationLog: () => Promise<ArbitrationLogSnapshot>
  getArbitrationAnalytics: () => Promise<ArbitrationAnalytics>
  clearArbitrationLog: () => Promise<ArbitrationLogSnapshot>
  getSessionHaul: () => Promise<SessionHaulSnapshot>
  clearSessionHaul: () => Promise<SessionHaulSnapshot>
  getSessionLedger: () => Promise<SessionLedgerSnapshot>
  suggestMarketUndercut: (name: string) => Promise<MarketUndercutSuggestion | null>
  getMarketPriceHistory: (name: string) => Promise<MarketPriceHistory>
  getEconomyTrend: () => Promise<EconomyTrendResult>
  lfgHealth: () => Promise<{ ok: boolean; listings?: number; error?: string; baseUrl: string }>
  listLfg: (opts?: {
    region?: string
    platform?: string
    activity?: string
    q?: string
  }) => Promise<LfgListResult>
  /** Lightweight relic names for LFG typeahead (cached; no planner enrichment). */
  getLfgRelicOptions: () => Promise<
    Array<{ id: string; label: string; value: string; detail: string; owned: number }>
  >
  createLfg: (
    input: LfgCreateInput,
  ) => Promise<{ ok: boolean; listing?: LfgListing; hostToken?: string; error?: string }>
  joinLfg: (input: { id: string; ign: string; clientId: string }) => Promise<LfgJoinResult>
  leaveLfg: (input: { id: string; clientId: string }) => Promise<{ ok: boolean; error?: string }>
  deleteLfg: (input: { id: string; hostToken: string }) => Promise<{ ok: boolean; error?: string }>
  extendLfg: (input: {
    id: string
    hostToken: string
    addMs?: number
  }) => Promise<{ ok: boolean; listing?: LfgListing; error?: string }>
  /** OS notification (used for LFG join alerts, etc.). */
  desktopNotify: (payload: { title: string; body?: string }) => Promise<boolean>
  getMasteryHelper: (query?: MasteryHelperQuery) => Promise<MasteryHelperResult>
  getHotkeyStatus: () => Promise<HotkeyRegistration[]>
  onHotkeyStatus: (cb: (status: HotkeyRegistration[]) => void) => () => void
  onDisplayRemount: (cb: (prompt: DisplayRemountPrompt) => void) => () => void
  onCompanionNavigate: (cb: (tab: string) => void) => () => void
  getAppVersion: () => Promise<string>
  getUpdateStatus: () => Promise<AppUpdateStatus>
  checkForUpdates: () => Promise<AppUpdateStatus>
  installUpdate: () => Promise<boolean>
  openBugReport: (draft: BugReportDraft) => Promise<BugReportOpenResult>
  copyBugDiagnostics: (draft?: Partial<BugReportDraft>) => Promise<boolean>
  pickBugScreenshots: () => Promise<{ stagingDir: string; count: number } | null>
  openBugDebugFolders: () => Promise<string[]>
  getUninstallInfo: () => Promise<UninstallInfo>
  exportSettings: () => Promise<{ ok: boolean; path?: string; error?: string }>
  importSettings: () => Promise<{ ok: boolean; error?: string }>
  pickCloudSyncFolder: () => Promise<{ ok: boolean; path?: string; error?: string }>
  clearCloudSyncPath: () => Promise<{ ok: boolean }>
  pushCloudSettings: () => Promise<{ ok: boolean; error?: string }>
  pullCloudSettings: (
    force?: boolean,
  ) => Promise<{ ok: boolean; imported?: boolean; error?: string; path?: string }>
  launchUninstaller: () => Promise<{ ok: boolean; error?: string }>
  openWindowsAppsSettings: () => Promise<{ ok: boolean; error?: string }>
  openUserDataFolder: () => Promise<{ ok: boolean; error?: string }>
  clearUserDataAndQuit: () => Promise<{ ok: boolean; error?: string }>
  lookupMarketPrices: (
    names: string[],
  ) => Promise<Array<{ name: string; platinum: number; floor: number; volume: number }>>
  getWfmSession: () => Promise<WfmSession>
  setWfmJwt: (jwt: string) => Promise<WfmSession>
  clearWfmJwt: () => Promise<WfmSession>
  getWfmOrders: () => Promise<{ orders: WfmOrder[]; error: string | null }>
  deleteWfmOrder: (orderId: string) => Promise<{ ok: boolean; error?: string }>
  updateWfmOrder: (
    input: WfmUpdateOrderInput,
  ) => Promise<{ ok: boolean; error?: string; order?: WfmOrder }>
  getMarketTradeLog: () => Promise<MarketTradeLogResult>
  addMarketTrade: (input: MarketTradeInput) => Promise<MarketTradeLogResult>
  removeMarketTrade: (id: string) => Promise<MarketTradeLogResult>
  clearMarketTradeLog: () => Promise<MarketTradeLogResult>
  getWfmContracts: () => Promise<{ contracts: WfmContract[]; error: string | null }>
  deleteWfmContract: (contractId: string) => Promise<{ ok: boolean; error?: string }>
  searchWfmItems: (query: string) => Promise<WfmItemHint[]>
  createWfmOrder: (
    input: WfmCreateOrderInput,
  ) => Promise<{ ok: boolean; error?: string; order?: WfmOrder }>
  createWfmContract: (
    input: WfmCreateContractInput,
  ) => Promise<{ ok: boolean; error?: string; contract?: WfmContract }>
  openExternal: (url: string) => Promise<boolean>
  testScreenCapture: () => Promise<{ ok: boolean; message: string }>
  /** Linux: YAMA ptrace_scope + Proton / Steam parity. */
  getLinuxHealth: () => Promise<{
    platform: string
    ptrace: {
      scope: number | null
      permissive: boolean
      label: string
      detail: string
      fixCommand: string
      tip: string
    }
    steamRunning: boolean
    wineLauncherFound: boolean
    protonPrefix: string | null
  }>
  getPendingCrash: () => Promise<{ at: string; label: string; preview: string } | null>
  clearPendingCrash: () => Promise<boolean>
  readCrashLogTail: () => Promise<string>
  getWidgetServerStatus: () => Promise<{ running: boolean; port: number; baseUrl: string }>
  onSettingsChanged: (cb: (settings: AppSettings) => void) => () => void
  onWorldstateUpdated: (cb: (data: WorldstateSnapshot) => void) => () => void
  onOverlayVisibilityChanged: (cb: (visible: boolean) => void) => () => void
  onOverlayContentOrigin: (cb: (origin: OverlayContentOrigin) => void) => () => void
  getOverlayContentOrigin: () => Promise<OverlayContentOrigin | null>
  onInventoryUpdated: (cb: (status: InventoryStatus) => void) => () => void
  onInventoryProgress: (
    cb: (progress: { stage: string; message: string }) => void,
  ) => () => void
  onRelicScanUpdated: (cb: (state: RelicScanState) => void) => () => void
  onRivenScanUpdated: (cb: (state: RivenScanState) => void) => () => void
  onUpdateStatus: (cb: (status: AppUpdateStatus) => void) => () => void
  onRelicSound: (cb: () => void) => () => void
  onRivenSound: (cb: () => void) => () => void
}
