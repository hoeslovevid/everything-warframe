import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppSettings, InventoryStatus, LfgListing, WorldstateSnapshot } from '../../shared/types'
import { copyText } from '../lib/tradeClipboard'
import { formatCountdown } from '../lib/time'
import { useSettings } from '../hooks/useVoidLens'
import './OverlayMissionStrip.css'

type Props = {
  settings: AppSettings
  data: WorldstateSnapshot
  inventory: InventoryStatus | null
  now?: number
  onSyncInventory?: () => void
  syncProgress?: string | null
  onToggleQuietFocus?: () => void
}

/**
 * Compact overlay cue: next useful fissure / inventory stale / Baro / open LFG seats /
 * hosted listing controls.
 */
export function OverlayMissionStrip({
  settings,
  data,
  inventory,
  now = Date.now(),
  onSyncInventory,
  syncProgress,
  onToggleQuietFocus,
}: Props) {
  const { updateSettings } = useSettings()
  const [lfgOpen, setLfgOpen] = useState<number | null>(null)
  const [hosted, setHosted] = useState<LfgListing | null>(null)
  const [busy, setBusy] = useState(false)
  const [whisperCopied, setWhisperCopied] = useState(false)

  const hostTokens = settings.lfgHostTokens || {}
  const hostIds = useMemo(() => Object.keys(hostTokens), [hostTokens])

  const refreshLfg = useCallback(async () => {
    if (!window.voidlens?.listLfg) return
    try {
      const res = await window.voidlens.listLfg({
        region: settings.lfgRegion || 'all',
        platform: settings.lfgPlatform || undefined,
        activity: 'all',
      })
      const listings = res.listings || []
      const open = listings.filter((l) => l.slotsOpen > 0).length
      setLfgOpen(open)
      const mine =
        listings.find((l) => hostIds.includes(l.id)) ||
        (settings.lfgIgn
          ? listings.find(
              (l) => l.hostIgn.trim().toLowerCase() === settings.lfgIgn.trim().toLowerCase(),
            )
          : undefined) ||
        null
      setHosted(mine)
    } catch {
      setLfgOpen(null)
      setHosted(null)
    }
  }, [settings.lfgRegion, settings.lfgPlatform, settings.lfgIgn, hostIds])

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      if (cancelled) return
      await refreshLfg()
    }
    void tick()
    const id = window.setInterval(() => void tick(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(id)
    }
  }, [refreshLfg])

  const copyWhisper = async () => {
    if (!hosted?.whisper) return
    if (!(await copyText(hosted.whisper))) return
    setWhisperCopied(true)
    window.setTimeout(() => setWhisperCopied(false), 1400)
  }

  const extendHosted = async () => {
    if (!hosted) return
    const token = hostTokens[hosted.id]
    if (!token || !window.voidlens?.extendLfg) return
    setBusy(true)
    try {
      await window.voidlens.extendLfg({
        id: hosted.id,
        hostToken: token,
        addMs: 10 * 60_000,
      })
      await refreshLfg()
    } finally {
      setBusy(false)
    }
  }

  const closeHosted = async () => {
    if (!hosted) return
    const token = hostTokens[hosted.id]
    if (!token || !window.voidlens?.deleteLfg) return
    setBusy(true)
    try {
      await window.voidlens.deleteLfg({ id: hosted.id, hostToken: token })
      const next = { ...hostTokens }
      delete next[hosted.id]
      await updateSettings({ lfgHostTokens: next })
      setHosted(null)
      await refreshLfg()
    } finally {
      setBusy(false)
    }
  }

  if (hosted && hostTokens[hosted.id]) {
    return (
      <div className="mission-strip mission-strip--host" role="status">
        <span className="mission-strip__badge">Hosting</span>
        <span className="mission-strip__text">
          {hosted.title}
          {' · '}
          {hosted.slotsOpen}/{hosted.slotsTotal} open
          {hosted.expiresAt ? ` · ${formatCountdown(hosted.expiresAt, now)}` : ''}
        </span>
        <button
          type="button"
          className="mission-strip__btn"
          disabled={busy}
          onClick={() => void copyWhisper()}
        >
          {whisperCopied ? 'Copied' : 'Whisper'}
        </button>
        <button
          type="button"
          className="mission-strip__btn"
          disabled={busy}
          onClick={() => void extendHosted()}
        >
          +10m
        </button>
        <button
          type="button"
          className="mission-strip__btn mission-strip__btn--danger"
          disabled={busy}
          onClick={() => void closeHosted()}
        >
          Close
        </button>
      </div>
    )
  }

  const bits: string[] = []
  let action: { label: string; run?: () => void } | null = null

  if (syncProgress) {
    bits.push(syncProgress)
  } else if (inventory?.consent && inventory.stale && inventory.warframeRunning) {
    bits.push('Inventory stale')
    action = { label: 'Sync', run: onSyncInventory }
  } else if (data.baro?.active) {
    bits.push(`Baro · ${data.baro.location || 'relay'}`)
    if (settings.baroWishlist.length) bits.push(`${settings.baroWishlist.length} wishlist`)
  } else {
    const tierSet = new Set(settings.fissureTiers.map((t) => t.toLowerCase()))
    const next = data.fissures
      .filter((f) => tierSet.has(f.tier.toLowerCase()))
      .filter((f) => {
        if (settings.fissurePathMode === 'steel') return f.isHard
        if (settings.fissurePathMode === 'normal') return !f.isHard
        return true
      })
      .filter((f) => settings.fissureShowStorms || !f.isStorm)
      .filter((f) => new Date(f.expiry).getTime() > now)
      .sort((a, b) => new Date(a.expiry).getTime() - new Date(b.expiry).getTime())[0]
    if (next) {
      bits.push(
        `${next.tier} ${next.missionType}${next.isHard ? ' SP' : ''} · ${formatCountdown(next.expiry, now)}`,
      )
    }
  }

  if (lfgOpen != null && lfgOpen > 0) {
    bits.push(`${lfgOpen} LFG open`)
  }

  if (settings.activePlayProfile) {
    bits.unshift(
      settings.activePlayProfile === 'fissure-grind'
        ? 'Relic farm'
        : settings.activePlayProfile === 'riven-farm'
          ? 'Riven farm'
          : settings.activePlayProfile === 'baro-day'
            ? 'Baro day'
            : settings.activePlayProfile === 'nightwave'
              ? 'Nightwave'
              : 'Open world',
    )
  }

  if (settings.quietFocusActive) {
    bits.unshift('Quiet')
  }

  if (!bits.length && !onToggleQuietFocus) return null

  return (
    <div
      className={`mission-strip${syncProgress ? ' mission-strip--syncing' : ''}`}
      role="status"
    >
      {bits.length ? <span className="mission-strip__text">{bits.join(' · ')}</span> : null}
      {action?.run ? (
        <button type="button" className="mission-strip__btn" onClick={action.run}>
          {action.label}
        </button>
      ) : null}
      {onToggleQuietFocus ? (
        <button
          type="button"
          className={`mission-strip__btn${settings.quietFocusActive ? ' mission-strip__btn--on' : ''}`}
          onClick={onToggleQuietFocus}
          title="Fissures + OCR only"
        >
          {settings.quietFocusActive ? 'Quiet on' : 'Quiet'}
        </button>
      ) : null}
    </div>
  )
}
