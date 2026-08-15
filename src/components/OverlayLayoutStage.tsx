import { PointerEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  FissurePathMode,
  FissureSort,
  ModuleId,
  OcrScanRegions,
  PanelAnchor,
  RewardEval,
  RivenScanState,
  WorldstateSnapshot,
} from '../../shared/types'
import { CyclesPanel } from '../modules/cycles/CyclesPanel'
import { FissuresPanel } from '../modules/fissures/FissuresPanel'
import { BaroPanel } from '../modules/baro/BaroPanel'
import { NightwavePanel } from '../modules/nightwave/NightwavePanel'
import { RelicsPanel } from '../modules/relics/RelicsPanel'
import { RelicRecommendPanel } from '../modules/relicRecommend/RelicRecommendPanel'
import { ArbitrationPanel } from '../modules/arbitration/ArbitrationPanel'
import { InvasionsPanel } from '../modules/invasions/InvasionsPanel'
import { ArchonPanel } from '../modules/archon/ArchonPanel'
import { DeepArchimedeaPanel } from '../modules/deepArchimedea/DeepArchimedeaPanel'
import { RivenPanel } from '../modules/rivens/RivenPanel'
import { Panel } from './Panel'
import { OcrScanGuides } from './OcrScanGuides'
import '../styles/overlay.css'
import './OverlayLayoutStage.css'

export type OverlayLayoutStageProps = {
  modules: ModuleId[]
  data: WorldstateSnapshot
  anchors: Partial<Record<ModuleId, PanelAnchor>>
  /** Legacy / fallback opacity when a module has no per-panel value. */
  opacity?: number
  /** Per-overlay panel opacity. */
  moduleOpacity?: Partial<Record<ModuleId, number>>
  overlayScale?: number
  fissureTiers: string[]
  fissurePathMode?: FissurePathMode
  fissureShowStorms?: boolean
  fissureSort?: FissureSort
  baroWishlist?: string[]
  nightwaveDoneIds?: string[]
  /** Inventory currencies for Baro can-afford (overlay + companion). */
  playerDucats?: number | null
  playerCredits?: number | null
  dumpableDucats?: number | null
  editable: boolean
  /** live = fullscreen overlay; preview = scaled mock monitor */
  mode: 'live' | 'preview'
  designWidth?: number
  designHeight?: number
  relicPreviewRewards?: RewardEval[]
  rivenPreviewState?: RivenScanState
  /** Bottom status pill (optional). */
  hint?: string
  /** Top teaching chip (WFHelper-style), e.g. "Ctrl + Tab, then drag to move". */
  dragHint?: string
  /** Show OCR capture guides over the mock / live stage. */
  showOcrGuides?: boolean
  /** Allow dragging/resizing OCR guides (Layout tab). */
  ocrGuidesEditable?: boolean
  ocrScanRegions?: OcrScanRegions
  onOcrScanRegionsChange?: (next: OcrScanRegions) => void
  onOcrScanRegionsCommit?: (next: OcrScanRegions) => void
  onAnchorsChange: (next: Partial<Record<ModuleId, PanelAnchor>>) => void
  onAnchorsCommit: (next: Partial<Record<ModuleId, PanelAnchor>>) => void
  /** Fired once a drag actually moved a panel (used to dismiss the teaching chip). */
  onPanelMoved?: () => void
  /** Dim worldstate panels while relic/riven OCR is running. */
  relicScanning?: boolean
  rivenScanning?: boolean
}

function clamp(n: number, min: number, max: number) {
  return Math.min(max, Math.max(min, n))
}

type DragSession = {
  id: ModuleId
  button: number
  lastScreenX: number
  lastScreenY: number
  pendingDx: number
  pendingDy: number
  scaleX: number
  scaleY: number
  moved: boolean
}

function isNoDragTarget(target: EventTarget | null): boolean {
  if (!(target instanceof Element)) return false
  return Boolean(target.closest('button, a, input, select, textarea, [data-no-drag]'))
}

function resolveOpacity(
  id: ModuleId,
  moduleOpacity: Partial<Record<ModuleId, number>> | undefined,
  fallback: number,
) {
  const value = moduleOpacity?.[id]
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(value, 0.4, 1)
  }
  return clamp(fallback, 0.4, 1)
}

export function OverlayLayoutStage({
  modules,
  data,
  anchors,
  opacity = 0.92,
  moduleOpacity,
  overlayScale = 1,
  fissureTiers,
  fissurePathMode = 'both',
  fissureShowStorms = true,
  fissureSort = 'eta',
  baroWishlist = [],
  nightwaveDoneIds = [],
  playerDucats = null,
  playerCredits = null,
  dumpableDucats = null,
  editable,
  mode,
  designWidth = 1920,
  designHeight = 1080,
  relicPreviewRewards,
  rivenPreviewState,
  hint,
  dragHint,
  showOcrGuides = false,
  ocrGuidesEditable = false,
  ocrScanRegions,
  onOcrScanRegionsChange,
  onOcrScanRegionsCommit,
  onAnchorsChange,
  onAnchorsCommit,
  onPanelMoved,
  relicScanning = false,
  rivenScanning = false,
}: OverlayLayoutStageProps) {
  const stageRef = useRef<HTMLDivElement>(null)
  const dragRef = useRef<DragSession | null>(null)
  const anchorsRef = useRef(anchors)
  const rafRef = useRef(0)
  const [dragging, setDragging] = useState<ModuleId | null>(null)

  useEffect(() => {
    anchorsRef.current = anchors
  }, [anchors])

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const stageScale = useCallback(() => {
    const el = stageRef.current
    if (!el || mode === 'live') return { scaleX: 1, scaleY: 1 }
    const rect = el.getBoundingClientRect()
    return {
      scaleX: rect.width / designWidth || 1,
      scaleY: rect.height / designHeight || 1,
    }
  }, [mode, designWidth, designHeight])

  const flushMove = useCallback(() => {
    rafRef.current = 0
    const drag = dragRef.current
    if (!drag || !editable) return
    if (drag.pendingDx === 0 && drag.pendingDy === 0) return

    const dx = drag.pendingDx / drag.scaleX
    const dy = drag.pendingDy / drag.scaleY
    drag.pendingDx = 0
    drag.pendingDy = 0

    const current = anchorsRef.current[drag.id] || { x: 24, y: 24 }
    const maxX = mode === 'live' ? window.innerWidth - 40 : designWidth - 40
    const maxY = mode === 'live' ? window.innerHeight - 40 : designHeight - 40
    const x = clamp(Math.round(current.x + dx), 0, maxX)
    const y = clamp(Math.round(current.y + dy), 0, maxY)
    if (x === current.x && y === current.y) return

    drag.moved = true
    const next = { ...anchorsRef.current, [drag.id]: { x, y } }
    anchorsRef.current = next
    onAnchorsChange(next)
  }, [editable, mode, designWidth, designHeight, onAnchorsChange])

  const scheduleFlush = useCallback(() => {
    if (rafRef.current) return
    rafRef.current = requestAnimationFrame(flushMove)
  }, [flushMove])

  const stopDragging = useCallback(
    (commit: boolean) => {
      const drag = dragRef.current
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = 0
      }
      if (drag) flushMove()
      if (commit && drag) {
        onAnchorsCommit(anchorsRef.current)
        if (drag.moved) onPanelMoved?.()
      }
      dragRef.current = null
      setDragging(null)
      document.documentElement.classList.remove('is-overlay-dragging')
    },
    [flushMove, onAnchorsCommit, onPanelMoved],
  )

  const onPointerDown = useCallback(
    (id: ModuleId, e: PointerEvent) => {
      if (!editable) return
      // WFHelper: left or right drag; left must not swallow real controls
      if (e.button !== 0 && e.button !== 2) return
      if (e.button === 0 && isNoDragTarget(e.target)) return

      e.preventDefault()
      e.stopPropagation()
      const { scaleX, scaleY } = stageScale()
      dragRef.current = {
        id,
        button: e.button,
        lastScreenX: e.screenX,
        lastScreenY: e.screenY,
        pendingDx: 0,
        pendingDy: 0,
        scaleX,
        scaleY,
        moved: false,
      }
      setDragging(id)
      document.documentElement.classList.add('is-overlay-dragging')
      ;(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId)
    },
    [editable, stageScale],
  )

  const onPointerMove = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag || !editable) return
      const buttonMask = drag.button === 0 ? 1 : 2
      if ((e.buttons & buttonMask) === 0) {
        stopDragging(true)
        return
      }

      drag.pendingDx += e.screenX - drag.lastScreenX
      drag.pendingDy += e.screenY - drag.lastScreenY
      drag.lastScreenX = e.screenX
      drag.lastScreenY = e.screenY
      scheduleFlush()
    },
    [editable, scheduleFlush, stopDragging],
  )

  const onPointerUp = useCallback(
    (e: PointerEvent) => {
      const drag = dragRef.current
      if (!drag) return
      if (e.button === drag.button) stopDragging(true)
    },
    [stopDragging],
  )

  useEffect(() => {
    if (!editable) return
    const onContextMenu = (event: Event) => {
      event.preventDefault()
    }
    const onBlur = () => stopDragging(true)
    document.addEventListener('contextmenu', onContextMenu)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('contextmenu', onContextMenu)
      window.removeEventListener('blur', onBlur)
    }
  }, [editable, stopDragging])

  const panel = useMemo(() => {
    const render = (id: ModuleId) => {
      const op = resolveOpacity(id, moduleOpacity, opacity)
      switch (id) {
        case 'cycles':
          return <CyclesPanel cycles={data.cycles} opacity={op} compact />
        case 'fissures':
          return (
            <FissuresPanel
              fissures={data.fissures}
              tiers={fissureTiers}
              pathMode={fissurePathMode}
              showStorms={fissureShowStorms}
              sort={fissureSort}
              opacity={op}
              compact
            />
          )
        case 'baro':
          return (
            <BaroPanel
              baro={data.baro}
              wishlist={baroWishlist}
              playerDucats={playerDucats}
              playerCredits={playerCredits}
              dumpableDucats={dumpableDucats}
              opacity={op}
              compact
            />
          )
        case 'nightwave':
          return (
            <NightwavePanel
              nightwave={data.nightwave}
              doneIds={nightwaveDoneIds}
              opacity={op}
              compact
            />
          )
        case 'relics':
          return (
            <RelicsPanel
              opacity={op}
              compact
              previewMode={mode === 'preview'}
              previewRewards={relicPreviewRewards}
              layoutWidth={mode === 'preview' ? designWidth : undefined}
            />
          )
        case 'arbitration':
          return <ArbitrationPanel arbitration={data.arbitration} opacity={op} />
        case 'invasions':
          return <InvasionsPanel invasions={data.invasions} opacity={op} compact />
        case 'archon':
          return <ArchonPanel archonHunt={data.archonHunt} opacity={op} compact />
        case 'deepArchimedea':
          return (
            <DeepArchimedeaPanel
              deepArchimedea={data.deepArchimedea}
              opacity={op}
              compact
            />
          )
        case 'rivens':
          return (
            <RivenPanel
              opacity={op}
              compact
              previewMode={mode === 'preview'}
              previewState={rivenPreviewState}
              layoutWidth={mode === 'preview' ? designWidth : undefined}
              layoutHeight={mode === 'preview' ? designHeight : undefined}
            />
          )
        case 'relicRecommend':
          if (mode === 'preview') {
            return (
              <Panel title="Relic Recommend" subtitle="Preview stub" opacity={op}>
                <p className="mod-empty" style={{ margin: 0 }}>
                  Lith G2 · Meso N11 · Neo A7
                </p>
              </Panel>
            )
          }
          return <RelicRecommendPanel opacity={op} compact />
        default:
          return null
      }
    }
    return render
  }, [
    data,
    opacity,
    moduleOpacity,
    fissureTiers,
    fissurePathMode,
    fissureShowStorms,
    fissureSort,
    baroWishlist,
    nightwaveDoneIds,
    mode,
    relicPreviewRewards,
    rivenPreviewState,
    designWidth,
    designHeight,
  ])

  const stageStyle =
    mode === 'preview'
      ? {
          width: designWidth,
          height: designHeight,
        }
      : undefined

  return (
    <div
      ref={stageRef}
      className={`overlay-layout-stage overlay-root ${editable ? 'layout-edit is-overlay-interactive' : ''} is-${mode}`}
      style={stageStyle}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={() => stopDragging(true)}
    >
      {mode === 'preview' ? (
        <div className="overlay-layout-stage__chrome" aria-hidden>
          <span>Mock display · {designWidth}×{designHeight}</span>
        </div>
      ) : null}

      {dragHint ? <div className="overlay-drag-hint">{dragHint}</div> : null}

      {showOcrGuides && ocrScanRegions && onOcrScanRegionsChange && onOcrScanRegionsCommit ? (
        <OcrScanGuides
          width={mode === 'preview' ? designWidth : typeof window !== 'undefined' ? window.innerWidth : designWidth}
          height={
            mode === 'preview'
              ? designHeight
              : typeof window !== 'undefined'
                ? window.innerHeight
                : designHeight
          }
          regions={ocrScanRegions}
          editable={ocrGuidesEditable}
          onChange={onOcrScanRegionsChange}
          onCommit={onOcrScanRegionsCommit}
        />
      ) : null}

      {modules.length === 0 ? (
        <div className="overlay-empty">
          No modules to show. Enable modules under Modules, or turn on “Show all modules” here.
        </div>
      ) : null}

      {modules.map((id) => {
        const anchor = anchors[id] || { x: 24, y: 24 }
        const ocrBusy = relicScanning || rivenScanning
        const isOcrPanel = id === 'relics' || id === 'rivens'
        const dimmed = ocrBusy && !isOcrPanel && !editable
        return (
          <div
            key={id}
            className={`overlay-panel ${editable ? 'is-draggable' : ''} ${
              dragging === id ? 'is-dragging' : ''
            } ${dimmed ? 'is-ocr-dim' : ''}`}
            style={{
              left: anchor.x,
              top: anchor.y,
              zIndex: dragging === id ? 20 : isOcrPanel && ocrBusy ? 15 : 1,
              transform: overlayScale !== 1 ? `scale(${overlayScale})` : undefined,
              transformOrigin: 'top left',
            }}
            onPointerDown={(e) => onPointerDown(id, e)}
          >
            {editable || (id !== 'relics' && id !== 'rivens') ? (
              <div className="overlay-panel__badge">{id}</div>
            ) : null}
            {panel(id)}
          </div>
        )
      })}

      {hint ? <div className="overlay-hint">{hint}</div> : null}
    </div>
  )
}
