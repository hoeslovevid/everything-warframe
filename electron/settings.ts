import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { mergeOcrScanRegions } from '../shared/captureGeometry'
import {
  AppSettings,
  ColorThemeId,
  CustomPalette,
  DEFAULT_CUSTOM_PALETTE,
  DEFAULT_SETTINGS,
  ModuleId,
  OVERLAY_MODULE_IDS,
} from '../shared/types'

const COLOR_THEMES: ColorThemeId[] = [
  'void',
  'ember',
  'glacier',
  'obsidian',
  'snow',
  'parchment',
  'mist',
  'harbor',
  'custom',
]

const HEX_RE = /^#?[0-9a-fA-F]{6}$/

function mergeCustomPalette(
  raw: Partial<CustomPalette> | null | undefined,
  fallback: CustomPalette = DEFAULT_CUSTOM_PALETTE,
): CustomPalette {
  const normalize = (value: unknown, fb: string) => {
    if (typeof value !== 'string' || !HEX_RE.test(value.trim())) return fb
    const hex = value.trim()
    return hex.startsWith('#') ? hex.toLowerCase() : `#${hex.toLowerCase()}`
  }
  return {
    mode: raw?.mode === 'light' ? 'light' : 'dark',
    background: normalize(raw?.background, fallback.background),
    text: normalize(raw?.text, fallback.text),
    muted: normalize(raw?.muted, fallback.muted),
    accentA: normalize(raw?.accentA, fallback.accentA),
    accentB: normalize(raw?.accentB, fallback.accentB),
  }
}

let cache: AppSettings | null = null

function settingsPath() {
  return path.join(app.getPath('userData'), 'voidlens-settings.json')
}

function clampOpacity(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  return Math.min(1, Math.max(0.4, value))
}

function mergeModuleOpacity(
  raw: Partial<AppSettings> | null | undefined,
  base: AppSettings,
): AppSettings['moduleOpacity'] {
  const fallback = clampOpacity(raw?.opacity, base.opacity)
  const next: AppSettings['moduleOpacity'] = { ...base.moduleOpacity }
  for (const id of OVERLAY_MODULE_IDS) {
    next[id] = fallback
  }
  const fromFile = raw?.moduleOpacity
  if (fromFile && typeof fromFile === 'object') {
    for (const id of OVERLAY_MODULE_IDS) {
      if (id in fromFile) {
        next[id] = clampOpacity(fromFile[id], fallback)
      }
    }
  }
  return next
}

function mergeSettings(raw: Partial<AppSettings> | null | undefined): AppSettings {
  const base = structuredClone(DEFAULT_SETTINGS)
  if (!raw) return base

  const panelAnchors = { ...base.panelAnchors, ...(raw.panelAnchors ?? {}) }
  // One-time upgrade: original centered default sat on the Cycle cards.
  const legacyRivens = raw.panelAnchors?.rivens
  if (
    legacyRivens &&
    legacyRivens.x === 480 &&
    legacyRivens.y === 200 &&
    base.panelAnchors.rivens
  ) {
    panelAnchors.rivens = { ...base.panelAnchors.rivens }
  }

  return {
    ...base,
    ...raw,
    modules: { ...base.modules, ...(raw.modules ?? {}) },
    panelAnchors,
    opacity: clampOpacity(raw.opacity, base.opacity),
    moduleOpacity: mergeModuleOpacity(raw, base),
    hotkeys: {
      ...base.hotkeys,
      ...(raw.hotkeys ?? {}),
      scanRelics: raw.hotkeys?.scanRelics || base.hotkeys.scanRelics,
      dismissRelics: raw.hotkeys?.dismissRelics || base.hotkeys.dismissRelics,
      scanRivens: raw.hotkeys?.scanRivens || base.hotkeys.scanRivens,
      dismissRivens: raw.hotkeys?.dismissRivens || base.hotkeys.dismissRivens,
      editLayout: raw.hotkeys?.editLayout || base.hotkeys.editLayout,
      toggleWorldstatePanels:
        typeof raw.hotkeys?.toggleWorldstatePanels === 'string'
          ? raw.hotkeys.toggleWorldstatePanels
          : base.hotkeys.toggleWorldstatePanels,
      toggleQuietFocus:
        typeof raw.hotkeys?.toggleQuietFocus === 'string'
          ? raw.hotkeys.toggleQuietFocus
          : base.hotkeys.toggleQuietFocus,
      toggleModuleCycles:
        typeof raw.hotkeys?.toggleModuleCycles === 'string'
          ? raw.hotkeys.toggleModuleCycles
          : base.hotkeys.toggleModuleCycles,
      toggleModuleFissures:
        typeof raw.hotkeys?.toggleModuleFissures === 'string'
          ? raw.hotkeys.toggleModuleFissures
          : base.hotkeys.toggleModuleFissures,
      toggleModuleBaro:
        typeof raw.hotkeys?.toggleModuleBaro === 'string'
          ? raw.hotkeys.toggleModuleBaro
          : base.hotkeys.toggleModuleBaro,
      toggleModuleNightwave:
        typeof raw.hotkeys?.toggleModuleNightwave === 'string'
          ? raw.hotkeys.toggleModuleNightwave
          : base.hotkeys.toggleModuleNightwave,
      toggleModuleArbitration:
        typeof raw.hotkeys?.toggleModuleArbitration === 'string'
          ? raw.hotkeys.toggleModuleArbitration
          : base.hotkeys.toggleModuleArbitration,
      toggleModuleInvasions:
        typeof raw.hotkeys?.toggleModuleInvasions === 'string'
          ? raw.hotkeys.toggleModuleInvasions
          : base.hotkeys.toggleModuleInvasions,
      toggleModuleArchon:
        typeof raw.hotkeys?.toggleModuleArchon === 'string'
          ? raw.hotkeys.toggleModuleArchon
          : base.hotkeys.toggleModuleArchon,
      toggleModuleDeepArchimedea:
        typeof raw.hotkeys?.toggleModuleDeepArchimedea === 'string'
          ? raw.hotkeys.toggleModuleDeepArchimedea
          : base.hotkeys.toggleModuleDeepArchimedea,
    },
    // Empty array would hide every fissure — treat as unset and restore defaults.
    fissureTiers:
      Array.isArray(raw.fissureTiers) && raw.fissureTiers.length > 0
        ? raw.fissureTiers
        : base.fissureTiers,
    fissurePathMode: (() => {
      const mode = (raw as { fissurePathMode?: string }).fissurePathMode
      if (mode === 'normal' || mode === 'steel' || mode === 'both') return mode
      // Migrate legacy boolean: false → normal only, true/missing → both
      if ((raw as { fissureShowSteelPath?: boolean }).fissureShowSteelPath === false) {
        return 'normal' as const
      }
      return base.fissurePathMode
    })(),
    fissureShowStorms:
      typeof (raw as { fissureShowStorms?: boolean }).fissureShowStorms === 'boolean'
        ? (raw as { fissureShowStorms: boolean }).fissureShowStorms
        : base.fissureShowStorms,
    fissureSort: raw.fissureSort ?? base.fissureSort,
    ocrDisplayId: (() => {
      const id = (raw as { ocrDisplayId?: number | null }).ocrDisplayId
      if (id === null || id === undefined) return base.ocrDisplayId
      return typeof id === 'number' && Number.isFinite(id) ? id : base.ocrDisplayId
    })(),
    wfThemeOverride: (() => {
      const v = (raw as { wfThemeOverride?: string | null }).wfThemeOverride
      if (v == null || v === '') return null
      const ok = [
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
      return ok.includes(v) ? (v as AppSettings['wfThemeOverride']) : null
    })(),
    relicSquadSizeOverride: (() => {
      const v = (raw as { relicSquadSizeOverride?: number | null }).relicSquadSizeOverride
      if (v === 3 || v === 4) return v
      return null
    })(),
    ocrScanRegions: mergeOcrScanRegions(
      (raw as { ocrScanRegions?: AppSettings['ocrScanRegions'] }).ocrScanRegions,
      base.ocrScanRegions,
    ),
    inventorySource: raw.inventorySource ?? base.inventorySource,
    inventoryConsent: raw.inventoryConsent ?? base.inventoryConsent,
    inventoryLastSynced: raw.inventoryLastSynced ?? base.inventoryLastSynced,
    overlayScale:
      typeof raw.overlayScale === 'number' && Number.isFinite(raw.overlayScale)
        ? Math.min(1.5, Math.max(0.75, raw.overlayScale))
        : base.overlayScale,
    colorTheme:
      raw.colorTheme && COLOR_THEMES.includes(raw.colorTheme as ColorThemeId)
        ? (raw.colorTheme as ColorThemeId)
        : base.colorTheme,
    customPalette: mergeCustomPalette(raw.customPalette, base.customPalette),
    overlayDragHintDismissed: raw.overlayDragHintDismissed ?? base.overlayDragHintDismissed,
    baroWishlist: Array.isArray(raw.baroWishlist) ? raw.baroWishlist : base.baroWishlist,
    farmFavorites: Array.isArray(raw.farmFavorites)
      ? raw.farmFavorites.filter((x): x is string => typeof x === 'string')
      : base.farmFavorites,
    relicRecommend: {
      ...base.relicRecommend,
      ...(raw.relicRecommend && typeof raw.relicRecommend === 'object'
        ? raw.relicRecommend
        : {}),
      sort: (() => {
        const sort = (raw.relicRecommend as { sort?: string } | undefined)?.sort
        if (
          sort === 'missing' ||
          sort === 'platinum' ||
          sort === 'ducats' ||
          sort === 'owned' ||
          sort === 'name' ||
          sort === 'upgradePlat' ||
          sort === 'upgradeDucats'
        ) {
          return sort
        }
        return base.relicRecommend.sort
      })(),
      prime: (() => {
        const prime = (raw.relicRecommend as { prime?: string } | undefined)?.prime
        if (prime === 'any' || prime === 'prime' || prime === 'normal') return prime
        return base.relicRecommend.prime
      })(),
      limit: (() => {
        const limit = (raw.relicRecommend as { limit?: number } | undefined)?.limit
        if (typeof limit === 'number' && Number.isFinite(limit) && limit > 0) {
          return Math.min(50, Math.floor(limit))
        }
        return base.relicRecommend.limit
      })(),
      ownedOnly:
        typeof (raw.relicRecommend as { ownedOnly?: boolean } | undefined)?.ownedOnly ===
        'boolean'
          ? (raw.relicRecommend as { ownedOnly: boolean }).ownedOnly
          : base.relicRecommend.ownedOnly,
      favoritesFirst:
        typeof (raw.relicRecommend as { favoritesFirst?: boolean } | undefined)
          ?.favoritesFirst === 'boolean'
          ? (raw.relicRecommend as { favoritesFirst: boolean }).favoritesFirst
          : base.relicRecommend.favoritesFirst,
      tier:
        typeof (raw.relicRecommend as { tier?: string } | undefined)?.tier === 'string' &&
        (raw.relicRecommend as { tier: string }).tier.trim()
          ? (raw.relicRecommend as { tier: string }).tier
          : base.relicRecommend.tier,
    },
    relicBestPickMode: (() => {
      const mode = (raw as { relicBestPickMode?: string }).relicBestPickMode
      if (
        mode === 'balanced' ||
        mode === 'needed' ||
        mode === 'platinum' ||
        mode === 'ducats'
      ) {
        return mode
      }
      return base.relicBestPickMode
    })(),
    nightwaveDoneIds: Array.isArray(raw.nightwaveDoneIds)
      ? raw.nightwaveDoneIds
      : base.nightwaveDoneIds,
    relicSoundEnabled: raw.relicSoundEnabled ?? base.relicSoundEnabled,
    rivenSoundEnabled: raw.rivenSoundEnabled ?? base.rivenSoundEnabled,
    soundPack:
      raw.soundPack === 'soft' ||
      raw.soundPack === 'bright' ||
      raw.soundPack === 'double' ||
      raw.soundPack === 'low'
        ? raw.soundPack
        : base.soundPack,
    activePlayProfile:
      typeof (raw as { activePlayProfile?: string | null }).activePlayProfile === 'string'
        ? (raw as { activePlayProfile: string }).activePlayProfile
        : (raw as { activePlayProfile?: null }).activePlayProfile === null
          ? null
          : base.activePlayProfile,
    marketWatchlist: Array.isArray(raw.marketWatchlist)
      ? raw.marketWatchlist.filter((x): x is string => typeof x === 'string')
      : base.marketWatchlist,
    marketBuyTargets: Array.isArray((raw as { marketBuyTargets?: unknown }).marketBuyTargets)
      ? (
          (raw as {
            marketBuyTargets: Array<{ name?: string; maxPlatinum?: number; quantity?: number }>
          }).marketBuyTargets || []
        )
          .filter((t) => t && typeof t.name === 'string' && t.name.trim())
          .map((t) => ({
            name: String(t.name).trim(),
            maxPlatinum: Math.max(1, Math.floor(Number(t.maxPlatinum) || 1)),
            quantity:
              typeof t.quantity === 'number' && Number.isFinite(t.quantity) && t.quantity > 0
                ? Math.floor(t.quantity)
                : undefined,
          }))
      : base.marketBuyTargets,
    marketListBlacklist: Array.isArray((raw as { marketListBlacklist?: unknown }).marketListBlacklist)
      ? ((raw as { marketListBlacklist: unknown[] }).marketListBlacklist || []).filter(
          (x): x is string => typeof x === 'string',
        )
      : base.marketListBlacklist,
    marketStaleMargin:
      typeof (raw as { marketStaleMargin?: number }).marketStaleMargin === 'number' &&
      Number.isFinite((raw as { marketStaleMargin: number }).marketStaleMargin)
        ? Math.max(0, Math.floor((raw as { marketStaleMargin: number }).marketStaleMargin))
        : base.marketStaleMargin,
    marketMinPrices: Array.isArray((raw as { marketMinPrices?: unknown }).marketMinPrices)
      ? (
          (raw as { marketMinPrices: Array<{ name?: string; minPlatinum?: number }> })
            .marketMinPrices || []
        )
          .filter((t) => t && typeof t.name === 'string' && t.name.trim())
          .map((t) => ({
            name: String(t.name).trim(),
            minPlatinum: Math.max(1, Math.floor(Number(t.minPlatinum) || 1)),
          }))
      : base.marketMinPrices,
    marketBuyAlertEnabled:
      typeof (raw as { marketBuyAlertEnabled?: boolean }).marketBuyAlertEnabled === 'boolean'
        ? (raw as { marketBuyAlertEnabled: boolean }).marketBuyAlertEnabled
        : base.marketBuyAlertEnabled,
    marketRivenStock: Array.isArray((raw as { marketRivenStock?: unknown }).marketRivenStock)
      ? (
          (raw as {
            marketRivenStock: Array<{
              id?: string
              weapon?: string
              minPlatinum?: number
              polarity?: string
              note?: string
              addedAt?: string
            }>
          }).marketRivenStock || []
        )
          .filter((t) => t && typeof t.weapon === 'string' && t.weapon.trim())
          .map((t) => ({
            id: String(t.id || `${t.weapon}-${t.addedAt || Date.now()}`),
            weapon: String(t.weapon).trim(),
            minPlatinum: Math.max(1, Math.floor(Number(t.minPlatinum) || 1)),
            polarity: typeof t.polarity === 'string' ? t.polarity : undefined,
            note: typeof t.note === 'string' ? t.note : undefined,
            addedAt: typeof t.addedAt === 'string' ? t.addedAt : new Date().toISOString(),
          }))
      : base.marketRivenStock,
    marketFlipMinSpread:
      typeof (raw as { marketFlipMinSpread?: number }).marketFlipMinSpread === 'number' &&
      Number.isFinite((raw as { marketFlipMinSpread: number }).marketFlipMinSpread)
        ? Math.max(1, Math.floor((raw as { marketFlipMinSpread: number }).marketFlipMinSpread))
        : base.marketFlipMinSpread,
    lfgApiBaseUrl: (() => {
      const rawUrl = (raw as { lfgApiBaseUrl?: string }).lfgApiBaseUrl
      if (typeof rawUrl !== 'string') return base.lfgApiBaseUrl
      const trimmed = rawUrl.trim().replace(/\/+$/, '')
      if (!trimmed) return base.lfgApiBaseUrl
      if (trimmed.toLowerCase() === 'local') return 'local'
      return trimmed
    })(),
    lfgIgn:
      typeof (raw as { lfgIgn?: string }).lfgIgn === 'string'
        ? String((raw as { lfgIgn: string }).lfgIgn).trim().slice(0, 24)
        : base.lfgIgn,
    lfgPlatform: (() => {
      const p = (raw as { lfgPlatform?: string }).lfgPlatform
      if (p === 'pc' || p === 'psn' || p === 'xbox' || p === 'switch' || p === 'mobile') return p
      return base.lfgPlatform
    })(),
    lfgRegion: (() => {
      const r = (raw as { lfgRegion?: string }).lfgRegion
      if (r === 'na' || r === 'eu' || r === 'asia' || r === 'sa' || r === 'oce') return r
      return base.lfgRegion
    })(),
    lfgLanguage:
      typeof (raw as { lfgLanguage?: string }).lfgLanguage === 'string' &&
      (raw as { lfgLanguage: string }).lfgLanguage.trim()
        ? String((raw as { lfgLanguage: string }).lfgLanguage).trim().slice(0, 8)
        : base.lfgLanguage,
    lfgClientId:
      typeof (raw as { lfgClientId?: string }).lfgClientId === 'string' &&
      (raw as { lfgClientId: string }).lfgClientId.trim()
        ? String((raw as { lfgClientId: string }).lfgClientId).trim()
        : base.lfgClientId,
    lfgHostTokens:
      raw &&
      typeof (raw as { lfgHostTokens?: unknown }).lfgHostTokens === 'object' &&
      (raw as { lfgHostTokens: object }).lfgHostTokens &&
      !Array.isArray((raw as { lfgHostTokens: unknown }).lfgHostTokens)
        ? Object.fromEntries(
            Object.entries(
              (raw as { lfgHostTokens: Record<string, unknown> }).lfgHostTokens,
            ).filter(([, v]) => typeof v === 'string') as Array<[string, string]>,
          )
        : base.lfgHostTokens,
    widgetServerEnabled: raw.widgetServerEnabled ?? base.widgetServerEnabled,
    widgetServerPort:
      typeof raw.widgetServerPort === 'number' &&
      Number.isFinite(raw.widgetServerPort) &&
      raw.widgetServerPort > 0 &&
      raw.widgetServerPort < 65536
        ? Math.floor(raw.widgetServerPort)
        : base.widgetServerPort,
    quietMode: raw.quietMode ?? base.quietMode,
    quietFocusActive:
      typeof (raw as { quietFocusActive?: boolean }).quietFocusActive === 'boolean'
        ? (raw as { quietFocusActive: boolean }).quietFocusActive
        : base.quietFocusActive,
    quietFocusModulesBackup:
      (raw as { quietFocusModulesBackup?: AppSettings['quietFocusModulesBackup'] })
        .quietFocusModulesBackup ?? base.quietFocusModulesBackup,
    gamePerformanceMode:
      typeof (raw as { gamePerformanceMode?: boolean }).gamePerformanceMode === 'boolean'
        ? (raw as { gamePerformanceMode: boolean }).gamePerformanceMode
        : base.gamePerformanceMode,
    ocrPoolSize:
      (raw as { ocrPoolSize?: number }).ocrPoolSize === 2 ? 2 : 1,
    overlayTightBounds:
      typeof (raw as { overlayTightBounds?: boolean }).overlayTightBounds === 'boolean'
        ? (raw as { overlayTightBounds: boolean }).overlayTightBounds
        : base.overlayTightBounds,
    navCollapsed: raw.navCollapsed ?? base.navCollapsed,
    overlayOnlyInWarframe:
      typeof (raw as { overlayOnlyInWarframe?: boolean }).overlayOnlyInWarframe === 'boolean'
        ? (raw as { overlayOnlyInWarframe: boolean }).overlayOnlyInWarframe
        : base.overlayOnlyInWarframe,
    inventoryAutoSync: raw.inventoryAutoSync ?? base.inventoryAutoSync,
    inventoryRemindWhenRunning:
      typeof (raw as { inventoryRemindWhenRunning?: boolean }).inventoryRemindWhenRunning ===
      'boolean'
        ? (raw as { inventoryRemindWhenRunning: boolean }).inventoryRemindWhenRunning
        : base.inventoryRemindWhenRunning,
    baroArrivalNotify:
      typeof (raw as { baroArrivalNotify?: boolean }).baroArrivalNotify === 'boolean'
        ? (raw as { baroArrivalNotify: boolean }).baroArrivalNotify
        : base.baroArrivalNotify,
    baroArrivalNotifiedKey:
      typeof (raw as { baroArrivalNotifiedKey?: string }).baroArrivalNotifiedKey === 'string'
        ? (raw as { baroArrivalNotifiedKey: string }).baroArrivalNotifiedKey
        : base.baroArrivalNotifiedKey,
    sessionGoals: Array.isArray((raw as { sessionGoals?: unknown }).sessionGoals)
      ? (
          (raw as {
            sessionGoals: Array<{
              id?: string
              kind?: string
              target?: number
              matchName?: string
              label?: string
            }>
          }).sessionGoals || []
        )
          .filter(
            (g) =>
              g &&
              typeof g.id === 'string' &&
              (g.kind === 'relic_scans' ||
                g.kind === 'needed_parts' ||
                g.kind === 'plat_seen' ||
                g.kind === 'inventory_item') &&
              typeof g.target === 'number' &&
              Number.isFinite(g.target),
          )
          .map((g) => ({
            id: String(g.id),
            kind: g.kind as AppSettings['sessionGoals'][number]['kind'],
            target: Math.max(1, Math.floor(Number(g.target) || 1)),
            matchName:
              typeof g.matchName === 'string' && g.matchName.trim()
                ? g.matchName.trim()
                : undefined,
            label: typeof g.label === 'string' && g.label.trim() ? g.label.trim() : undefined,
          }))
      : base.sessionGoals,
    marketSessionGuideDismissed:
      typeof (raw as { marketSessionGuideDismissed?: boolean }).marketSessionGuideDismissed ===
      'boolean'
        ? (raw as { marketSessionGuideDismissed: boolean }).marketSessionGuideDismissed
        : base.marketSessionGuideDismissed,
    lastSeenVersion: raw.lastSeenVersion ?? base.lastSeenVersion,
    onboarding: {
      ...base.onboarding,
      ...(raw.onboarding ?? {}),
      // New celebration flags: don't spam existing installs that already synced / used market.
      firstInventorySyncAck:
        typeof (raw.onboarding as { firstInventorySyncAck?: boolean } | undefined)
          ?.firstInventorySyncAck === 'boolean'
          ? Boolean(
              (raw.onboarding as { firstInventorySyncAck: boolean }).firstInventorySyncAck,
            )
          : Boolean(raw.inventoryLastSynced || raw.onboarding?.inventoryTouched),
      firstMarketListAck:
        typeof (raw.onboarding as { firstMarketListAck?: boolean } | undefined)
          ?.firstMarketListAck === 'boolean'
          ? Boolean((raw.onboarding as { firstMarketListAck: boolean }).firstMarketListAck)
          : true,
    },
  }
}

export function loadSettings(): AppSettings {
  if (cache) return cache
  try {
    const file = settingsPath()
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<AppSettings>
      cache = mergeSettings(parsed)
      return cache
    }
  } catch (err) {
    console.error('Failed to load settings', err)
  }
  cache = structuredClone(DEFAULT_SETTINGS)
  return cache
}

export function saveSettings(next: AppSettings): AppSettings {
  cache = next
  try {
    fs.mkdirSync(path.dirname(settingsPath()), { recursive: true })
    fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8')
  } catch (err) {
    const code = err && typeof err === 'object' && 'code' in err ? String((err as { code: unknown }).code) : ''
    console.error(
      `[Everything Warframe] Failed to save settings to ${settingsPath()}` +
        (code ? ` (${code})` : ''),
      err,
    )
    if (code === 'EROFS' || code === 'EACCES') {
      console.error(
        '[Everything Warframe] Settings path is not writable. On Linux AppImage, data must live under ~/.local/share — not inside the .AppImage mount.',
      )
    }
  }
  return cache
}

export function updateSettings(partial: Partial<AppSettings>): AppSettings {
  const current = loadSettings()
  const next = mergeSettings({
    ...current,
    ...partial,
    modules: { ...current.modules, ...(partial.modules ?? {}) },
    panelAnchors: { ...current.panelAnchors, ...(partial.panelAnchors ?? {}) },
    moduleOpacity: { ...current.moduleOpacity, ...(partial.moduleOpacity ?? {}) },
    relicRecommend: {
      ...current.relicRecommend,
      ...(partial.relicRecommend ?? {}),
    },
    ocrScanRegions: mergeOcrScanRegions(
      {
        ...current.ocrScanRegions,
        ...(partial.ocrScanRegions ?? {}),
      },
      current.ocrScanRegions,
    ),
    customPalette: {
      ...current.customPalette,
      ...(partial.customPalette ?? {}),
    },
    hotkeys: { ...current.hotkeys, ...(partial.hotkeys ?? {}) },
    onboarding: {
      ...current.onboarding,
      ...(partial.onboarding ?? {}),
    },
  })
  return saveSettings(next)
}

export function setModuleEnabled(id: ModuleId, enabled: boolean): AppSettings {
  const current = loadSettings()
  return updateSettings({
    modules: { ...current.modules, [id]: enabled },
  })
}
