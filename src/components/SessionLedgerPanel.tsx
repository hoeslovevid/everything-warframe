import { useCallback, useEffect, useState } from 'react'
import type { SessionLedgerSnapshot } from '../../shared/types'
import { resolveUiLocale, t } from '../lib/i18n'
import { formatSessionLedgerSummary } from '../lib/sessionLedger'
import { copyText } from '../lib/tradeClipboard'
import { pushToast } from '../lib/toast'
import { Panel } from './Panel'

const empty: SessionLedgerSnapshot = {
  startedAt: new Date().toISOString(),
  haul: {
    startedAt: '',
    relicScans: 0,
    relicHits: [],
    neededParts: 0,
    platEstimate: 0,
    inventoryAdded: [],
    inventoryChanged: [],
    lastSyncAt: null,
  },
  trades: { soldPlat: 0, boughtPlat: 0, netPlat: 0, count: 0 },
  rivens: { scans: 0, lastWeapon: null },
  arbitration: { runs: 0, vitus: 0, rareDrops: 0 },
}

function fmt(n: number) {
  return n.toLocaleString()
}

type Props = {
  onClearHaul?: () => void
  uiLocale?: 'system' | 'en' | 'es' | 'fr' | 'de' | 'pt' | 'ru' | 'zh'
}

export function SessionLedgerPanel({ onClearHaul, uiLocale = 'system' }: Props) {
  const [ledger, setLedger] = useState<SessionLedgerSnapshot>(empty)
  const locale = resolveUiLocale(uiLocale)

  const refresh = useCallback(async () => {
    if (!window.voidlens?.getSessionLedger) return
    setLedger(await window.voidlens.getSessionLedger())
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), 30_000)
    return () => window.clearInterval(id)
  }, [refresh])

  const started = ledger.startedAt
    ? new Date(ledger.startedAt).toLocaleTimeString()
    : '—'

  const endSession = async () => {
    const summary = formatSessionLedgerSummary(ledger)
    const ok = await copyText(summary)
    onClearHaul?.()
    await refresh()
    pushToast(
      ok ? t(locale, 'sessionLedger.copied') : 'Copy failed — haul still cleared',
      ok ? 'ok' : 'warn',
      4500,
    )
  }

  return (
    <Panel
      title={t(locale, 'sessionLedger.title')}
      subtitle={`${t(locale, 'sessionLedger.subtitle')} · ${started}`}
      actions={
        <>
          <button className="btn ghost" type="button" onClick={() => void refresh()}>
            {t(locale, 'common.refresh')}
          </button>
          <button className="btn primary" type="button" onClick={() => void endSession()}>
            {t(locale, 'sessionLedger.endSession')}
          </button>
          {onClearHaul ? (
            <button
              className="btn ghost"
              type="button"
              onClick={() => {
                onClearHaul()
                void refresh()
              }}
            >
              {t(locale, 'common.clear')}
            </button>
          ) : null}
        </>
      }
    >
      <div className="economy-grid">
        <div>
          <div className="muted" style={{ fontSize: '0.72rem' }}>
            Relic scans
          </div>
          <strong>{ledger.haul.relicScans}</strong>
          <div className="muted">
            {ledger.haul.neededParts} needed · ~{fmt(ledger.haul.platEstimate)}p seen
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: '0.72rem' }}>
            Trades
          </div>
          <strong>
            {ledger.trades.netPlat >= 0 ? '+' : ''}
            {fmt(ledger.trades.netPlat)}p
          </strong>
          <div className="muted">
            {ledger.trades.count} · sold {fmt(ledger.trades.soldPlat)} / bought{' '}
            {fmt(ledger.trades.boughtPlat)}
          </div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: '0.72rem' }}>
            Rivens
          </div>
          <strong>{ledger.rivens.scans}</strong>
          <div className="muted">{ledger.rivens.lastWeapon || '—'}</div>
        </div>
        <div>
          <div className="muted" style={{ fontSize: '0.72rem' }}>
            Arbitration
          </div>
          <strong>{ledger.arbitration.vitus} Vitus</strong>
          <div className="muted">
            {ledger.arbitration.runs} runs · {ledger.arbitration.rareDrops} rare
          </div>
        </div>
      </div>
    </Panel>
  )
}
