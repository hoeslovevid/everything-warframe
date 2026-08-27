import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DEFAULT_OCR_SCAN_REGIONS,
  FissurePathMode,
  FissureSort,
  ModuleId,
  OcrScanRegions,
  OVERLAY_MODULE_IDS,
  PanelAnchor,
  PrimaryDisplayInfo,
  WorldstateSnapshot,
} from '../../../shared/types'
import { OverlayLayoutStage } from '../../components/OverlayLayoutStage'
import { ToggleRow } from '../../components/ToggleRow'
import {
  getDefaultPanelAnchors,
  getLayoutPresetAnchors,
  LAYOUT_PRESETS,
  LayoutPresetId,
} from '../../lib/layoutPresets'
import {
  buildPreviewWorldstate,
  MOCK_RELIC_REWARDS,
  MOCK_RIVEN_SCAN,
} from '../../lib/mockOverlayData'
import '../../styles/overlay.css'

const FALLBACK_DISPLAY: PrimaryDisplayInfo = {
  width: 1920,
  height: 1080,
  scaleFactor: 1,
}

/** Overlay modules that can be placed in the layout editor. */
const ALL_MODULES = OVERLAY_MODULE_IDS

type Props = {
  settingsModules: Record<ModuleId, boolean>
  panelAnchors: Partial<Record<ModuleId, PanelAnchor>>
  opacity: number
  moduleOpacity: Partial<Record<ModuleId, number>>
  overlayScale: number
  fissureTiers: string[]
  fissurePathMode?: FissurePathMode
  fissureShowStorms?: boolean
  fissureSort?: FissureSort
  baroWishlist?: string[]
  nightwaveDoneIds?: string[]
  interactionHotkey: string
  liveData: WorldstateSnapshot
  ocrScanRegions: OcrScanRegions
  onSaveAnchors: (anchors: Partial<Record<ModuleId, PanelAnchor>>) => void
  onSaveOcrScanRegions: (regions: OcrScanRegions) => void
}

export function LayoutEditor({
  settingsModules,
  panelAnchors,
  opacity,
  moduleOpacity,
  overlayScale,
  fissureTiers,
  fissurePathMode = 'both',
  fissureShowStorms = true,
  fissureSort = 'eta',
  baroWishlist = [],
  nightwaveDoneIds = [],
  interactionHotkey,
  liveData,
  ocrScanRegions,
  onSaveAnchors,
  onSaveOcrScanRegions,
}: Props) {
  const shellRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(0.45)
  const [showAll, setShowAll] = useState(false)
  const [editOcrAreas, setEditOcrAreas] = useState(true)
  const [ocrGuidesReady, setOcrGuidesReady] = useState(false)
  const [anchors, setAnchors] = useState(panelAnchors)
  const [ocrRegions, setOcrRegions] = useState(ocrScanRegions)
  const [display, setDisplay] = useState<PrimaryDisplayInfo>(FALLBACK_DISPLAY)

  useEffect(() => {
    setAnchors(panelAnchors)
  }, [panelAnchors])

  useEffect(() => {
    setOcrRegions(ocrScanRegions)
  }, [ocrScanRegions])

  // Defer OCR guides one frame so panel chrome paints first.
  useEffect(() => {
    if (!editOcrAreas) {
      setOcrGuidesReady(false)
      return
    }
    setOcrGuidesReady(false)
    const t = window.setTimeout(() => setOcrGuidesReady(true), 60)
    return () => window.clearTimeout(t)
  }, [editOcrAreas])

  useEffect(() => {
    let cancelled = false
    const load = async () => {
      try {
        if (window.voidlens?.getPrimaryDisplay) {
          const next = await window.voidlens.getPrimaryDisplay()
          if (!cancelled && next?.width > 0 && next?.height > 0) {
            setDisplay(next)
            return
          }
        }
      } catch {
        // fall through
      }
      if (!cancelled) {
        setDisplay({
          width: window.screen.width || FALLBACK_DISPLAY.width,
          height: window.screen.height || FALLBACK_DISPLAY.height,
          scaleFactor: window.devicePixelRatio || 1,
        })
      }
    }
    void load()

    const onResize = () => {
      void load()
    }
    window.addEventListener('resize', onResize)
    return () => {
      cancelled = true
      window.removeEventListener('resize', onResize)
    }
  }, [])

  const designW = display.width
  const designH = display.height

  useEffect(() => {
    const el = shellRef.current
    if (!el) return
    const ro = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width ?? el.clientWidth
      if (width <= 0) return
      setScale(Math.min(1, width / designW))
    })
    ro.observe(el)
    setScale(Math.min(1, el.clientWidth / designW))
    return () => ro.disconnect()
  }, [designW])

  const modules = useMemo(() => {
    if (showAll) return ALL_MODULES
    return ALL_MODULES.filter((id) => settingsModules[id])
  }, [showAll, settingsModules])

  const previewData = useMemo(() => buildPreviewWorldstate(liveData), [liveData])

  const commit = useCallback(
    (next: Partial<Record<ModuleId, PanelAnchor>>) => {
      setAnchors(next)
      onSaveAnchors(next)
    },
    [onSaveAnchors],
  )

  const commitOcr = useCallback(
    (next: OcrScanRegions) => {
      setOcrRegions(next)
      onSaveOcrScanRegions(next)
    },
    [onSaveOcrScanRegions],
  )

  const reset = () => {
    commit(getDefaultPanelAnchors(designW, designH))
  }

  const resetOcr = () => {
    commitOcr({ ...DEFAULT_OCR_SCAN_REGIONS })
  }

  const applyPreset = (id: LayoutPresetId) => {
    commit(getLayoutPresetAnchors(id, designW, designH))
  }

  const hasCustomOcr =
    ocrRegions.relicStrip != null ||
    ocrRegions.rivenCurrent != null ||
    ocrRegions.rivenReroll != null

  return (
    <>
      <header className="page-header">
        <h2 className="page-title">Layout</h2>
        <div className="page-title-rule" />
        <p className="page-desc">
          Arrange overlays on a mock of your Game/OCR monitor (
          <strong>
            {designW}×{designH}
          </strong>
          ). Drag the <strong>Relic Rewards</strong> strip under the reward cards and the{' '}
          <strong>Riven Grader</strong> strip above the Cycle compare cards. Dashed boxes are the
          OCR scan areas — drag or resize them so they cover the in-game Relic names / Riven cards.
          Presets and reset scale to this resolution. In-game, press{' '}
          <strong>{interactionHotkey}</strong> to unlock and drag during a popup.
        </p>
      </header>

      <div className="toolbar" data-tour="layout-presets">
        {(Object.keys(LAYOUT_PRESETS) as LayoutPresetId[]).map((id) => (
          <button
            key={id}
            className="btn"
            title={LAYOUT_PRESETS[id].description}
            onClick={() => applyPreset(id)}
          >
            {LAYOUT_PRESETS[id].label}
          </button>
        ))}
        <button className="btn ghost" onClick={reset}>
          Reset panels
        </button>
        <button className="btn ghost" onClick={resetOcr} disabled={!hasCustomOcr}>
          Reset OCR areas
        </button>
        <span className="pill muted">
          Monitor {designW}×{designH}
          {display.scaleFactor !== 1 ? ` · ${display.scaleFactor}× DPI` : ''}
        </span>
        <span className="pill muted">Left or right drag · auto-saves</span>
        {hasCustomOcr ? <span className="pill">Custom OCR</span> : null}
      </div>

      <div style={{ marginBottom: 14, maxWidth: 560, display: 'grid', gap: 10 }}>
        <ToggleRow
          label="Show all modules"
          description="Include disabled modules so you can place them before enabling (heavier preview)"
          checked={showAll}
          onChange={setShowAll}
        />
        <ToggleRow
          label="Edit OCR scan areas"
          description="Show Relic name-band and Riven card crops. Keep the Relic box thin over item names only (not the whole cards) — tall boxes are ignored for OCR."
          checked={editOcrAreas}
          onChange={setEditOcrAreas}
        />
      </div>

      <div className="layout-preview-shell" ref={shellRef}>
        <div
          className="layout-preview-scale"
          style={{
            height: designH * scale,
            position: 'relative',
          }}
        >
          <div
            style={{
              transform: `scale(${scale})`,
              transformOrigin: 'top left',
              width: designW,
              height: designH,
            }}
          >
            <OverlayLayoutStage
              mode="preview"
              editable
              modules={modules}
              data={previewData}
              anchors={anchors}
              opacity={opacity}
              moduleOpacity={moduleOpacity}
              overlayScale={overlayScale}
              fissureTiers={fissureTiers}
              fissurePathMode={fissurePathMode}
              fissureShowStorms={fissureShowStorms}
              fissureSort={fissureSort}
              baroWishlist={baroWishlist}
              nightwaveDoneIds={nightwaveDoneIds}
              designWidth={designW}
              designHeight={designH}
              relicPreviewRewards={MOCK_RELIC_REWARDS}
              rivenPreviewState={MOCK_RIVEN_SCAN}
              showOcrGuides={editOcrAreas && ocrGuidesReady}
              ocrGuidesEditable={editOcrAreas && ocrGuidesReady}
              ocrScanRegions={ocrRegions}
              onOcrScanRegionsChange={setOcrRegions}
              onOcrScanRegionsCommit={commitOcr}
              dragHint="Drag panels or OCR boxes (positions save)"
              hint={`Preview · ${designW}×${designH} OCR display · left or right mouse`}
              onAnchorsChange={setAnchors}
              onAnchorsCommit={commit}
            />
          </div>
        </div>
      </div>

      <p className="muted" style={{ marginTop: 8 }}>
        Canvas matches your Game/OCR monitor ({designW}×{designH}). Relic OCR crops the gold name
        band under reward cards; Riven OCR crops the two Cycle diamonds. Custom areas are stored as
        screen fractions so they scale if you change resolution. In-game: press{' '}
        <strong>{interactionHotkey}</strong> to unlock click-through, drag, then lock again — OCR
        guides also appear while panels are unlocked.
      </p>
    </>
  )
}
