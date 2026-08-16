import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ModuleId,
  OcrScanRegions,
  OverlayContentOrigin,
  OVERLAY_MODULE_IDS,
  PanelAnchor,
} from '../../../shared/types'
import { OverlayLayoutStage } from '../../components/OverlayLayoutStage'
import { NowProvider } from '../../hooks/NowContext'
import { useColorTheme } from '../../hooks/useColorTheme'
import { useInventory } from '../../hooks/useInventory'
import { useRelicScan } from '../../hooks/useRelicScan'
import { useRivenScan } from '../../hooks/useRivenScan'
import { useSettings, useWorldstate } from '../../hooks/useVoidLens'
import { OverlayMissionStrip } from '../../components/OverlayMissionStrip'
import { ToastHost } from '../../components/ToastHost'
import { prettyHotkey } from '../../lib/hotkey'
import { playScanSound } from '../../lib/sounds'
import '../../styles/overlay.css'

export function OverlayApp() {
  const { settings, ready, updateSettings } = useSettings()
  const { data } = useWorldstate()
  const { status: inventory, progress: inventoryProgress, syncFromGame } = useInventory()
  const { state: relicScan, scan: scanRelics, clear: clearRelics } = useRelicScan()
  const { state: rivenScan, scan: scanRivens, clear: clearRivens } = useRivenScan()
  useColorTheme(settings.colorTheme, settings.customPalette)
  const [anchors, setAnchors] = useState<Partial<Record<ModuleId, PanelAnchor>>>(
    settings.panelAnchors,
  )
  const [ocrRegions, setOcrRegions] = useState<OcrScanRegions>(settings.ocrScanRegions)
  const [toggleCue, setToggleCue] = useState<'on' | 'off' | null>(null)
  const [ocrMenuOpen, setOcrMenuOpen] = useState(false)
  const [contentOrigin, setContentOrigin] = useState<OverlayContentOrigin | null>(null)
  /** Skip settings→anchors sync while a panel drag/commit is in flight (OCR saves can race). */
  const anchorsLocalRef = useRef(false)
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
    // Dumpable ducat browse is heavy — only when Baro panel is on the overlay.
    if (!settings.modules.baro) {
      setDumpableDucats(null)
      return
    }
    void window.voidlens
      .browseInventory?.({ sellableOnly: true, enrichPrices: true, sort: 'ducats', limit: 200 })
      .then((rows) => {
        let sum = 0
        for (const r of rows) {
          if (r.ducats != null && r.excess > 0) sum += r.ducats * r.excess
        }
        setDumpableDucats(sum)
      })
  }, [inventory.loaded, inventory.revision, settings.modules.baro])

  useEffect(() => {
    void window.voidlens?.getOverlayContentOrigin?.().then((o) => {
      if (o) setContentOrigin(o)
    })
    const unsub = window.voidlens?.onOverlayContentOrigin?.((o) => setContentOrigin(o))
    return () => unsub?.()
  }, [])

  useEffect(() => {
    if (anchorsLocalRef.current) return
    setAnchors(settings.panelAnchors)
  }, [settings.panelAnchors])

  useEffect(() => {
    setOcrRegions(settings.ocrScanRegions)
  }, [settings.ocrScanRegions])

  useEffect(() => {
    const unsub = window.voidlens?.onOverlayVisibilityChanged((visible) => {
      setToggleCue(visible ? 'on' : 'off')
      window.setTimeout(() => setToggleCue(null), 1400)
    })
    return () => unsub?.()
  }, [])

  // Chime when OCR finishes — overlay plays even if companion is minimized.
  useEffect(() => {
    if (!window.voidlens?.onRelicSound) return
    return window.voidlens.onRelicSound(() => playScanSound('relic', settings.soundPack))
  }, [settings.soundPack])

  useEffect(() => {
    if (!window.voidlens?.onRivenSound) return
    return window.voidlens.onRivenSound(() => playScanSound('riven', settings.soundPack))
  }, [settings.soundPack])

  // Relics / Rivens are transient popups (AlecaFrame-style), not always-on panels.
  const modules = useMemo(() => {
    const enabled = OVERLAY_MODULE_IDS.filter(
      (id) => settings.modules[id] && id !== 'relics' && id !== 'rivens',
    )
    const next = [...enabled]
    if (settings.modules.relics && (relicScan.active || relicScan.scanning)) next.push('relics')
    if (settings.modules.rivens && (rivenScan.active || rivenScan.scanning)) next.push('rivens')
    return next
  }, [
    settings.modules,
    relicScan.active,
    relicScan.scanning,
    rivenScan.active,
    rivenScan.scanning,
  ])

  const onAnchorsChange = useCallback((next: Partial<Record<ModuleId, PanelAnchor>>) => {
    anchorsLocalRef.current = true
    setAnchors(next)
  }, [])

  const commitAnchors = useCallback(
    (next: Partial<Record<ModuleId, PanelAnchor>>) => {
      anchorsLocalRef.current = true
      setAnchors(next)
      void updateSettings({ panelAnchors: next }).finally(() => {
        anchorsLocalRef.current = false
      })
    },
    [updateSettings],
  )

  const commitOcrRegions = useCallback(
    (next: OcrScanRegions) => {
      setOcrRegions(next)
      void updateSettings({ ocrScanRegions: next })
    },
    [updateSettings],
  )

  const dismissDragHint = useCallback(() => {
    if (settings.overlayDragHintDismissed) return
    void updateSettings({ overlayDragHintDismissed: true })
  }, [settings.overlayDragHintDismissed, updateSettings])

  const hotkeyLabel = prettyHotkey(settings.hotkeys.editLayout)
  const dragHint = settings.overlayDragHintDismissed
    ? undefined
    : settings.layoutEditMode
      ? 'Drag panels or OCR boxes · left or right mouse'
      : hotkeyLabel
        ? `${hotkeyLabel}, then drag to move`
        : undefined

  const ocrPhase = (() => {
    if (relicScan.scanning || rivenScan.scanning) return 'reading' as const
    if (relicScan.error || rivenScan.error) return 'error' as const
    if (relicScan.active && relicScan.rewards.length > 0) return 'done' as const
    if (rivenScan.active && (rivenScan.current || rivenScan.reroll)) return 'done' as const
    return 'idle' as const
  })()
  const ocrLabel =
    ocrPhase === 'reading'
      ? relicScan.scanning
        ? 'OCR · reading relics'
        : 'OCR · reading rivens'
      : ocrPhase === 'done'
        ? relicScan.active && relicScan.rewards.length
          ? 'OCR · relic ready'
          : 'OCR · riven ready'
        : ocrPhase === 'error'
          ? 'OCR · failed'
          : 'OCR · idle'

  const cue = toggleCue ? (
    <div className={`overlay-toggle-cue ${toggleCue === 'off' ? 'is-off' : ''}`}>
      Overlay {toggleCue === 'on' ? 'ON' : 'OFF'}
    </div>
  ) : null

  const clockMs = settings.gamePerformanceMode ? 3000 : 1000
  const originShift =
    contentOrigin?.tight && !settings.layoutEditMode
      ? { transform: `translate(${-contentOrigin.x}px, ${-contentOrigin.y}px)` }
      : undefined
  const designSize =
    contentOrigin?.tight && !settings.layoutEditMode
      ? {
          width: contentOrigin.designWidth,
          height: contentOrigin.designHeight,
        }
      : undefined

  if (!ready || !settings.overlayVisible) {
    // Keep a brief OFF cue visible even while the window is being hidden.
    return <div className="overlay-root">{cue}</div>
  }

  return (
    <NowProvider active intervalMs={clockMs}>
      <div
        className={`overlay-perf-shell${contentOrigin?.tight && !settings.layoutEditMode ? ' is-tight' : ''}`}
        style={{ ...originShift, ...designSize }}
      >
        <OverlayLayoutStage
          mode="live"
          editable={settings.layoutEditMode}
          modules={modules}
          data={data}
          anchors={anchors}
          opacity={settings.opacity}
          moduleOpacity={settings.moduleOpacity}
          overlayScale={settings.overlayScale}
          fissureTiers={settings.fissureTiers}
          fissurePathMode={settings.fissurePathMode}
          fissureShowStorms={settings.fissureShowStorms}
          fissureSort={settings.fissureSort}
          baroWishlist={settings.baroWishlist}
          nightwaveDoneIds={settings.nightwaveDoneIds}
          playerDucats={playerDucats}
          playerCredits={playerCredits}
          dumpableDucats={dumpableDucats}
          dragHint={dragHint}
          hint={
            settings.layoutEditMode
              ? `${hotkeyLabel || 'Hotkey'} again to lock · panels + OCR areas auto-save`
              : undefined
          }
          showOcrGuides={settings.layoutEditMode}
          ocrGuidesEditable={settings.layoutEditMode}
          ocrScanRegions={ocrRegions}
          onOcrScanRegionsChange={setOcrRegions}
          onOcrScanRegionsCommit={commitOcrRegions}
          onAnchorsChange={onAnchorsChange}
          onAnchorsCommit={commitAnchors}
          onPanelMoved={dismissDragHint}
          relicScanning={relicScan.scanning}
          rivenScanning={rivenScan.scanning}
        />
        {cue}
        <div
          className={`ocr-status-chip is-${ocrPhase}${ocrMenuOpen ? ' is-open' : ''}`}
          role="status"
          aria-live="polite"
        >
          <button
            type="button"
            className="ocr-status-chip__main"
            onClick={() => setOcrMenuOpen((v) => !v)}
            title="OCR actions"
          >
            <span className="ocr-status-chip__dot" aria-hidden />
            <span>{ocrLabel}</span>
          </button>
          {ocrMenuOpen ? (
            <div className="ocr-status-chip__menu">
              <button
                type="button"
                className="ocr-status-chip__action"
                onClick={() => {
                  setOcrMenuOpen(false)
                  if (rivenScan.active || rivenScan.scanning) void scanRivens()
                  else void scanRelics()
                }}
              >
                Retry
              </button>
              <button
                type="button"
                className="ocr-status-chip__action"
                onClick={() => {
                  setOcrMenuOpen(false)
                  if (rivenScan.active || rivenScan.scanning) void clearRivens()
                  else void clearRelics()
                }}
              >
                Dismiss
              </button>
              <button
                type="button"
                className="ocr-status-chip__action"
                onClick={() => {
                  setOcrMenuOpen(false)
                  void window.voidlens?.navigateCompanion?.('settings')
                }}
              >
                Settings
              </button>
            </div>
          ) : null}
        </div>
        <OverlayMissionStrip
          settings={settings}
          data={data}
          inventory={inventory}
          syncProgress={inventoryProgress}
          onSyncInventory={() => {
            void syncFromGame()
          }}
          onToggleQuietFocus={() => {
            void window.voidlens?.toggleQuietFocus?.()
          }}
        />
        <ToastHost />
      </div>
    </NowProvider>
  )
}
