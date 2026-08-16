import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  COLOR_THEME_META,
  ColorThemeId,
  CustomPalette,
  DisplayChoice,
  DisplayRemountPrompt,
  HotkeyRegistration,
  MODULE_META,
  ModuleId,
  OVERLAY_MODULE_IDS,
  PRESET_PALETTE_SEEDS,
  PresetColorThemeId,
  WF_THEME_OPTIONS,
  WfThemeId,
} from '../../../shared/types'
import { customSwatches, seedFromPreset, themeIdsByMode } from '../../lib/theme'
import { useColorTheme } from '../../hooks/useColorTheme'
import { Panel } from '../../components/Panel'
import { ToggleRow } from '../../components/ToggleRow'
import { InventorySettings } from '../../components/InventorySettings'
import { UpdateSettings } from '../../components/UpdateSettings'
import { EconomyTrendPanel } from '../../components/EconomyTrendPanel'
import { GettingStarted } from '../../components/GettingStarted'
import { AppTour, TourStep } from '../../components/AppTour'
import { StatusStrip } from '../../components/StatusStrip'
import { TodaySummary } from '../../components/TodaySummary'
import { WeeklyResetCard } from '../../components/WeeklyResetCard'
import { BaroBuyAdvisorCard } from '../../components/BaroBuyAdvisorCard'
import { SessionGoalsCard } from '../../components/SessionGoalsCard'
import { CircuitTrackerPanel } from '../../modules/circuit/CircuitTrackerPanel'
import { HotkeySheet } from '../../components/HotkeySheet'
import { HotkeyInput } from '../../components/HotkeyInput'
import { HelpPage } from '../../components/HelpPage'
import { WhatsNew } from '../../components/WhatsNew'
import { NowProvider } from '../../hooks/NowContext'
import { useInventory } from '../../hooks/useInventory'
import { useRelicScan } from '../../hooks/useRelicScan'
import { useRivenScan } from '../../hooks/useRivenScan'
import { useSettings, useWorldstate } from '../../hooks/useVoidLens'
import { PLAY_PROFILES, PlayProfileId, applyPlayProfile } from '../../lib/playProfiles'
import { CyclesPanel } from '../../modules/cycles/CyclesPanel'
import { FissuresPanel } from '../../modules/fissures/FissuresPanel'
import { BaroPanel } from '../../modules/baro/BaroPanel'
import { NightwavePanel } from '../../modules/nightwave/NightwavePanel'
import { RelicsPanel } from '../../modules/relics/RelicsPanel'
import { RelicRecommendPanel } from '../../modules/relicRecommend/RelicRecommendPanel'
import { ArbitrationPanel } from '../../modules/arbitration/ArbitrationPanel'
import { InvasionsPanel } from '../../modules/invasions/InvasionsPanel'
import { ArchonPanel } from '../../modules/archon/ArchonPanel'
import { DeepArchimedeaPanel } from '../../modules/deepArchimedea/DeepArchimedeaPanel'
import { RivenPanel } from '../../modules/rivens/RivenPanel'
import { FoundryPage } from '../../modules/foundry/FoundryPage'
import { MarketPage } from '../../modules/market/MarketPage'
import { LfgPage, type LfgPrefill } from '../../modules/lfg/LfgPage'
import { RelicPlannerPage } from '../../modules/relicPlanner/RelicPlannerPage'
import { MasteryPage } from '../../modules/mastery/MasteryPage'
import { LoadoutPage } from '../../modules/loadout/LoadoutPage'
import { ArbitrationLogPanel } from '../../modules/arbitrationLog/ArbitrationLogPanel'
import { InventoryPage } from '../../modules/inventory/InventoryPage'
import { SetsPage } from '../../modules/sets/SetsPage'
import { LinuxCaptureWizard } from '../../components/LinuxCaptureWizard'
import { ToastHost } from '../../components/ToastHost'
import { CommandPalette, CommandAction } from '../../components/CommandPalette'
import {
  PlayProfileSwitcher,
  suggestPlayProfile,
} from '../../components/PlayProfileSwitcher'
import { LinuxHealthCard } from '../../components/LinuxHealthCard'
import { pushToast } from '../../lib/toast'
import { LayoutEditor } from './LayoutEditor'
import { prettyHotkey } from '../../lib/hotkey'
import { playScanSound } from '../../lib/sounds'
import '../../styles/companion.css'
import '../../modules/cycles/module.css'

type Tab =
  | 'dashboard'
  | 'modules'
  | 'foundry'
  | 'sets'
  | 'relicPlanner'
  | 'mastery'
  | 'loadout'
  | 'arbitrationLog'
  | 'inventory'
  | 'market'
  | 'lfg'
  | 'layout'
  | 'settings'
  | 'help'

const TIER_OPTIONS = ['Lith', 'Meso', 'Neo', 'Axi', 'Requiem']

const HOTKEY_LABELS: Record<HotkeyRegistration['id'], string> = {
  toggleOverlay: 'Toggle overlay',
  openCompanion: 'Open companion',
  refreshWorldstate: 'Refresh worldstate',
  scanRelics: 'Scan relic rewards',
  dismissRelics: 'Dismiss relic popup',
  scanRivens: 'Scan riven compare',
  dismissRivens: 'Dismiss riven popup',
  editLayout: 'Move panels (unlock drag)',
  toggleWorldstatePanels: 'Hide / restore worldstate panels',
  toggleQuietFocus: 'Quiet focus (fissures + OCR)',
  toggleModuleCycles: 'Toggle Cycles',
  toggleModuleFissures: 'Toggle Fissures',
  toggleModuleBaro: 'Toggle Baro',
  toggleModuleNightwave: 'Toggle Nightwave',
  toggleModuleArbitration: 'Toggle Arbitration',
  toggleModuleInvasions: 'Toggle Invasions',
  toggleModuleArchon: 'Toggle Archon Hunt',
  toggleModuleDeepArchimedea: 'Toggle Deep Archimedea',
}

const TOUR_STEPS: TourStep[] = [
  {
    target: 'nav-dashboard',
    tab: 'dashboard',
    title: 'Dashboard',
    body: 'Live worldstate for enabled modules. Status chips show overlay, EE.log, and inventory at a glance.',
  },
  {
    target: 'nav-modules',
    tab: 'modules',
    title: 'Modules',
    body: 'Turn panels on or off. Only enabled modules appear in the overlay and on this dashboard.',
  },
  {
    target: 'nav-foundry',
    tab: 'foundry',
    title: 'Foundry',
    body: 'Browse craftable gear, check ready-to-build status, and expand crafting trees against your synced inventory.',
  },
  {
    target: 'nav-market',
    tab: 'market',
    title: 'Market',
    body: 'Track warframe.market platinum for a watchlist, and see prices from your latest relic and riven scans.',
  },
  {
    target: 'nav-layout',
    tab: 'layout',
    title: 'Layout',
    body: 'Drag every panel on the mock monitor — including Relic Rewards and Riven Grader. Try a preset if you want a quick start.',
  },
  {
    target: 'toolbar-hotkeys',
    tab: 'dashboard',
    title: 'Hotkeys',
    body: 'Press ? anytime for the cheat sheet. In-game: toggle overlay, unlock drag, scan relics, and grade rivens.',
  },
  {
    target: 'nav-help',
    tab: 'help',
    title: 'Help',
    body: 'Replay this tour, reopen Getting started, or jump to the website and update notes.',
  },
]

export function CompanionApp() {
  const [tab, setTab] = useState<Tab>('dashboard')
  /** Heavy tabs stay mounted after first visit so revisits don't rebuild from scratch. */
  const [keptTabs, setKeptTabs] = useState<Partial<Record<'relicPlanner' | 'layout' | 'lfg', true>>>({})
  const [tourOpen, setTourOpen] = useState(false)
  const [hotkeysOpen, setHotkeysOpen] = useState(false)
  const [whatsNewOpen, setWhatsNewOpen] = useState(false)
  const [helpScrollTo, setHelpScrollTo] = useState<string | null>(null)
  const [appVersion, setAppVersion] = useState('')
  const [hotkeyStatus, setHotkeyStatus] = useState<HotkeyRegistration[]>([])
  const [overlayCue, setOverlayCue] = useState<'on' | 'off' | null>(null)
  const [displays, setDisplays] = useState<DisplayChoice[]>([])
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [suggestDismissed, setSuggestDismissed] = useState<string | null>(null)
  const [showLinuxWizard, setShowLinuxWizard] = useState(false)
  const [lfgPrefill, setLfgPrefill] = useState<LfgPrefill | null>(null)
  const [setsSearchPrefill, setSetsSearchPrefill] = useState<string | null>(null)
  const [foundrySearchPrefill, setFoundrySearchPrefill] = useState<string | null>(null)
  const [marketFocusItem, setMarketFocusItem] = useState<string | null>(null)
  const [displayRemount, setDisplayRemount] = useState<DisplayRemountPrompt | null>(null)
  const { settings, ready, updateSettings, setModuleEnabled } = useSettings()
  const { data, loading, error, refresh } = useWorldstate()
  const { status: inventory, progress: inventoryProgress } = useInventory()
  const { state: relicScan, ackCelebration } = useRelicScan()
  const { state: rivenScan } = useRivenScan()
  useColorTheme(settings.colorTheme, settings.customPalette)
  const [playerDucats, setPlayerDucats] = useState<number | null>(null)
  const [playerCredits, setPlayerCredits] = useState<number | null>(null)
  const [dumpableDucats, setDumpableDucats] = useState<number | null>(null)

  useEffect(() => {
    if (!window.voidlens?.getInventoryIndex || !inventory.loaded) {
      setPlayerDucats(null)
      setPlayerCredits(null)
      setDumpableDucats(null)
      return
    }
    void window.voidlens.getInventoryIndex().then((index) => {
      setPlayerCredits(typeof index.RegularCredits === 'number' ? index.RegularCredits : null)
      setPlayerDucats(typeof index.Ducats === 'number' ? index.Ducats : null)
    })
    void window.voidlens.browseInventory?.({ sellableOnly: true, enrichPrices: true, sort: 'ducats', limit: 200 }).then(
      (rows) => {
        let sum = 0
        for (const r of rows) {
          if (r.ducats != null && r.excess > 0) sum += r.ducats * r.excess
        }
        setDumpableDucats(sum)
      },
    )
  }, [inventory.loaded, inventory.revision])

  const updateCustomPalette = (partial: Partial<CustomPalette>) => {
    void updateSettings({
      colorTheme: 'custom',
      customPalette: { ...settings.customPalette, ...partial },
    })
  }

  const enabledIds = useMemo(
    () => (Object.keys(settings.modules) as ModuleId[]).filter((id) => settings.modules[id]),
    [settings.modules],
  )

  const showWorldstateBanner = Boolean(data.stale || data.error || error)
  const worldstateBannerMessage = error
    ? `Worldstate error: ${error}`
    : data.error
      ? `Worldstate error: ${data.error}`
      : data.stale
        ? 'Worldstate data is stale — refresh to fetch the latest.'
        : null

  const patchOnboarding = useCallback(
    (partial: Partial<typeof settings.onboarding>) => {
      void updateSettings({
        onboarding: { ...settings.onboarding, ...partial },
      })
    },
    [settings.onboarding, updateSettings],
  )

  const goTab = useCallback(
    (next: Tab) => {
      setTab(next)
      if (next === 'relicPlanner' || next === 'layout' || next === 'lfg') {
        setKeptTabs((prev) => (prev[next] ? prev : { ...prev, [next]: true }))
      }
      if (next === 'layout' && !settings.onboarding.layoutVisited) {
        patchOnboarding({ layoutVisited: true })
      }
      if (next === 'modules' && !settings.onboarding.modulesTouched) {
        patchOnboarding({ modulesTouched: true })
      }
    },
    [settings.onboarding, patchOnboarding],
  )

  const syncInventoryNow = useCallback(async () => {
    if (!window.voidlens?.syncInventoryFromGame) return
    pushToast('Syncing inventory…', 'info', 2500)
    const res = await window.voidlens.syncInventoryFromGame()
    if (res.ok) {
      const gains = [
        ...(res.diff?.added || []),
        ...(res.diff?.changed || []).filter((c) => c.delta > 0),
      ]
        .slice(0, 3)
        .map((e) => `+${e.delta} ${e.displayName}`)
      pushToast(gains.length ? `Synced · ${gains.join(', ')}` : 'Inventory synced', 'ok', 6500)
      if (!settings.onboarding.inventoryTouched) {
        patchOnboarding({ inventoryTouched: true })
      }
    } else {
      pushToast(res.error || 'Inventory sync failed', 'error', 7000)
    }
  }, [settings.onboarding.inventoryTouched, patchOnboarding])

  const handleRelicDeepLink = useCallback(
    (target: 'sets' | 'foundry' | 'market' | 'lfg', query: string) => {
      const q = query.trim()
      if (!q) return
      if (target === 'sets') {
        setSetsSearchPrefill(q)
        goTab('sets')
        pushToast(`Sets · “${q}”`, 'info', 3500)
      } else if (target === 'foundry') {
        setFoundrySearchPrefill(q)
        goTab('foundry')
        pushToast(`Foundry · “${q}”`, 'info', 3500)
      } else if (target === 'market') {
        setMarketFocusItem(q)
        goTab('market')
        pushToast(`Market watchlist · “${q}”`, 'ok', 3500)
      } else {
        setLfgPrefill({
          relicKey: q,
          title: `${q} radshare`,
          shareType: 'radshare',
          activity: 'relic',
        })
        goTab('lfg')
        pushToast(`LFG form ready for “${q}”`, 'ok', 4500)
      }
    },
    [goTab],
  )

  const profileSuggest = useMemo(() => {
    const hit = suggestPlayProfile({
      relicActive: relicScan.active,
      rivenActive: rivenScan.active,
      baroActive: Boolean(data.baro?.active),
      inventory,
      data,
    })
    if (!hit) return null
    if (suggestDismissed === hit.id) return null
    return hit
  }, [relicScan.active, rivenScan.active, data, inventory, suggestDismissed])

  const commandActions = useMemo((): CommandAction[] => {
    const tabs: Array<{ id: Tab; label: string }> = [
      { id: 'dashboard', label: 'Dashboard' },
      { id: 'modules', label: 'Modules' },
      { id: 'foundry', label: 'Foundry' },
      { id: 'sets', label: 'Sets' },
      { id: 'relicPlanner', label: 'Relic Planner' },
      { id: 'mastery', label: 'Mastery' },
      { id: 'loadout', label: 'Loadout coaching' },
      { id: 'arbitrationLog', label: 'Arbitration haul' },
      { id: 'inventory', label: 'Inventory' },
      { id: 'market', label: 'Market' },
      { id: 'lfg', label: 'LFG' },
      { id: 'layout', label: 'Layout' },
      { id: 'settings', label: 'Settings' },
      { id: 'help', label: 'Help' },
    ]
    const actions: CommandAction[] = tabs.map((t) => ({
      id: `tab-${t.id}`,
      label: t.label,
      group: 'Navigate',
      keywords: 'tab page go',
      run: () => goTab(t.id),
    }))
    actions.push(
      {
        id: 'act-refresh',
        label: 'Refresh worldstate',
        group: 'Actions',
        run: () => void refresh(),
      },
      {
        id: 'act-overlay',
        label: 'Toggle overlay',
        group: 'Actions',
        run: () => void window.voidlens?.toggleOverlay(),
      },
      {
        id: 'act-sync',
        label: 'Sync inventory',
        group: 'Actions',
        keywords: 'gruzzle helper',
        run: () => void syncInventoryNow(),
      },
      {
        id: 'act-scan-relic',
        label: 'Scan relic rewards',
        group: 'Actions',
        run: () => void window.voidlens?.scanRelicRewards(),
      },
      {
        id: 'act-hotkeys',
        label: 'Hotkey cheat sheet',
        group: 'Help',
        run: () => setHotkeysOpen(true),
      },
    )
    for (const profile of PLAY_PROFILES) {
      actions.push({
        id: `profile-${profile.id}`,
        label: `Profile: ${profile.label}`,
        group: 'Profiles',
        hint: profile.description,
        run: () => void updateSettings(applyPlayProfile(settings, profile.id as PlayProfileId)),
      })
    }
    return actions
  }, [goTab, refresh, syncInventoryNow, settings, updateSettings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    if (!settings.inventoryRemindWhenRunning) return
    if (!inventory?.consent || !inventory.stale || !inventory.warframeRunning) return
    const key = `inv-stale-${inventory.lastSynced || 'never'}`
    if (sessionStorage.getItem(key)) return
    sessionStorage.setItem(key, '1')
    pushToast('Inventory stale while Warframe is running — click Sync on the status chip', 'warn', 8000)
  }, [
    settings.inventoryRemindWhenRunning,
    inventory?.consent,
    inventory?.stale,
    inventory?.warframeRunning,
    inventory?.lastSynced,
  ])

  const toggleBaroWish = useCallback(
    (item: string) => {
      const lower = item.toLowerCase()
      const existing = settings.baroWishlist.find(
        (w) => lower.includes(w.toLowerCase()) || w.toLowerCase().includes(lower),
      )
      const next = existing
        ? settings.baroWishlist.filter((w) => w !== existing)
        : [...settings.baroWishlist, item]
      void updateSettings({ baroWishlist: next })
    },
    [settings.baroWishlist, updateSettings],
  )

  const toggleNightwaveDone = useCallback(
    (id: string) => {
      const next = settings.nightwaveDoneIds.includes(id)
        ? settings.nightwaveDoneIds.filter((x) => x !== id)
        : [...settings.nightwaveDoneIds, id]
      void updateSettings({ nightwaveDoneIds: next })
    },
    [settings.nightwaveDoneIds, updateSettings],
  )

  const dismissWhatsNew = useCallback(() => {
    setWhatsNewOpen(false)
    if (appVersion) {
      void updateSettings({ lastSeenVersion: appVersion })
    }
  }, [appVersion, updateSettings])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return
      if (e.key === '?' || (e.key === '/' && e.shiftKey)) {
        e.preventDefault()
        setHotkeysOpen(true)
      }
      if (e.key === 'Escape') {
        setHotkeysOpen(false)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const boot = async () => {
      if (!window.voidlens?.getHotkeyStatus) return
      setHotkeyStatus(await window.voidlens.getHotkeyStatus())
    }
    void boot()
    const unsub = window.voidlens?.onHotkeyStatus?.((status) => setHotkeyStatus(status))
    return () => unsub?.()
  }, [settings.hotkeys])

  useEffect(() => {
    const boot = async () => {
      if (!window.voidlens?.listDisplays) return
      setDisplays(await window.voidlens.listDisplays())
    }
    void boot()
  }, [])

  useEffect(() => {
    if (!window.voidlens?.onDisplayRemount) return
    return window.voidlens.onDisplayRemount((prompt) => {
      setDisplays(prompt.displays)
      setDisplayRemount(prompt)
      pushToast('OCR monitor remapped — pick Warframe’s screen', 'warn', 8000)
      goTab('settings')
    })
  }, [goTab])

  useEffect(() => {
    if (!window.voidlens?.onCompanionNavigate) return
    return window.voidlens.onCompanionNavigate((next) => {
      const allowed: Tab[] = [
        'dashboard',
        'modules',
        'foundry',
        'sets',
        'relicPlanner',
        'mastery',
        'loadout',
        'arbitrationLog',
        'inventory',
        'market',
        'lfg',
        'layout',
        'settings',
        'help',
      ]
      if (allowed.includes(next as Tab)) goTab(next as Tab)
    })
  }, [goTab])

  useEffect(() => {
    if (!settings.eeLogPath?.trim() || settings.onboarding.eeLogAck) return
    patchOnboarding({ eeLogAck: true })
  }, [settings.eeLogPath, settings.onboarding.eeLogAck, patchOnboarding])

  useEffect(() => {
    if (!ready) return
    const boot = async () => {
      if (!window.voidlens?.getAppVersion) return
      const version = await window.voidlens.getAppVersion()
      setAppVersion(version)
      if (version && version !== settings.lastSeenVersion) {
        setWhatsNewOpen(true)
      }
    }
    void boot()
  }, [ready, settings.lastSeenVersion])

  useEffect(() => {
    if (!window.voidlens?.onRelicSound) return
    return window.voidlens.onRelicSound(() => playScanSound('relic', settings.soundPack))
  }, [settings.soundPack])

  useEffect(() => {
    if (!window.voidlens?.onRivenSound) return
    return window.voidlens.onRivenSound(() => playScanSound('riven', settings.soundPack))
  }, [settings.soundPack])

  useEffect(() => {
    const unsub = window.voidlens?.onOverlayVisibilityChanged((visible) => {
      setOverlayCue(visible ? 'on' : 'off')
      window.setTimeout(() => setOverlayCue(null), 1600)
    })
    return () => unsub?.()
  }, [])

  if (!ready) {
    return (
      <div className="companion-root companion-main">
        <div className="brand-lockup">
          <div className="brand-mark" aria-hidden />
          <h1 className="brand">Everything Warframe</h1>
        </div>
        <p className="muted">Calibrating companion…</p>
      </div>
    )
  }

  return (
    <NowProvider active intervalMs={2000}>
      <div className="companion-root">
        {overlayCue ? (
          <div
            className={`companion-overlay-cue ${overlayCue === 'off' ? 'is-off' : ''}`}
            role="status"
          >
            Overlay {overlayCue === 'on' ? 'ON' : 'OFF'}
          </div>
        ) : null}
        {displayRemount && tab !== 'settings' ? (
          <div className="companion-remount" role="dialog" aria-modal="true">
            <div className="companion-remount__card">
              <h2 className="companion-remount__title">Which screen is Warframe on?</h2>
              <p className="muted">
                Your saved OCR monitor (id {displayRemount.previousId}) disappeared after a display
                remount. Pick the screen that shows the game.
              </p>
              <div className="companion-remount__actions">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => {
                    void updateSettings({ ocrDisplayId: null }).then(() => {
                      setDisplayRemount(null)
                      pushToast('OCR monitor set to primary', 'ok')
                    })
                  }}
                >
                  Use primary
                </button>
                {(displayRemount.displays.length ? displayRemount.displays : displays).map((d) => (
                  <button
                    key={d.id}
                    type="button"
                    className="btn primary"
                    onClick={() => {
                      void updateSettings({ ocrDisplayId: d.id }).then(() => {
                        setDisplayRemount(null)
                        pushToast(`OCR monitor → ${d.label}`, 'ok')
                      })
                    }}
                  >
                    {d.label}
                    {d.isPrimary ? ' · primary' : ''}
                  </button>
                ))}
                <button type="button" className="btn ghost" onClick={() => goTab('settings')}>
                  Open Settings
                </button>
              </div>
            </div>
          </div>
        ) : null}
        <div className={`companion-shell${settings.navCollapsed ? ' is-nav-collapsed' : ''}`}>
          <aside className={`companion-nav${settings.navCollapsed ? ' is-collapsed' : ''}`}>
            <div className="brand-lockup">
              <div className="brand-mark" aria-hidden />
              <div className="brand-lockup__text">
                <h1 className="brand">Everything Warframe</h1>
              </div>
            </div>
            <p className="brand-sub">Cycles, relics, Baro, inventory — one overlay.</p>
            <div className="nav-section">Play</div>
            <button
              className={`nav-btn ${tab === 'dashboard' ? 'active' : ''}`}
              data-tour="nav-dashboard"
              title="Live worldstate and getting started"
              onClick={() => goTab('dashboard')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2" y="2" width="5" height="5" rx="1" />
                  <rect x="9" y="2" width="5" height="5" rx="1" />
                  <rect x="2" y="9" width="5" height="5" rx="1" />
                  <rect x="9" y="9" width="5" height="5" rx="1" />
                </svg>
              </span>
              Dashboard
            </button>
            <button
              className={`nav-btn ${tab === 'modules' ? 'active' : ''}`}
              data-tour="nav-modules"
              title="Choose which overlay panels are enabled"
              onClick={() => goTab('modules')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 4.5h10M3 8h10M3 11.5h7" strokeLinecap="round" />
                </svg>
              </span>
              Modules
            </button>
            <div className="nav-section">Tools</div>
            <button
              className={`nav-btn ${tab === 'foundry' ? 'active' : ''}`}
              data-tour="nav-foundry"
              title="Crafting trees and build readiness"
              onClick={() => goTab('foundry')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M4 13V7l4-4 4 4v6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6.5 13v-3h3v3" strokeLinecap="round" />
                </svg>
              </span>
              Foundry
            </button>
            <button
              className={`nav-btn ${tab === 'sets' ? 'active' : ''}`}
              title="Prime set completion hub"
              onClick={() => goTab('sets')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="5.5" />
                  <path d="M8 4.5v7M5 8h6" strokeLinecap="round" />
                </svg>
              </span>
              Sets
            </button>
            <button
              className={`nav-btn ${tab === 'relicPlanner' ? 'active' : ''}`}
              title="Rank relics by missing parts and platinum"
              onClick={() => goTab('relicPlanner')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 2.5 13 5v6l-5 2.5L3 11V5l5-2.5Z" strokeLinejoin="round" />
                </svg>
              </span>
              Relics
            </button>
            <button
              className={`nav-btn ${tab === 'mastery' ? 'active' : ''}`}
              title="Next mastery / craft targets"
              onClick={() => goTab('mastery')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M8 2.5v11M4.5 5.5 8 2.5l3.5 3" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </span>
              Mastery
            </button>
            <button
              className={`nav-btn ${tab === 'loadout' ? 'active' : ''}`}
              title="Owned gear Forma / rank coaching"
              onClick={() => goTab('loadout')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 11.5 8 3.5l5 8H3Z" strokeLinejoin="round" />
                  <path d="M5.5 9.5h5" strokeLinecap="round" />
                </svg>
              </span>
              Loadout
            </button>
            <button
              className={`nav-btn ${tab === 'arbitrationLog' ? 'active' : ''}`}
              title="Arbitration rare haul this session"
              onClick={() => goTab('arbitrationLog')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="5.5" />
                  <path d="M8 5v3.2l2 1.2" strokeLinecap="round" />
                </svg>
              </span>
              Arb haul
            </button>
            <button
              className={`nav-btn ${tab === 'inventory' ? 'active' : ''}`}
              title="Browse synced inventory counts"
              onClick={() => goTab('inventory')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="3" y="3.5" width="10" height="9" rx="1.5" />
                  <path d="M5.5 6.5h5M5.5 9h3.5" strokeLinecap="round" />
                </svg>
              </span>
              Inventory
            </button>
            <button
              className={`nav-btn ${tab === 'market' ? 'active' : ''}`}
              data-tour="nav-market"
              title="warframe.market watchlist and scan prices"
              onClick={() => goTab('market')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M3 12.5V6.5L8 3.5l5 3v6" strokeLinecap="round" strokeLinejoin="round" />
                  <path d="M6 12.5V9h4v3.5" strokeLinecap="round" />
                </svg>
              </span>
              Market
            </button>
            <button
              className={`nav-btn ${tab === 'lfg' ? 'active' : ''}`}
              title="Looking for group — hosted squad board"
              onClick={() => goTab('lfg')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="5.5" cy="6" r="2" />
                  <circle cx="10.5" cy="6" r="2" />
                  <path d="M2.5 12.5c.6-1.8 1.9-2.8 3-2.8s2.4 1 3 2.8" strokeLinecap="round" />
                  <path d="M7.5 12.5c.6-1.8 1.9-2.8 3-2.8s2.4 1 3 2.8" strokeLinecap="round" />
                </svg>
              </span>
              LFG
            </button>
            <button
              className={`nav-btn ${tab === 'layout' ? 'active' : ''}`}
              data-tour="nav-layout"
              title="Drag panels on a mock monitor"
              onClick={() => goTab('layout')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <rect x="2.5" y="3" width="11" height="9" rx="1.5" />
                  <path d="M2.5 6h11" strokeLinecap="round" />
                </svg>
              </span>
              Layout
            </button>
            <div className="nav-section">System</div>
            <button
              className={`nav-btn ${tab === 'settings' ? 'active' : ''}`}
              data-tour="nav-settings"
              title="Appearance, hotkeys, inventory, updates"
              onClick={() => goTab('settings')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="2.2" />
                  <path
                    d="M8 2.5v1.2M8 12.3v1.2M2.5 8h1.2M12.3 8h1.2M4.1 4.1l.85.85M11.05 11.05l.85.85M11.9 4.1l-.85.85M4.95 11.05l-.85.85"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              Settings
            </button>
            <button
              className={`nav-btn ${tab === 'help' ? 'active' : ''}`}
              data-tour="nav-help"
              title="Tour, hotkeys, and FAQ"
              onClick={() => goTab('help')}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <circle cx="8" cy="8" r="5.5" />
                  <path d="M6.4 6.4a1.7 1.7 0 1 1 2.3 1.55c-.5.3-.9.7-.9 1.35" strokeLinecap="round" />
                  <circle cx="8" cy="11.2" r="0.6" fill="currentColor" stroke="none" />
                </svg>
              </span>
              Help
            </button>
            <button
              type="button"
              className="nav-btn nav-collapse-btn"
              title={settings.navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-label={settings.navCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
              aria-expanded={!settings.navCollapsed}
              onClick={() => void updateSettings({ navCollapsed: !settings.navCollapsed })}
            >
              <span className="nav-btn__icon" aria-hidden>
                <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
                  {settings.navCollapsed ? (
                    <>
                      <path d="M6 3l5 5-5 5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M3 3v10" strokeLinecap="round" />
                    </>
                  ) : (
                    <>
                      <path d="M10 3L5 8l5 5" strokeLinecap="round" strokeLinejoin="round" />
                      <path d="M13 3v10" strokeLinecap="round" />
                    </>
                  )}
                </svg>
              </span>
              {settings.navCollapsed ? 'Expand' : 'Collapse'}
            </button>
          </aside>

          <main className="companion-main">
            {tab === 'dashboard' ? (
              <>
                <header className="page-header">
                  <h2 className="page-title">Dashboard</h2>
                  <div className="page-title-rule" />
                  <p className="page-desc">
                    Live worldstate for your enabled modules. Keep Warframe in Borderless Windowed so
                    the overlay can sit above the game.
                  </p>
                </header>

                <GettingStarted
                  settings={settings}
                  inventory={inventory}
                  onUpdate={(partial) => void updateSettings(partial)}
                  onGoModules={() => goTab('modules')}
                  onGoLayout={() => goTab('layout')}
                  onGoInventory={() => {
                    patchOnboarding({ inventoryTouched: true })
                    goTab('inventory')
                  }}
                  onGoSettings={() => goTab('settings')}
                  onStartTour={() => setTourOpen(true)}
                  onDetectEeLog={() => void window.voidlens?.detectEeLogPath?.()}
                  onSyncInventory={() => void syncInventoryNow()}
                />

                {relicScan.celebration && !settings.onboarding.firstRelicSuccessAck ? (
                  <section className="getting-started" style={{ marginBottom: 16 }}>
                    <div className="getting-started__header">
                      <div>
                        <h3 className="getting-started__title">First relic scan worked!</h3>
                        <p className="getting-started__sub">
                          Relic rewards are showing in the overlay. Sync inventory in Settings for
                          needed-part tags.
                        </p>
                      </div>
                      <button className="btn ghost" onClick={() => void ackCelebration()}>
                        Dismiss
                      </button>
                    </div>
                  </section>
                ) : null}

                {inventory.loaded &&
                settings.onboarding.firstInventorySyncAck === false &&
                inventory.revision > 0 ? (
                  <section className="getting-started" style={{ marginBottom: 16 }}>
                    <div className="getting-started__header">
                      <div>
                        <h3 className="getting-started__title">Inventory sync unlocked</h3>
                        <p className="getting-started__sub">
                          Foundry, Sets, and Relic Recommend can now use your owned counts.
                        </p>
                      </div>
                      <button
                        className="btn ghost"
                        onClick={() => patchOnboarding({ firstInventorySyncAck: true })}
                      >
                        Dismiss
                      </button>
                    </div>
                  </section>
                ) : null}

                {showLinuxWizard ||
                (typeof navigator !== 'undefined' &&
                  /linux/i.test(navigator.userAgent) &&
                  !settings.onboarding.linuxCaptureAck) ? (
                  <LinuxCaptureWizard
                    settings={settings}
                    displays={displays}
                    onUpdate={(partial) => {
                      void updateSettings(partial)
                      setShowLinuxWizard(false)
                    }}
                  />
                ) : null}

                <StatusStrip
                  settings={settings}
                  inventory={inventory}
                  inventoryProgress={inventoryProgress}
                  worldstateOk={Boolean(data.fetchedAt) && !error}
                  worldstateStale={data.stale}
                  onToggleOverlay={() => void window.voidlens?.toggleOverlay()}
                  onDetectEeLog={() => void window.voidlens?.detectEeLogPath()}
                  onRefreshWorldstate={() => void refresh()}
                  onGoSettings={() => goTab('settings')}
                  onSyncInventory={() => void syncInventoryNow()}
                />

                <PlayProfileSwitcher
                  settings={settings}
                  suggestedId={profileSuggest?.id ?? null}
                  suggestReason={profileSuggest?.reason}
                  onApply={(partial) => void updateSettings(partial)}
                  onDismissSuggest={() =>
                    setSuggestDismissed(profileSuggest?.id ?? null)
                  }
                />

                <div style={{ marginBottom: 16 }}>
                  <EconomyTrendPanel />
                </div>

                <TodaySummary
                  data={data}
                  settings={settings}
                  inventoryStale={Boolean(inventory.stale)}
                  onNavigate={(t) => goTab(t as Tab)}
                  onSyncInventory={() => void syncInventoryNow()}
                  onApplyBaroProfile={() =>
                    void updateSettings(applyPlayProfile(settings, 'baro-day'))
                  }
                />

                <div style={{ margin: '16px 0' }}>
                  <WeeklyResetCard
                    data={data}
                    settings={settings}
                    onNavigate={(t) => goTab(t as typeof tab)}
                    onToggleNightwaveDone={(id) => toggleNightwaveDone(id)}
                  />
                </div>

                <div className="grid-2" style={{ marginBottom: 16 }}>
                  <CircuitTrackerPanel
                    worldstateKey={data.fetchedAt || ''}
                    onSyncInventory={() => void syncInventoryNow()}
                  />
                  <SessionGoalsCard
                    settings={settings}
                    onUpdate={(partial) => void updateSettings(partial)}
                    onClearHaul={() => void window.voidlens?.clearSessionHaul()}
                  />
                </div>

                <div style={{ marginBottom: 16 }}>
                  <BaroBuyAdvisorCard
                    baro={data.baro}
                    wishlist={settings.baroWishlist}
                    playerDucats={playerDucats}
                    playerCredits={playerCredits}
                    dumpableDucats={dumpableDucats}
                    onToggleWish={toggleBaroWish}
                    onOpenInventory={() => goTab('inventory')}
                  />
                </div>

                <div className="toolbar" data-tour="toolbar-hotkeys">
                  <button className="btn primary" onClick={() => void refresh()}>
                    Refresh worldstate
                  </button>
                  <button className="btn" onClick={() => void window.voidlens?.toggleOverlay()}>
                    Toggle overlay
                  </button>
                  <button className="btn ghost" onClick={() => goTab('layout')}>
                    Edit layout
                  </button>
                  <button
                    className="btn ghost"
                    onClick={() =>
                      void updateSettings({ layoutEditMode: !settings.layoutEditMode })
                    }
                  >
                    {settings.layoutEditMode ? 'Lock panels (in-game)' : 'Move panels (in-game)'}
                  </button>
                  <button className="btn ghost" onClick={() => setHotkeysOpen(true)}>
                    Hotkeys (?)
                  </button>
                  <button className="btn ghost" onClick={() => setPaletteOpen(true)} title="Ctrl+K">
                    Jump…
                  </button>
                  <span className="pill muted">
                    {loading
                      ? 'Updating…'
                      : data.fetchedAt
                        ? `Updated ${new Date(data.fetchedAt).toLocaleTimeString()}`
                        : 'No data yet'}
                  </span>
                </div>

                {showWorldstateBanner && worldstateBannerMessage ? (
                  <section className="getting-started" style={{ marginBottom: 16, padding: '12px 16px' }}>
                    <p className="getting-started__sub" style={{ margin: 0 }}>
                      {worldstateBannerMessage}
                    </p>
                  </section>
                ) : null}

                <Panel
                  title="Seeing FPS / Frame Time?"
                  subtitle="That is not part of Everything Warframe"
                >
                  <p className="muted" style={{ marginTop: 0 }}>
                    Everything Warframe only draws Cycles, Fissures, Baro, etc. An FPS / Frame Time
                    widget is almost always Xbox Game Bar, NVIDIA Overlay, or MSI Afterburner /
                    RTSS.
                  </p>
                </Panel>

                <div className="section-gap" />

                <div className="grid-2">
                  {enabledIds.includes('cycles') ? <CyclesPanel cycles={data.cycles} /> : null}
                  {enabledIds.includes('fissures') ? (
                    <FissuresPanel
                      fissures={data.fissures}
                      tiers={settings.fissureTiers}
                      pathMode={settings.fissurePathMode}
                      showStorms={settings.fissureShowStorms}
                      sort={settings.fissureSort}
                    />
                  ) : null}
                  {enabledIds.includes('baro') ? (
                    <BaroPanel
                      baro={data.baro}
                      wishlist={settings.baroWishlist}
                      onToggleWish={toggleBaroWish}
                      playerDucats={playerDucats}
                      playerCredits={playerCredits}
                      dumpableDucats={dumpableDucats}
                    />
                  ) : null}
                  {enabledIds.includes('nightwave') ? (
                    <NightwavePanel
                      nightwave={data.nightwave}
                      doneIds={settings.nightwaveDoneIds}
                      onToggleDone={toggleNightwaveDone}
                    />
                  ) : null}
                  {enabledIds.includes('relics') ? (
                    <RelicsPanel
                      scanHotkey={prettyHotkey(settings.hotkeys.scanRelics)}
                      dismissHotkey={prettyHotkey(settings.hotkeys.dismissRelics)}
                      onDeepLink={handleRelicDeepLink}
                    />
                  ) : null}
                  {enabledIds.includes('rivens') ? (
                    <RivenPanel
                      scanHotkey={prettyHotkey(settings.hotkeys.scanRivens)}
                      dismissHotkey={prettyHotkey(settings.hotkeys.dismissRivens)}
                    />
                  ) : null}
                  {enabledIds.includes('arbitration') ? (
                    <ArbitrationPanel arbitration={data.arbitration} />
                  ) : null}
                  {enabledIds.includes('invasions') ? (
                    <InvasionsPanel invasions={data.invasions} />
                  ) : null}
                  {enabledIds.includes('archon') ? (
                    <ArchonPanel archonHunt={data.archonHunt} />
                  ) : null}
                  {enabledIds.includes('deepArchimedea') ? (
                    <DeepArchimedeaPanel deepArchimedea={data.deepArchimedea} />
                  ) : null}
                  {enabledIds.includes('relicRecommend') ? (
                    <RelicRecommendPanel
                      onPostLfg={(relicLabel) => {
                        setLfgPrefill({
                          relicKey: relicLabel,
                          title: `${relicLabel} radshare`,
                          shareType: 'radshare',
                          activity: 'relic',
                        })
                        pushToast(`LFG form ready for “${relicLabel}”`, 'ok', 4500)
                        goTab('lfg')
                      }}
                      onSyncInventory={() => void syncInventoryNow()}
                      onOpenSettings={() => goTab('settings')}
                    />
                  ) : null}
                </div>
              </>
            ) : null}

            {tab === 'modules' ? (
              <>
                <header className="page-header">
                  <h2 className="page-title">Modules</h2>
                  <div className="page-title-rule" />
                  <p className="page-desc">
                    Choose what appears in the overlay and dashboard. Foundry, Relic Planner, and
                    Mastery are companion-only. Enable Relic Recommend for the pre-mission overlay
                    list (push filters from Relic Planner → Send to overlay). Relic / riven scanning
                    and inventory tags are live. Assign per-panel hide hotkeys under Settings →
                    Hotkeys, or use{' '}
                    <strong>{prettyHotkey(settings.hotkeys.toggleWorldstatePanels)}</strong> to
                    clear/restore all worldstate panels.
                  </p>
                </header>
                <Panel title="Toggleable modules">
                  {(Object.keys(MODULE_META) as ModuleId[]).map((id) => {
                    const meta = MODULE_META[id]
                    return (
                      <ToggleRow
                        key={id}
                        label={meta.label}
                        description={meta.description}
                        checked={settings.modules[id]}
                        badge={meta.phase > 1 ? `Phase ${meta.phase}` : undefined}
                        onChange={(enabled) => {
                          patchOnboarding({ modulesTouched: true })
                          void setModuleEnabled(id, enabled)
                        }}
                      />
                    )
                  })}
                </Panel>

                <div className="section-gap" />

                <Panel title="Fissure filters" subtitle="Which tiers appear in the fissure module">
                  <div className="toolbar">
                    {TIER_OPTIONS.map((tier) => {
                      const on = settings.fissureTiers.includes(tier)
                      return (
                        <button
                          key={tier}
                          className={`btn ${on ? 'primary' : 'ghost'}`}
                          onClick={() => {
                            if (on && settings.fissureTiers.length <= 1) return
                            const next = on
                              ? settings.fissureTiers.filter((t) => t !== tier)
                              : [...settings.fissureTiers, tier]
                            void updateSettings({ fissureTiers: next })
                          }}
                          title={
                            on && settings.fissureTiers.length <= 1
                              ? 'Keep at least one tier selected'
                              : undefined
                          }
                        >
                          {tier}
                        </button>
                      )
                    })}
                  </div>
                  {settings.fissureTiers.length === 0 ? (
                    <p className="muted" style={{ margin: '8px 0 0', fontSize: '0.78rem' }}>
                      No tiers selected — turn on Lith / Meso / Neo / Axi (and Requiem if you want)
                      or the fissure list stays empty.
                    </p>
                  ) : null}
                  <p className="muted" style={{ margin: '10px 0 6px' }}>
                    Path
                  </p>
                  <div className="toolbar">
                    {(
                      [
                        ['normal', 'Normal'],
                        ['steel', 'Steel Path'],
                        ['both', 'Both'],
                      ] as const
                    ).map(([mode, label]) => (
                      <button
                        key={mode}
                        className={`btn ${settings.fissurePathMode === mode ? 'primary' : 'ghost'}`}
                        onClick={() => void updateSettings({ fissurePathMode: mode })}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <ToggleRow
                    label="Show Railjack / Void Storms"
                    description="Include Railjack Void Storm fissures in the list"
                    checked={settings.fissureShowStorms}
                    onChange={(enabled) => void updateSettings({ fissureShowStorms: enabled })}
                  />
                  <div className="toolbar" style={{ marginTop: 8 }}>
                    <button
                      className={`btn ${settings.fissureSort === 'eta' ? 'primary' : 'ghost'}`}
                      onClick={() => void updateSettings({ fissureSort: 'eta' })}
                    >
                      Sort by ETA
                    </button>
                    <button
                      className={`btn ${settings.fissureSort === 'tier' ? 'primary' : 'ghost'}`}
                      onClick={() => void updateSettings({ fissureSort: 'tier' })}
                    >
                      Sort by Tier
                    </button>
                  </div>
                </Panel>
              </>
            ) : null}

            {tab === 'foundry' ? (
              <FoundryPage
                enabled={settings.modules.foundry}
                onOpenSettings={() => goTab('settings')}
                onSyncInventory={() => void syncInventoryNow()}
                searchPrefill={foundrySearchPrefill}
                onSearchPrefillConsumed={() => setFoundrySearchPrefill(null)}
              />
            ) : null}

            {tab === 'sets' ? (
              <SetsPage
                enabled
                onOpenSettings={() => goTab('settings')}
                onOpenFoundry={() => goTab('foundry')}
                onSyncInventory={() => void syncInventoryNow()}
                searchPrefill={setsSearchPrefill}
                onSearchPrefillConsumed={() => setSetsSearchPrefill(null)}
              />
            ) : null}

            {keptTabs.relicPlanner || tab === 'relicPlanner' ? (
              <div
                className={tab === 'relicPlanner' ? undefined : 'companion-tab-park'}
                aria-hidden={tab !== 'relicPlanner'}
              >
                <RelicPlannerPage
                  enabled={settings.modules.relicPlanner !== false}
                  onOpenSettings={() => goTab('settings')}
                  onOpenFoundry={() => goTab('foundry')}
                />
              </div>
            ) : null}

            {tab === 'mastery' ? (
              <MasteryPage
                enabled={settings.modules.mastery !== false}
                onOpenSettings={() => goTab('settings')}
                onOpenFoundry={() => goTab('foundry')}
              />
            ) : null}

            {tab === 'loadout' ? (
              <LoadoutPage
                onOpenSettings={() => goTab('settings')}
                onSyncInventory={() => void syncInventoryNow()}
              />
            ) : null}

            {tab === 'arbitrationLog' ? (
              <ArbitrationLogPanel onSyncInventory={() => void syncInventoryNow()} />
            ) : null}

            {tab === 'inventory' ? (
              <InventoryPage onOpenSettings={() => goTab('settings')} />
            ) : null}

            {tab === 'market' ? (
              <MarketPage
                settings={settings}
                enabled={settings.modules.market}
                onUpdate={(partial) => void updateSettings(partial)}
                onOpenHelp={() => {
                  setHelpScrollTo('help-wfm-jwt')
                  goTab('help')
                }}
                onOpenSettings={() => goTab('settings')}
                onSyncInventory={() => void syncInventoryNow()}
                onFirstListCelebration={() => {
                  if (!settings.onboarding.firstMarketListAck) {
                    patchOnboarding({ firstMarketListAck: true })
                    pushToast('First market listing — track it in the Log tab.', 'ok', 6000)
                  }
                }}
                focusItem={marketFocusItem}
                onFocusItemConsumed={() => setMarketFocusItem(null)}
              />
            ) : null}

            {keptTabs.lfg || tab === 'lfg' ? (
              <div
                className={tab === 'lfg' ? undefined : 'companion-tab-park'}
                aria-hidden={tab !== 'lfg'}
              >
                <LfgPage
                  settings={settings}
                  active={tab === 'lfg'}
                  prefill={lfgPrefill}
                  onPrefillConsumed={() => setLfgPrefill(null)}
                  onUpdate={(partial) => void updateSettings(partial)}
                />
              </div>
            ) : null}

            {keptTabs.layout || tab === 'layout' ? (
              <div
                className={tab === 'layout' ? undefined : 'companion-tab-park'}
                aria-hidden={tab !== 'layout'}
              >
                <LayoutEditor
                  settingsModules={settings.modules}
                  panelAnchors={settings.panelAnchors}
                  opacity={settings.opacity}
                  moduleOpacity={settings.moduleOpacity}
                  overlayScale={settings.overlayScale}
                  fissureTiers={settings.fissureTiers}
                  fissurePathMode={settings.fissurePathMode}
                  fissureShowStorms={settings.fissureShowStorms}
                  fissureSort={settings.fissureSort}
                  baroWishlist={settings.baroWishlist}
                  nightwaveDoneIds={settings.nightwaveDoneIds}
                  interactionHotkey={prettyHotkey(settings.hotkeys.editLayout)}
                  liveData={data}
                  ocrScanRegions={settings.ocrScanRegions ?? {
                    relicStrip: null,
                    rivenCurrent: null,
                    rivenReroll: null,
                  }}
                  onSaveAnchors={(panelAnchors) => void updateSettings({ panelAnchors })}
                  onSaveOcrScanRegions={(ocrScanRegions) =>
                    void updateSettings({ ocrScanRegions })
                  }
                />
              </div>
            ) : null}

            {tab === 'settings' ? (
              <>
                <header className="page-header">
                  <h2 className="page-title">Settings</h2>
                  <div className="page-title-rule" />
                  <p className="page-desc">
                    Appearance, hotkeys, inventory sync, and updates. Inventory stays local and
                    powers “needed for set” relic tags.
                  </p>
                </header>

                <LinuxHealthCard
                  settings={settings}
                  inventory={inventory}
                  onDetectEeLog={() => void window.voidlens?.detectEeLogPath()}
                  onSyncInventory={() => void syncInventoryNow()}
                  onOpenCaptureWizard={() => setShowLinuxWizard(true)}
                />

                <Panel
                  title="Appearance"
                  subtitle="Theme applies to the companion and overlay panels"
                >
                  <p className="theme-group-label">Dark palettes</p>
                  <div className="theme-grid">
                    {themeIdsByMode('dark').map((id) => {
                      const meta = COLOR_THEME_META[id]
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`theme-card ${settings.colorTheme === id ? 'is-selected' : ''}`}
                          onClick={() => void updateSettings({ colorTheme: id as ColorThemeId })}
                        >
                          <div className="theme-card__swatches" aria-hidden>
                            {meta.swatches.map((c) => (
                              <span key={c} style={{ background: c }} />
                            ))}
                          </div>
                          <div className="theme-card__label">{meta.label}</div>
                          <div className="theme-card__meta">{meta.description}</div>
                        </button>
                      )
                    })}
                  </div>
                  <p className="theme-group-label">Light palettes</p>
                  <div className="theme-grid">
                    {themeIdsByMode('light').map((id) => {
                      const meta = COLOR_THEME_META[id]
                      return (
                        <button
                          key={id}
                          type="button"
                          className={`theme-card ${settings.colorTheme === id ? 'is-selected' : ''}`}
                          onClick={() => void updateSettings({ colorTheme: id as ColorThemeId })}
                        >
                          <div className="theme-card__swatches" aria-hidden>
                            {meta.swatches.map((c) => (
                              <span key={c} style={{ background: c }} />
                            ))}
                          </div>
                          <div className="theme-card__label">{meta.label}</div>
                          <div className="theme-card__meta">{meta.description}</div>
                        </button>
                      )
                    })}
                  </div>
                  <p className="theme-group-label">Custom palette</p>
                  <div className="theme-grid theme-grid--custom">
                    <button
                      type="button"
                      className={`theme-card ${settings.colorTheme === 'custom' ? 'is-selected' : ''}`}
                      onClick={() => void updateSettings({ colorTheme: 'custom' })}
                    >
                      <div className="theme-card__swatches" aria-hidden>
                        {customSwatches(settings.customPalette).map((c) => (
                          <span key={c} style={{ background: c }} />
                        ))}
                      </div>
                      <div className="theme-card__label">{COLOR_THEME_META.custom.label}</div>
                      <div className="theme-card__meta">{COLOR_THEME_META.custom.description}</div>
                    </button>
                  </div>
                  {settings.colorTheme === 'custom' ? (
                    <div className="custom-palette">
                      <div className="custom-palette__toolbar">
                        <div className="field" style={{ margin: 0, minWidth: 160 }}>
                          <label htmlFor="custom-mode">Mode</label>
                          <select
                            id="custom-mode"
                            value={settings.customPalette.mode}
                            onChange={(e) =>
                              updateCustomPalette({
                                mode: e.target.value === 'light' ? 'light' : 'dark',
                              })
                            }
                          >
                            <option value="dark">Dark</option>
                            <option value="light">Light</option>
                          </select>
                        </div>
                        <div className="field" style={{ margin: 0, minWidth: 180 }}>
                          <label htmlFor="custom-start-from">Start from preset</label>
                          <select
                            id="custom-start-from"
                            defaultValue=""
                            onChange={(e) => {
                              const id = e.target.value as PresetColorThemeId | ''
                              if (!id || !(id in PRESET_PALETTE_SEEDS)) return
                              void updateSettings({
                                colorTheme: 'custom',
                                customPalette: seedFromPreset(id),
                              })
                              e.target.value = ''
                            }}
                          >
                            <option value="" disabled>
                              Choose a preset…
                            </option>
                            {(Object.keys(PRESET_PALETTE_SEEDS) as PresetColorThemeId[]).map(
                              (id) => (
                                <option key={id} value={id}>
                                  {COLOR_THEME_META[id].label}
                                </option>
                              ),
                            )}
                          </select>
                        </div>
                      </div>
                      <div className="custom-palette__pickers">
                        {(
                          [
                            ['background', 'Background'],
                            ['text', 'Text'],
                            ['muted', 'Muted text'],
                            ['accentA', 'Accent A'],
                            ['accentB', 'Accent B'],
                          ] as const
                        ).map(([key, label]) => (
                          <label key={key} className="custom-palette__swatch" htmlFor={`custom-${key}`}>
                            <span>{label}</span>
                            <span className="custom-palette__controls">
                              <input
                                id={`custom-${key}`}
                                type="color"
                                value={settings.customPalette[key]}
                                onChange={(e) => updateCustomPalette({ [key]: e.target.value })}
                              />
                              <input
                                key={`${key}-${settings.customPalette[key]}`}
                                type="text"
                                className="custom-palette__hex"
                                defaultValue={settings.customPalette[key]}
                                spellCheck={false}
                                onBlur={(e) => {
                                  const value = e.target.value.trim()
                                  if (/^#[0-9a-fA-F]{6}$/.test(value)) {
                                    updateCustomPalette({ [key]: value.toLowerCase() })
                                  } else {
                                    e.target.value = settings.customPalette[key]
                                  }
                                }}
                              />
                            </span>
                          </label>
                        ))}
                      </div>
                    </div>
                  ) : null}
                  <p className="theme-group-label" style={{ marginTop: 16 }}>
                    Overlay opacity
                  </p>
                  <p className="page-desc" style={{ marginTop: 0, marginBottom: 10 }}>
                    Each overlay panel has its own opacity. Use “Set all” to match every panel.
                  </p>
                  <div className="field">
                    <label htmlFor="opacity-all">
                      Set all ({settings.opacity.toFixed(2)})
                    </label>
                    <input
                      id="opacity-all"
                      type="range"
                      min={0.4}
                      max={1}
                      step={0.01}
                      value={settings.opacity}
                      onChange={(e) => {
                        const value = Number(e.target.value)
                        const moduleOpacity = Object.fromEntries(
                          OVERLAY_MODULE_IDS.map((id) => [id, value]),
                        ) as Partial<Record<ModuleId, number>>
                        void updateSettings({ opacity: value, moduleOpacity })
                      }}
                    />
                  </div>
                  <div className="opacity-module-list">
                    {OVERLAY_MODULE_IDS.map((id) => {
                      const value = settings.moduleOpacity[id] ?? settings.opacity
                      return (
                        <div className="field" key={id}>
                          <label htmlFor={`opacity-${id}`}>
                            {MODULE_META[id].label} ({value.toFixed(2)})
                          </label>
                          <input
                            id={`opacity-${id}`}
                            type="range"
                            min={0.4}
                            max={1}
                            step={0.01}
                            value={value}
                            onChange={(e) =>
                              void updateSettings({
                                moduleOpacity: {
                                  ...settings.moduleOpacity,
                                  [id]: Number(e.target.value),
                                },
                              })
                            }
                          />
                        </div>
                      )
                    })}
                  </div>
                  <div className="field">
                    <label htmlFor="overlay-scale">
                      Overlay scale ({settings.overlayScale.toFixed(2)}×)
                    </label>
                    <input
                      id="overlay-scale"
                      type="range"
                      min={0.75}
                      max={1.5}
                      step={0.05}
                      value={settings.overlayScale}
                      onChange={(e) =>
                        void updateSettings({ overlayScale: Number(e.target.value) })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="ocr-display">Game / OCR monitor</label>
                    <select
                      id="ocr-display"
                      value={
                        settings.ocrDisplayId == null
                          ? 'primary'
                          : String(settings.ocrDisplayId)
                      }
                      onChange={(e) => {
                        const v = e.target.value
                        void updateSettings({
                          ocrDisplayId: v === 'primary' ? null : Number(v),
                          onboarding: {
                            ...settings.onboarding,
                            ocrMonitorAck: true,
                          },
                        })
                      }}
                    >
                      <option value="primary">Primary display (default)</option>
                      {displays.map((d) => (
                        <option key={d.id} value={String(d.id)}>
                          {d.label}
                          {d.isPrimary ? ' · primary' : ''} — {d.width}×{d.height} (id {d.id})
                        </option>
                      ))}
                    </select>
                    <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.78rem' }}>
                      Relic/riven OCR and the overlay use this monitor. Pick the screen Warframe is
                      on when you run multi-monitor
                      {displays.length > 1
                        ? ' — junk OCR often means the wrong display is selected'
                        : ''}
                      . On Linux, choose that same screen in the screen-share dialog.
                    </p>
                    {displayRemount ? (
                      <div className="getting-started" style={{ marginTop: 12, padding: '12px 14px' }}>
                        <p className="getting-started__sub" style={{ margin: '0 0 8px' }}>
                          Monitor IDs remapped (was display {displayRemount.previousId}). Which
                          screen is Warframe on?
                        </p>
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                          <button
                            type="button"
                            className="btn ghost"
                            onClick={() => {
                              void updateSettings({ ocrDisplayId: null }).then(() => {
                                setDisplayRemount(null)
                                pushToast('OCR monitor set to primary', 'ok')
                              })
                            }}
                          >
                            Primary
                          </button>
                          {(displayRemount.displays.length
                            ? displayRemount.displays
                            : displays
                          ).map((d) => (
                            <button
                              key={d.id}
                              type="button"
                              className="btn primary"
                              onClick={() => {
                                void updateSettings({ ocrDisplayId: d.id }).then(() => {
                                  setDisplayRemount(null)
                                  pushToast(`OCR monitor → ${d.label}`, 'ok')
                                })
                              }}
                            >
                              {d.label}
                              {d.isPrimary ? ' · primary' : ''} ({d.width}×{d.height})
                            </button>
                          ))}
                        </div>
                      </div>
                    ) : null}
                  </div>
                  <div className="field">
                    <label htmlFor="wf-theme">Relic UI theme (OCR)</label>
                    <select
                      id="wf-theme"
                      value={settings.wfThemeOverride ?? 'auto'}
                      onChange={(e) => {
                        const v = e.target.value
                        void updateSettings({
                          wfThemeOverride: v === 'auto' ? null : (v as WfThemeId),
                        })
                      }}
                    >
                      <option value="auto">Auto-detect</option>
                      {WF_THEME_OPTIONS.map((id) => (
                        <option key={id} value={id}>
                          {id}
                        </option>
                      ))}
                    </select>
                    <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.78rem' }}>
                      Force your Warframe UI theme if auto-detect mis-reads reward names.
                    </p>
                  </div>
                  <div className="field">
                    <label htmlFor="relic-squad">Relic reward slots</label>
                    <select
                      id="relic-squad"
                      value={
                        settings.relicSquadSizeOverride == null
                          ? 'auto'
                          : String(settings.relicSquadSizeOverride)
                      }
                      onChange={(e) => {
                        const v = e.target.value
                        void updateSettings({
                          relicSquadSizeOverride:
                            v === 'auto' ? null : (Number(v) as 3 | 4),
                        })
                      }}
                    >
                      <option value="auto">Auto (EE.log / image)</option>
                      <option value="4">4 players</option>
                      <option value="3">3 players</option>
                    </select>
                    <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.78rem' }}>
                      Use 3 when running with a squad of three so OCR crops line up.
                    </p>
                  </div>
                  <div className="field">
                    <label htmlFor="relic-best-pick">Relic “Best” pick mode</label>
                    <select
                      id="relic-best-pick"
                      value={settings.relicBestPickMode || 'balanced'}
                      onChange={(e) => {
                        void updateSettings({
                          relicBestPickMode: e.target.value as
                            | 'balanced'
                            | 'needed'
                            | 'platinum'
                            | 'ducats',
                        })
                      }}
                    >
                      <option value="balanced">Balanced (needed + plat)</option>
                      <option value="needed">Needed parts first</option>
                      <option value="platinum">Highest platinum</option>
                      <option value="ducats">Highest ducats</option>
                    </select>
                    <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.78rem' }}>
                      Controls which reward card gets the Best tag after a fissure OCR scan.
                    </p>
                  </div>
                  {typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent) ? (
                    <div style={{ marginTop: 12 }}>
                      <LinuxCaptureWizard
                        compact
                        settings={settings}
                        displays={displays}
                        onUpdate={(partial) => void updateSettings(partial)}
                      />
                    </div>
                  ) : null}
                  <ToggleRow
                    label="Overlay visible"
                    description="Global hotkey also toggles this. With “Only over Warframe”, armed means it appears when the game is focused."
                    checked={settings.overlayVisible}
                    onChange={(enabled) => void updateSettings({ overlayVisible: enabled })}
                  />
                  <ToggleRow
                    label="Only over Warframe"
                    description="Hide the overlay when another app is focused. On Linux without window focus APIs, this tracks whether Warframe is running."
                    checked={settings.overlayOnlyInWarframe}
                    onChange={(enabled) => void updateSettings({ overlayOnlyInWarframe: enabled })}
                  />
                  <ToggleRow
                    label="Move panels (in-game)"
                    description={`${prettyHotkey(settings.hotkeys.editLayout)} unlocks click-through so you can drag. Prefer Layout for a mock preview.`}
                    checked={settings.layoutEditMode}
                    onChange={(enabled) => void updateSettings({ layoutEditMode: enabled })}
                  />
                </Panel>

                <div className="section-gap" />

                <div className="grid-2">

                  <Panel title="Companion">
                    <ToggleRow
                      label="Quiet launch (tray)"
                      description="After first-run checklist, start minimized to the tray"
                      checked={settings.quietMode}
                      onChange={(enabled) => void updateSettings({ quietMode: enabled })}
                    />
                    <ToggleRow
                      label="Quiet focus (overlay)"
                      description={`${prettyHotkey(settings.hotkeys.toggleQuietFocus)} — only fissures + relic/riven OCR. Mission strip also toggles.`}
                      checked={settings.quietFocusActive}
                      onChange={() => void window.voidlens?.toggleQuietFocus?.()}
                    />
                    <ToggleRow
                      label="Game performance mode"
                      description="Less lag vs Warframe: defer OCR warmup, release screen capture when idle, slower countdown clock, pause inventory sync while OCR runs"
                      checked={settings.gamePerformanceMode}
                      onChange={(enabled) => void updateSettings({ gamePerformanceMode: enabled })}
                    />
                    <ToggleRow
                      label="Tight overlay bounds"
                      description="Shrink the transparent overlay window to visible panels (requires Game performance mode). Layout edit uses full screen."
                      checked={settings.overlayTightBounds}
                      onChange={(enabled) => void updateSettings({ overlayTightBounds: enabled })}
                    />
                    <ToggleRow
                      label="Dual OCR workers"
                      description="Faster multi-slot relic reads; uses more CPU/GPU. Restart app after changing."
                      checked={settings.ocrPoolSize === 2}
                      onChange={(enabled) =>
                        void updateSettings({ ocrPoolSize: enabled ? 2 : 1 })
                      }
                    />
                    <ToggleRow
                      label="Relic scan chime"
                      description="Play a sound when relic OCR finishes reading rewards"
                      checked={settings.relicSoundEnabled}
                      onChange={(enabled) => void updateSettings({ relicSoundEnabled: enabled })}
                    />
                    <ToggleRow
                      label="Riven scan chime"
                      description="Play a sound when riven OCR finishes the compare scan"
                      checked={settings.rivenSoundEnabled}
                      onChange={(enabled) => void updateSettings({ rivenSoundEnabled: enabled })}
                    />
                    <div className="field">
                      <label htmlFor="sound-pack">Sound pack</label>
                      <select
                        id="sound-pack"
                        value={settings.soundPack}
                        onChange={(e) => {
                          const pack = e.target.value as typeof settings.soundPack
                          void updateSettings({ soundPack: pack })
                          playScanSound('relic', pack)
                        }}
                      >
                        <option value="soft">Soft</option>
                        <option value="bright">Bright</option>
                        <option value="double">Double tap</option>
                        <option value="low">Low</option>
                      </select>
                    </div>
                    <ToggleRow
                      label="Auto-sync inventory"
                      description="While Warframe is running, resync about every 10 minutes (checks every 2 minutes)"
                      checked={settings.inventoryAutoSync}
                      onChange={(enabled) => void updateSettings({ inventoryAutoSync: enabled })}
                    />
                    <ToggleRow
                      label="Remind when inventory is stale"
                      description="Toast when Warframe is running and inventory looks old"
                      checked={settings.inventoryRemindWhenRunning}
                      onChange={(enabled) =>
                        void updateSettings({ inventoryRemindWhenRunning: enabled })
                      }
                    />
                    <ToggleRow
                      label="Baro arrival notification"
                      description="Desktop alert when Baro lands at a relay"
                      checked={settings.baroArrivalNotify}
                      onChange={(enabled) => void updateSettings({ baroArrivalNotify: enabled })}
                    />
                    <div className="toolbar" style={{ marginTop: 8, gap: 8, flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          void window.voidlens?.exportSettings?.().then((r) => {
                            if (r.ok) pushToast(`Exported settings`, 'ok')
                            else if (r.error && r.error !== 'cancelled')
                              pushToast(r.error, 'error')
                          })
                        }
                      >
                        Export settings
                      </button>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          void window.voidlens?.importSettings?.().then((r) => {
                            if (r.ok) pushToast('Settings imported', 'ok')
                            else if (r.error && r.error !== 'cancelled')
                              pushToast(r.error, 'error')
                          })
                        }
                      >
                        Import settings
                      </button>
                    </div>
                    <button
                      type="button"
                      className="btn ghost"
                      style={{ marginTop: 8 }}
                      onClick={() => goTab('inventory')}
                    >
                      Open inventory browser
                    </button>
                  </Panel>

                  <Panel
                    title="OBS / external widgets"
                    subtitle="Local browser sources for Streamlabs / OBS"
                  >
                    <ToggleRow
                      label="Widget server"
                      description="Serve HTML widgets on localhost for Browser Source overlays"
                      checked={settings.widgetServerEnabled}
                      onChange={(enabled) => void updateSettings({ widgetServerEnabled: enabled })}
                    />
                    <div className="field">
                      <label htmlFor="widget-port">Port</label>
                      <input
                        id="widget-port"
                        type="number"
                        min={1024}
                        max={65535}
                        value={settings.widgetServerPort}
                        onChange={(e) =>
                          void updateSettings({
                            widgetServerPort: Number(e.target.value) || 17862,
                          })
                        }
                      />
                    </div>
                    {settings.widgetServerEnabled ? (
                      <p className="muted" style={{ margin: '6px 0 0', fontSize: '0.78rem' }}>
                        Open{' '}
                        <button
                          type="button"
                          className="btn ghost"
                          style={{ padding: '0 4px', verticalAlign: 'baseline' }}
                          onClick={() =>
                            void window.voidlens.openExternal(
                              `http://127.0.0.1:${settings.widgetServerPort}/`,
                            )
                          }
                        >
                          http://127.0.0.1:{settings.widgetServerPort}/
                        </button>{' '}
                        for widget URLs (fissures, cycles, relics, rivens, …).
                      </p>
                    ) : null}
                  </Panel>

                  <Panel title="Hotkeys">
                    {hotkeyStatus.filter((hk) => hk.requested?.trim() && !hk.ok).length > 0 ? (
                      <p className="market-buy-hit" role="alert" style={{ marginBottom: 12 }}>
                        Some hotkeys failed to register (often taken by another app):{' '}
                        {hotkeyStatus
                          .filter((hk) => hk.requested?.trim() && !hk.ok)
                          .map((hk) => HOTKEY_LABELS[hk.id] || hk.id)
                          .join(', ')}
                        . Pick a different combo below.
                      </p>
                    ) : null}
                    <div className="field">
                      <label htmlFor="hk-overlay">Toggle overlay</label>
                      <HotkeyInput
                        id="hk-overlay"
                        value={settings.hotkeys.toggleOverlay}
                        onChange={(next) =>
                          void updateSettings({
                            hotkeys: { ...settings.hotkeys, toggleOverlay: next },
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="hk-companion">Open companion</label>
                      <HotkeyInput
                        id="hk-companion"
                        value={settings.hotkeys.openCompanion}
                        onChange={(next) =>
                          void updateSettings({
                            hotkeys: { ...settings.hotkeys, openCompanion: next },
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="hk-refresh">Refresh worldstate</label>
                      <HotkeyInput
                        id="hk-refresh"
                        value={settings.hotkeys.refreshWorldstate}
                        onChange={(next) =>
                          void updateSettings({
                            hotkeys: { ...settings.hotkeys, refreshWorldstate: next },
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="hk-relics">Scan relic rewards</label>
                      <HotkeyInput
                        id="hk-relics"
                        value={settings.hotkeys.scanRelics}
                        onChange={(next) =>
                          void updateSettings({
                            hotkeys: { ...settings.hotkeys, scanRelics: next },
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="hk-dismiss-relics">Dismiss relic popup</label>
                      <HotkeyInput
                        id="hk-dismiss-relics"
                        value={settings.hotkeys.dismissRelics}
                        onChange={(next) =>
                          void updateSettings({
                            hotkeys: { ...settings.hotkeys, dismissRelics: next },
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="hk-rivens">Scan riven compare</label>
                      <HotkeyInput
                        id="hk-rivens"
                        value={settings.hotkeys.scanRivens}
                        onChange={(next) =>
                          void updateSettings({
                            hotkeys: { ...settings.hotkeys, scanRivens: next },
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="hk-dismiss-rivens">Dismiss riven popup</label>
                      <HotkeyInput
                        id="hk-dismiss-rivens"
                        value={settings.hotkeys.dismissRivens}
                        onChange={(next) =>
                          void updateSettings({
                            hotkeys: { ...settings.hotkeys, dismissRivens: next },
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="hk-layout">Move panels (unlock drag)</label>
                      <HotkeyInput
                        id="hk-layout"
                        value={settings.hotkeys.editLayout}
                        onChange={(next) =>
                          void updateSettings({
                            hotkeys: { ...settings.hotkeys, editLayout: next },
                          })
                        }
                      />
                    </div>
                    <div className="field">
                      <label htmlFor="hk-worldstate">Hide / restore worldstate panels</label>
                      <HotkeyInput
                        id="hk-worldstate"
                        value={settings.hotkeys.toggleWorldstatePanels}
                        onChange={(next) =>
                          void updateSettings({
                            hotkeys: {
                              ...settings.hotkeys,
                              toggleWorldstatePanels: next,
                            },
                          })
                        }
                      />
                      <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
                        Clears Cycles, Fissures, Baro, etc. Second press restores. Relic/riven
                        popups stay available.
                      </p>
                    </div>
                    <div className="field">
                      <label htmlFor="hk-quiet-focus">Quiet focus (fissures + OCR)</label>
                      <HotkeyInput
                        id="hk-quiet-focus"
                        value={settings.hotkeys.toggleQuietFocus}
                        onChange={(next) =>
                          void updateSettings({
                            hotkeys: {
                              ...settings.hotkeys,
                              toggleQuietFocus: next,
                            },
                          })
                        }
                      />
                      <p className="muted" style={{ margin: '4px 0 0', fontSize: '0.75rem' }}>
                        Leaves only Fissures + Relic/Riven OCR modules. Second press restores your
                        previous module set.
                      </p>
                    </div>
                    <p className="muted" style={{ margin: '12px 0 8px', fontSize: '0.78rem' }}>
                      Optional per-panel toggles (leave unbound / Clear to disable):
                    </p>
                    {(
                      [
                        ['toggleModuleCycles', 'Toggle Cycles'],
                        ['toggleModuleFissures', 'Toggle Fissures'],
                        ['toggleModuleBaro', 'Toggle Baro'],
                        ['toggleModuleNightwave', 'Toggle Nightwave'],
                        ['toggleModuleArbitration', 'Toggle Arbitration'],
                        ['toggleModuleInvasions', 'Toggle Invasions'],
                        ['toggleModuleArchon', 'Toggle Archon Hunt'],
                        ['toggleModuleDeepArchimedea', 'Toggle Deep Archimedea'],
                      ] as const
                    ).map(([key, label]) => (
                      <div className="field" key={key}>
                        <label htmlFor={`hk-${key}`}>{label}</label>
                        <HotkeyInput
                          id={`hk-${key}`}
                          value={settings.hotkeys[key]}
                          allowClear
                          placeholder="Unbound — click to set"
                          onChange={(next) =>
                            void updateSettings({
                              hotkeys: { ...settings.hotkeys, [key]: next },
                            })
                          }
                        />
                      </div>
                    ))}
                    {hotkeyStatus.filter((hk) => hk.requested?.trim()).length > 0 ? (
                      <div className="mod-stack" style={{ marginTop: 12 }}>
                        <p className="muted" style={{ margin: 0 }}>
                          Registration status
                        </p>
                        <ul className="mod-list">
                          {hotkeyStatus
                            .filter((hk) => hk.requested?.trim())
                            .map((hk) => (
                            <li key={hk.id} className="mod-row">
                              <div>
                                <div className="mod-row__title">{HOTKEY_LABELS[hk.id]}</div>
                                <div className="mod-row__meta">{prettyHotkey(hk.requested)}</div>
                              </div>
                              <div className={`mod-row__value ${hk.ok ? 'is-ok' : 'is-bad'}`}>
                                {hk.ok && hk.registered
                                  ? prettyHotkey(hk.registered)
                                  : 'Not registered'}
                              </div>
                            </li>
                          ))}
                        </ul>
                      </div>
                    ) : null}
                    <p className="muted">
                      Click a binding, then press the new combo (e.g. Alt+Shift+V). Esc cancels.
                      Press <strong>?</strong> for the cheat sheet.
                    </p>
                  </Panel>

                  <Panel title="EE.log path" subtitle="Used by Relics, Rivens & Arbitration">
                    <div className="field">
                      <label htmlFor="eelog">Log file</label>
                      <div className="path-row">
                        <input
                          id="eelog"
                          readOnly
                          value={settings.eeLogPath || ''}
                          placeholder="Not set"
                        />
                        <button
                          className="btn"
                          onClick={() => void window.voidlens?.pickEeLogPath()}
                        >
                          Browse
                        </button>
                        <button
                          className="btn ghost"
                          onClick={() => void window.voidlens?.detectEeLogPath()}
                        >
                          Detect
                        </button>
                      </div>
                    </div>
                  </Panel>
                </div>

                <div className="section-gap" />
                <div
                  onFocusCapture={() => patchOnboarding({ inventoryTouched: true })}
                  onClickCapture={() => patchOnboarding({ inventoryTouched: true })}
                >
                  <InventorySettings />
                </div>
                <div className="section-gap" />
                <UpdateSettings />
              </>
            ) : null}

            {tab === 'help' ? (
              <HelpPage
                settings={settings}
                onStartTour={() => setTourOpen(true)}
                onShowHotkeys={() => setHotkeysOpen(true)}
                onResetChecklist={() =>
                  patchOnboarding({
                    checklistDismissed: false,
                    borderlessAck: false,
                    modulesTouched: false,
                    layoutVisited: false,
                    inventoryTouched: false,
                  })
                }
                onGoMarket={() => goTab('market')}
                scrollToId={helpScrollTo}
                onScrollToConsumed={() => setHelpScrollTo(null)}
              />
            ) : null}
          </main>
        </div>
      </div>

      <AppTour
        open={tourOpen}
        steps={TOUR_STEPS}
        onTab={(t) => goTab(t as Tab)}
        onClose={(completed) => {
          setTourOpen(false)
          if (completed) patchOnboarding({ tourCompleted: true })
        }}
      />

      <HotkeySheet
        open={hotkeysOpen}
        hotkeys={settings.hotkeys}
        onClose={() => setHotkeysOpen(false)}
      />

      <WhatsNew version={appVersion} open={whatsNewOpen} onDismiss={dismissWhatsNew} />
      <ToastHost />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={commandActions}
      />
    </NowProvider>
  )
}
