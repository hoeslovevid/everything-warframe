import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import { RivenScanState } from '../../shared/types'
import { recognizeRivenBlocks, recognizeRivenStatsFast, warmupOcr } from './ocr'
import { sampleOcrUiScore, waitForOcrUiReady } from './ocr-readiness'
import { parseRivenOcr, recommendRolls } from './riven-grader'
import { enrichRivensWithMarket } from './riven-market'
import {
  ensurePersistentCapture,
  isPersistentCaptureLive,
} from './persistent-screen-capture'
import { captureRivenCompare } from './screen-capture'
import { recordRivenScan, updateRivenHistoryPrices } from './riven-history'

function saveRivenDebugCrops(crops: Buffer[], label: string, fullPng?: Buffer) {
  void (async () => {
    try {
      const dir = path.join(app.getPath('userData'), 'riven-debug')
      await fs.promises.mkdir(dir, { recursive: true })
      const stamp = new Date().toISOString().replace(/[:.]/g, '-')
      await Promise.all(
        crops.map((buf, i) => {
          const side = i === 0 ? 'current' : 'reroll'
          return fs.promises.writeFile(path.join(dir, `${stamp}-${label}-${side}.png`), buf)
        }),
      )
      if (fullPng?.length) {
        await fs.promises.writeFile(path.join(dir, `${stamp}-${label}-full.png`), fullPng)
      }
      console.info(`[Everything Warframe] Saved riven debug crops → ${dir}`)
    } catch (err) {
      console.warn('[Everything Warframe] Could not save riven debug crops', err)
    }
  })()
}

type Listener = (state: RivenScanState) => void

const listeners = new Set<Listener>()
const AUTO_HIDE_MS = 90_000
const AUTO_HIDE_ERROR_MS = 15_000

/** Below this UI score the Cycle compare screen is treated as gone. */
const RIVEN_GONE_SCORE = 0.25
/** Consecutive low-score samples before auto-dismiss (~1.2s at 400ms). */
const RIVEN_GONE_HITS = 3
const RIVEN_GONE_POLL_MS = 400

let hideTimer: NodeJS.Timeout | null = null
let screenWatchTimer: NodeJS.Timeout | null = null
let screenGoneHits = 0
let screenWatchBusy = false

let state: RivenScanState = {
  active: false,
  scanning: false,
  scannedAt: '',
  trigger: 'none',
  error: null,
  current: null,
  reroll: null,
  recommendation: 'none',
  recommendationNote: null,
}

function emit() {
  for (const cb of listeners) cb(state)
}

function stopRivenScreenWatch() {
  if (screenWatchTimer) {
    clearInterval(screenWatchTimer)
    screenWatchTimer = null
  }
  screenGoneHits = 0
  screenWatchBusy = false
}

/**
 * After a successful grade, poll until the Cycle compare UI leaves the screen,
 * then clear the overlay (same idea as EE.log relic_rewards_end).
 */
function startRivenScreenWatch() {
  stopRivenScreenWatch()
  screenWatchTimer = setInterval(() => {
    if (!state.active || state.scanning) return
    if (screenWatchBusy) return
    screenWatchBusy = true
    void (async () => {
      try {
        const score = await sampleOcrUiScore('riven')
        if (score == null) return
        if (score < RIVEN_GONE_SCORE) {
          screenGoneHits += 1
          if (screenGoneHits >= RIVEN_GONE_HITS) {
            console.info(
              `[Everything Warframe] Riven compare UI gone (score=${score.toFixed(2)}) — dismissing overlay`,
            )
            stopRivenScreenWatch()
            clearRivenScan()
          }
        } else {
          screenGoneHits = 0
        }
      } catch {
        // Transient capture blips — don't count as gone.
      } finally {
        screenWatchBusy = false
      }
    })()
  }, RIVEN_GONE_POLL_MS)
}

function cancelHide() {
  if (hideTimer) {
    clearTimeout(hideTimer)
    hideTimer = null
  }
}

function scheduleHide(ms: number) {
  cancelHide()
  hideTimer = setTimeout(() => {
    hideTimer = null
    clearRivenScan()
  }, ms)
}

export function getRivenScanState(): RivenScanState {
  return state
}

export function onRivenScanUpdated(cb: Listener) {
  listeners.add(cb)
  return () => listeners.delete(cb)
}

export function clearRivenScan(): RivenScanState {
  cancelHide()
  stopRivenScreenWatch()
  state = {
    active: false,
    scanning: false,
    scannedAt: '',
    trigger: 'none',
    error: null,
    current: null,
    reroll: null,
    recommendation: 'none',
    recommendationNote: null,
  }
  emit()
  return state
}

export async function warmupRivenScanner(): Promise<void> {
  await warmupOcr().catch(() => {})
}

export async function scanRivens(trigger: 'manual' | 'log' = 'manual'): Promise<RivenScanState> {
  if (state.scanning) return state
  cancelHide()
  stopRivenScreenWatch()

  // Keep the grader popup active while scanning (same as relics) so the hotkey
  // shows “Reading…” immediately. Capture still pauses/hides the overlay window.
  state = {
    ...state,
    scanning: true,
    active: true,
    trigger,
    error: null,
    current: null,
    reroll: null,
    recommendation: 'none',
    recommendationNote: null,
  }
  emit()

  const applyPartial = (
    current: ReturnType<typeof parseRivenOcr> | null,
    reroll: ReturnType<typeof parseRivenOcr> | null,
  ) => {
    if (!current && !reroll) return
    const reco = recommendRolls(current, reroll)
    state = {
      ...state,
      scanning: true,
      active: true,
      error: null,
      current,
      reroll,
      recommendation: reco.recommendation,
      recommendationNote: reco.note,
    }
    emit()
  }

  try {
    // Warm persistent capture when cold — no artificial settle when already live.
    if (!isPersistentCaptureLive()) {
      await ensurePersistentCapture().catch(() => false)
    }

    if (trigger === 'log') {
      // Live stream: skip multi-sample readiness (full-frame encode was ~4s).
      // Cold stream: short readiness poll on scaled JPEGs.
      if (isPersistentCaptureLive()) {
        // Stream already live — no settle delay.
      } else {
        await waitForOcrUiReady('riven', { maxMs: process.platform === 'linux' ? 700 : 400 })
      }
    }

    const capture = await captureRivenCompare()
    if (!capture || capture.crops.length < 2) {
      throw new Error(
        process.platform === 'linux'
          ? 'Could not capture riven cards. Allow the screen-share dialog once and leave it on, then scan again (Borderless Windowed).'
          : 'Could not capture riven cards. Use Borderless Windowed, then scan again.',
      )
    }
    let crops = capture.crops

    // Fast path: tiny name + per-stat line OCR (Tesseract SINGLE_LINE pool).
    let texts = await recognizeRivenStatsFast(crops)
    console.info(
      '[Everything Warframe] Riven OCR fast current:\n' + (texts[0] || '(empty)').slice(0, 400),
    )
    console.info(
      '[Everything Warframe] Riven OCR fast reroll:\n' + (texts[1] || '(empty)').slice(0, 400),
    )
    let left = parseRivenOcr(texts[0] || '', 'current')
    let right = parseRivenOcr(texts[1] || '', 'reroll')
    let leftOk = left.stats.length > 0
    let rightOk = right.stats.length > 0
    console.info(
      `[Everything Warframe] Riven parse fast: current=${left.stats.length} stats (${left.weapon}), ` +
        `reroll=${right.stats.length} stats (${right.weapon})`,
    )

    if (leftOk || rightOk) {
      applyPartial(leftOk ? left : null, rightOk ? right : null)
    }

    // Deep only when a side has fewer than 2 parsed stats.
    const leftWeak = left.stats.length < 2
    const rightWeak = right.stats.length < 2

    if (leftWeak || rightWeak) {
      console.info(
        `[Everything Warframe] Riven OCR deep starting (weak: current=${leftWeak} reroll=${rightWeak})`,
      )
      const deepInputs: Buffer[] = []
      const deepSides: Array<'current' | 'reroll'> = []
      if (leftWeak) {
        deepInputs.push(crops[0])
        deepSides.push('current')
      }
      if (rightWeak) {
        deepInputs.push(crops[1])
        deepSides.push('reroll')
      }
      const deepTexts = await recognizeRivenBlocks(deepInputs, { deep: true })
      deepSides.forEach((side, i) => {
        const parsed = parseRivenOcr(deepTexts[i] || '', side)
        if (side === 'current' && parsed.stats.length >= left.stats.length) {
          left = parsed
          texts[0] = deepTexts[i] || texts[0]
        }
        if (side === 'reroll' && parsed.stats.length >= right.stats.length) {
          right = parsed
          texts[1] = deepTexts[i] || texts[1]
        }
      })
      leftOk = left.stats.length > 0
      rightOk = right.stats.length > 0
      console.info(
        `[Everything Warframe] Riven deep OCR: current=${left.stats.length} stats, reroll=${right.stats.length} stats`,
      )
      if (leftOk || rightOk) {
        applyPartial(leftOk ? left : null, rightOk ? right : null)
      }
    }

    // One recapture only if both sides are empty — never a full deep cascade again.
    if (!leftOk && !rightOk) {
      saveRivenDebugCrops(crops, 'weak', capture.fullPng)
      await new Promise((r) => setTimeout(r, process.platform === 'linux' ? 200 : 80))
      const retry = await captureRivenCompare()
      if (retry && retry.crops.length >= 2) {
        const retryTexts = await recognizeRivenStatsFast(retry.crops)
        console.info(
          '[Everything Warframe] Riven OCR retry current:\n' +
            (retryTexts[0] || '(empty)').slice(0, 400),
        )
        console.info(
          '[Everything Warframe] Riven OCR retry reroll:\n' +
            (retryTexts[1] || '(empty)').slice(0, 400),
        )
        const retryLeft = parseRivenOcr(retryTexts[0] || '', 'current')
        const retryRight = parseRivenOcr(retryTexts[1] || '', 'reroll')
        if (retryLeft.stats.length >= left.stats.length) left = retryLeft
        if (retryRight.stats.length >= right.stats.length) right = retryRight
        leftOk = left.stats.length > 0
        rightOk = right.stats.length > 0
        texts = retryTexts
        crops = retry.crops
        if (!leftOk && !rightOk) {
          saveRivenDebugCrops(retry.crops, 'retry', retry.fullPng)
        }
      }
    } else if (left.stats.length < 2 || right.stats.length < 2) {
      saveRivenDebugCrops(crops, 'weak', capture.fullPng)
    }

    if (!leftOk && !rightOk) {
      const sample = [texts[0], texts[1]].filter(Boolean).join(' | ').slice(0, 120)
      throw new Error(
        sample
          ? `No riven stats read (OCR: ${sample}). Open the Cycle compare screen, then scan again.`
          : 'No riven stats read. Open the Cycle compare screen (current vs new), then scan again.',
      )
    }

    // Left crop = current, right crop = reroll (Kuva Cycle layout).
    const current = leftOk ? left : state.current
    const reroll = rightOk ? right : leftOk && !rightOk ? null : right

    if (current && reroll) {
      // Only share the gun base name — never copy Latin riven titles across sides.
      const baseOf = (weapon: string) =>
        weapon.replace(/\s+[A-Za-z]{3,}-[a-z]{3,}\s*$/i, '').trim()
      if (current.weapon === 'Unknown Riven') {
        const base = baseOf(reroll.weapon)
        if (base && base !== 'Unknown Riven') current.weapon = base
      }
      if (reroll.weapon === 'Unknown Riven') {
        const base = baseOf(current.weapon)
        if (base && base !== 'Unknown Riven') reroll.weapon = base
      }
    }

    // Market is optional — show grades first, then refresh with plat estimates.
    const scannedAt = new Date().toISOString()
    const reco = recommendRolls(current, reroll)
    state = {
      active: true,
      scanning: false,
      scannedAt,
      trigger,
      error: null,
      current,
      reroll,
      recommendation: reco.recommendation,
      recommendationNote: reco.note,
    }
    emit()
    scheduleHide(AUTO_HIDE_MS)
    startRivenScreenWatch()
    recordRivenScan(state)

    try {
      const priced = await enrichRivensWithMarket(current, reroll)
      if (state.scannedAt === scannedAt && state.active && !state.scanning) {
        const pricedReco = recommendRolls(priced.current, priced.reroll)
        state = {
          ...state,
          current: priced.current,
          reroll: priced.reroll,
          recommendation: pricedReco.recommendation,
          recommendationNote: pricedReco.note,
        }
        emit()
        updateRivenHistoryPrices(state)
      }
    } catch (err) {
      console.warn('[Everything Warframe] Riven market enrich failed', err)
    }

    return state
  } catch (err) {
    state = {
      ...state,
      scanning: false,
      active: true,
      error: err instanceof Error ? err.message : 'Riven scan failed',
    }
    emit()
    scheduleHide(AUTO_HIDE_ERROR_MS)
    startRivenScreenWatch()
    return state
  }
}
