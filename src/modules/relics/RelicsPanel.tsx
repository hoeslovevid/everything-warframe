import { useMemo, useState } from 'react'
import { relicStripLayout } from '../../../shared/captureGeometry'
import { RewardEval } from '../../../shared/types'
import { Panel } from '../../components/Panel'
import { useRelicScan } from '../../hooks/useRelicScan'
import { useSettings } from '../../hooks/useVoidLens'
import { copyText, formatBestPickTradeLine, formatRelicTradeLine } from '../../lib/tradeClipboard'
import { pushToast } from '../../lib/toast'
import '../cycles/module.css'
import '../baro/baro.css'
import './relics.css'

type DeepLinkTarget = 'sets' | 'foundry' | 'market' | 'lfg'

type Props = {
  opacity?: number
  compact?: boolean
  previewMode?: boolean
  previewRewards?: RewardEval[]
  scanHotkey?: string
  dismissHotkey?: string
  layoutWidth?: number
  onDeepLink?: (target: DeepLinkTarget, query: string) => void
}

function stripWidthPx(layoutWidth?: number) {
  const ref =
    layoutWidth && layoutWidth > 0
      ? layoutWidth
      : typeof window !== 'undefined'
        ? window.innerWidth || 1920
        : 1920
  return relicStripLayout(ref, Math.round((ref * 9) / 16)).width
}

function ownershipLabel(reward: RewardEval, compact?: boolean) {
  if (!reward.setName) {
    return reward.owned > 0 ? `Owned ×${reward.owned}` : 'Unmatched'
  }
  if (reward.needed || reward.owned <= 0) {
    if (reward.setTotalParts > 0) {
      return compact
        ? `Needed · ${reward.setOwnedParts}/${reward.setTotalParts}`
        : `Needed for set · ${reward.setOwnedParts}/${reward.setTotalParts}`
    }
    return compact ? 'Needed' : 'Needed for set'
  }
  if (reward.setTotalParts > 0 && reward.setOwnedParts >= reward.setTotalParts) {
    return compact ? 'Complete' : `Owned ×${reward.owned} · Set complete`
  }
  if (compact && reward.setTotalParts > 0) {
    return `Owned ×${reward.owned} · ${reward.setOwnedParts}/${reward.setTotalParts}`
  }
  return `Owned ×${reward.owned}`
}

function marketUrlFor(name: string) {
  const slug = name
    .toLowerCase()
    .replace(/['']/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_|_$/g, '')
  return `https://warframe.market/items/${slug}`
}

function RewardCard({
  reward,
  compact,
  onOpenMarket,
  onDeepLink,
}: {
  reward: RewardEval
  compact?: boolean
  onOpenMarket?: (name: string) => void
  onDeepLink?: (target: DeepLinkTarget, query: string) => void
}) {
  const needed = reward.needed
  const lowConf = reward.matchScore > 0 && reward.matchScore < 0.55
  const priceBits: string[] = []
  if (reward.platinum != null) {
    priceBits.push(`~${reward.platinum}p`)
    if (reward.volume != null) priceBits.push(`${reward.volume} sells`)
  }
  if (reward.ducats != null) priceBits.push(`${reward.ducats}d`)
  const linkQuery = reward.setName || reward.name
  return (
    <li
      className={`relic-card ${needed ? 'is-needed' : ''} ${reward.bestPick ? 'is-best' : ''} ${
        lowConf ? 'is-low-conf' : ''
      } ${reward.vaulted ? 'is-vaulted' : ''}`}
    >
      <div className="relic-card__tags">
        {reward.bestPick ? <span className="relic-card__tag is-best">Best</span> : null}
        {needed ? (
          <span className="relic-card__tag is-needed">{compact ? 'Needed' : 'Needed for set'}</span>
        ) : null}
        {reward.vaulted ? <span className="relic-card__tag is-vaulted">Vaulted</span> : null}
      </div>
      {!compact ? <div className="relic-card__slot">Slot {reward.slot + 1}</div> : null}
      <div className="relic-card__name">{reward.name || 'Unknown'}</div>
      {reward.setName ? (
        <div className="relic-card__set">
          {reward.setName}
          {reward.partName ? ` · ${reward.partName}` : ''}
        </div>
      ) : (
        <div className="relic-card__set">{compact ? '—' : 'Non-set / unmatched'}</div>
      )}
      <div className={`relic-card__owned ${needed ? 'is-needed' : ''}`}>
        {ownershipLabel(reward, compact)}
      </div>
      {priceBits.length ? <div className="relic-card__meta">{priceBits.join(' · ')}</div> : null}
      {lowConf ? <div className="relic-card__meta">Low OCR confidence</div> : null}
      {!compact && reward.setTotalParts > 0 ? (
        <div className="relic-card__progress">
          Set parts owned {reward.setOwnedParts}/{reward.setTotalParts}
        </div>
      ) : null}
      {!compact && reward.name ? (
        <div className="relic-card__actions">
          {reward.setName ? (
            <button
              type="button"
              className="btn ghost"
              style={{ fontSize: '0.7rem', padding: '2px 8px' }}
              onClick={() => onDeepLink?.('sets', reward.setName!)}
            >
              Sets
            </button>
          ) : null}
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: '0.7rem', padding: '2px 8px' }}
            onClick={() => onDeepLink?.('foundry', linkQuery)}
          >
            Foundry
          </button>
          <button
            type="button"
            className="btn ghost"
            style={{ fontSize: '0.7rem', padding: '2px 8px' }}
            onClick={() => {
              if (onDeepLink) onDeepLink('market', reward.name)
              else onOpenMarket?.(reward.name)
            }}
          >
            Market
          </button>
          {linkQuery ? (
            <button
              type="button"
              className="btn ghost"
              style={{ fontSize: '0.7rem', padding: '2px 8px' }}
              onClick={() => onDeepLink?.('lfg', linkQuery)}
            >
              LFG
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  )
}

function RewardRow({
  rewards,
  compact,
  onOpenMarket,
  onDeepLink,
}: {
  rewards: RewardEval[]
  compact?: boolean
  onOpenMarket?: (name: string) => void
  onDeepLink?: (target: DeepLinkTarget, query: string) => void
}) {
  const cols = Math.min(4, Math.max(1, rewards.length))
  return (
    <ul
      className={`relic-grid ${compact ? 'is-strip' : 'is-dashboard'}`}
      style={compact ? { gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` } : undefined}
    >
      {rewards.map((reward) => (
        <RewardCard
          key={reward.slot}
          reward={reward}
          compact={compact}
          onOpenMarket={onOpenMarket}
          onDeepLink={onDeepLink}
        />
      ))}
    </ul>
  )
}

export function RelicsPanel({
  opacity = 0.92,
  compact,
  previewMode,
  previewRewards,
  scanHotkey = 'Alt+Shift+F',
  dismissHotkey = 'Alt+Shift+D',
  layoutWidth,
  onDeepLink,
}: Props) {
  const { state, scan, clear } = useRelicScan()
  const { settings, updateSettings } = useSettings()
  const rewards = previewMode && previewRewards ? previewRewards : state.rewards
  const scanning = previewMode ? false : state.scanning
  const stripW = stripWidthPx(layoutWidth)
  const [copied, setCopied] = useState(false)

  const weakScan = useMemo(() => {
    if (scanning || previewMode || !rewards.length) return false
    const unmatched = rewards.filter((r) => !r.name || r.matchScore < 0.45).length
    return unmatched >= Math.ceil(rewards.length / 2) || Boolean(state.error)
  }, [rewards, scanning, previewMode, state.error])

  const copyTrade = async (bestOnly = false) => {
    const text = bestOnly ? formatBestPickTradeLine(rewards) : formatRelicTradeLine(rewards)
    if (!(await copyText(text))) return
    setCopied(true)
    pushToast(bestOnly ? 'Copied Best pick WTS' : 'Copied trade lines', 'ok')
    window.setTimeout(() => setCopied(false), 1600)
  }

  const openMarket = (name: string) => {
    void window.voidlens?.openExternal?.(marketUrlFor(name))
  }

  if (compact || previewMode) {
    const best = rewards.find((r) => r.bestPick && r.name)
    const showRecovery = !previewMode && !scanning && (weakScan || Boolean(state.error))
    return (
      <div className="relic-strip" style={{ opacity, width: stripW }} data-relic-strip>
        {scanning ? <p className="relic-strip__status">Scanning…</p> : null}
        {!previewMode && state.error ? (
          <p className="relic-strip__error">{state.error}</p>
        ) : null}
        {showRecovery ? (
          <div className="relic-strip__recovery">
            <p className="relic-strip__status">
              Weak OCR — retry, force slots, or reset monitor
            </p>
            <div className="relic-strip__next">
              <button
                type="button"
                className="btn primary"
                disabled={scanning}
                onClick={() => void scan()}
              >
                Retry
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  void updateSettings({ relicSquadSizeOverride: 3 }).then(() => {
                    pushToast('Forced 3 reward slots', 'info')
                    void scan()
                  })
                }
              >
                Force 3
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  void updateSettings({ relicSquadSizeOverride: 4 }).then(() => {
                    pushToast('Forced 4 reward slots', 'info')
                    void scan()
                  })
                }
              >
                Force 4
              </button>
              <button
                type="button"
                className="btn ghost"
                onClick={() =>
                  void updateSettings({ ocrDisplayId: null }).then(() =>
                    pushToast('OCR display reset — retry scan', 'info'),
                  )
                }
              >
                Reset monitor
              </button>
            </div>
          </div>
        ) : null}
        {rewards.length > 0 ? (
          <>
            <RewardRow rewards={rewards} compact />
            {best && !scanning && !showRecovery ? (
              <div className="relic-strip__next">
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => void copyTrade(true)}
                  title="Copy Best pick WTS"
                >
                  Copy WTS
                </button>
                <button
                  type="button"
                  className="btn ghost"
                  onClick={() => openMarket(best.name)}
                  title="Open Best pick on warframe.market"
                >
                  Market
                </button>
                <button type="button" className="btn ghost" onClick={() => void scan()}>
                  Retry
                </button>
              </div>
            ) : null}
          </>
        ) : scanning || showRecovery ? null : (
          <p className="relic-strip__status">Waiting for rewards</p>
        )}
      </div>
    )
  }

  return (
    <Panel
      title="Relic Rewards"
      subtitle={
        scanning
          ? 'Scanning…'
          : rewards.length
            ? `${rewards.length} rewards · ready`
            : 'Waiting for reward screen'
      }
      opacity={opacity}
      className="baro-panel--wide"
      actions={
        <>
          <button className="btn primary" disabled={scanning} onClick={() => void scan()}>
            Scan now
          </button>
          <button
            className="btn ghost"
            disabled={!rewards.length}
            onClick={() => void copyTrade(false)}
            title="Copy WTS/WTB lines for trade chat"
          >
            {copied ? 'Copied' : 'Copy trade'}
          </button>
          <button
            className="btn ghost"
            disabled={!rewards.length}
            onClick={() => void copyTrade(true)}
            title="Copy Best pick only"
          >
            Best pick
          </button>
          <button className="btn ghost" disabled={!rewards.length} onClick={() => void clear()}>
            Clear
          </button>
        </>
      }
    >
      <div className="mod-stack">
        {!state.inventoryLoaded ? (
          <p className="mod-empty">
            Sync inventory in Settings for “needed for set” tags. Scanning still works without it.
          </p>
        ) : null}
        {state.error ? <p className="mod-empty">Error: {state.error}</p> : null}
        {weakScan ? (
          <div className="getting-started" style={{ padding: '10px 12px', marginBottom: 8 }}>
            <p className="getting-started__sub" style={{ margin: '0 0 8px' }}>
              Weak OCR read — retry, check monitor, or force slot count.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button className="btn primary" disabled={scanning} onClick={() => void scan()}>
                Retry scan
              </button>
              <button
                className="btn ghost"
                onClick={() =>
                  void updateSettings({
                    ocrDisplayId: null,
                  }).then(() => pushToast('OCR display reset to primary — retry scan', 'info'))
                }
              >
                Reset monitor
              </button>
              <button
                className="btn ghost"
                onClick={() =>
                  void updateSettings({ relicSquadSizeOverride: 3 }).then(() => {
                    pushToast('Forced 3 reward slots', 'info')
                    void scan()
                  })
                }
              >
                Force 3 slots
              </button>
              <button
                className="btn ghost"
                onClick={() =>
                  void updateSettings({ relicSquadSizeOverride: 4 }).then(() => {
                    pushToast('Forced 4 reward slots', 'info')
                    void scan()
                  })
                }
              >
                Force 4 slots
              </button>
              <button
                className="btn ghost"
                onClick={() =>
                  void updateSettings({ relicSquadSizeOverride: null }).then(() =>
                    pushToast('Slot override cleared', 'info'),
                  )
                }
              >
                Auto slots
              </button>
            </div>
            {state.scanMeta ? (
              <p className="mod-empty" style={{ fontSize: '0.72rem', marginTop: 8 }}>
                Last: theme {state.scanMeta.theme || '—'}
                {state.scanMeta.slotHint != null ? ` · ${state.scanMeta.slotHint} slots` : ''}
                {settings.ocrDisplayId != null ? ` · display ${settings.ocrDisplayId}` : ''}
              </p>
            ) : null}
          </div>
        ) : null}
        {state.scanMeta && !scanning && !weakScan ? (
          <p className="mod-empty" style={{ fontSize: '0.75rem', margin: 0 }}>
            OCR: theme {state.scanMeta.theme || '—'}
            {state.scanMeta.slotHint != null ? ` · ${state.scanMeta.slotHint} slots` : ''}
            {state.scanMeta.formaSlots ? ` · ${state.scanMeta.formaSlots} Forma` : ''}
            {' · '}
            tweak theme / slots in Settings if names look wrong
          </p>
        ) : null}
        {rewards.length === 0 && !scanning ? (
          <div className="mod-stack">
            <p className="mod-empty">
              Popup appears on fissure reward detect. Scan: <strong>{scanHotkey}</strong> · Dismiss:{' '}
              <strong>{dismissHotkey}</strong>. Place the strip in Layout.
            </p>
            <button className="btn primary" disabled={scanning} onClick={() => void scan()}>
              Scan reward screen
            </button>
          </div>
        ) : (
          <RewardRow rewards={rewards} onOpenMarket={openMarket} onDeepLink={onDeepLink} />
        )}
      </div>
    </Panel>
  )
}
