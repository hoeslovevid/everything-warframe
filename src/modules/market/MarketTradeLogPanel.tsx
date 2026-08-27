import { useCallback, useEffect, useState } from 'react'
import type { MarketTradeEntry, MarketTradeLogResult } from '../../../shared/types'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'

const empty: MarketTradeLogResult = {
  entries: [],
  soldPlat: 0,
  boughtPlat: 0,
  netPlat: 0,
  sessionStartedAt: new Date().toISOString(),
  sessionSoldPlat: 0,
  sessionBoughtPlat: 0,
  sessionNetPlat: 0,
}

export function MarketTradeLogPanel() {
  const [log, setLog] = useState<MarketTradeLogResult>(empty)
  const [nameDraft, setNameDraft] = useState('')
  const [platDraft, setPlatDraft] = useState('10')
  const [qtyDraft, setQtyDraft] = useState('1')
  const [side, setSide] = useState<'sell' | 'buy'>('sell')
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    if (!window.voidlens?.getMarketTradeLog) {
      setLog(empty)
      return
    }
    setLog(await window.voidlens.getMarketTradeLog())
  }, [])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const add = async () => {
    const itemName = nameDraft.trim()
    const platinum = Math.floor(Number(platDraft) || 0)
    const quantity = Math.max(1, Math.floor(Number(qtyDraft) || 1))
    if (!itemName || platinum < 1 || !window.voidlens?.addMarketTrade) return
    setBusy(true)
    try {
      setLog(await window.voidlens.addMarketTrade({ side, itemName, platinum, quantity }))
      setNameDraft('')
    } finally {
      setBusy(false)
    }
  }

  const remove = async (id: string) => {
    if (!window.voidlens?.removeMarketTrade) return
    setLog(await window.voidlens.removeMarketTrade(id))
  }

  const clear = async () => {
    if (!window.voidlens?.clearMarketTradeLog) return
    if (!window.confirm('Clear the entire trade log?')) return
    setLog(await window.voidlens.clearMarketTradeLog())
  }

  const formatWhen = (iso: string) => {
    try {
      return new Date(iso).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    } catch {
      return iso
    }
  }

  return (
    <Panel
      title="Trade log"
      subtitle="Mark sold / bought locally · simple plat P&L"
      actions={
        <div className="market-actions">
          <button className="btn ghost" type="button" onClick={() => void refresh()}>
            Refresh
          </button>
          {log.entries.length ? (
            <button className="btn ghost danger" type="button" onClick={() => void clear()}>
              Clear
            </button>
          ) : null}
        </div>
      }
    >
      <p className="market-pnl">
        Session{' '}
        <strong className={log.sessionNetPlat >= 0 ? 'market-pnl--pos' : 'market-pnl--neg'}>
          {log.sessionNetPlat >= 0 ? '+' : ''}
          {log.sessionNetPlat}p
        </strong>
        <span className="muted">
          {' '}
          (sold {log.sessionSoldPlat} · bought {log.sessionBoughtPlat})
        </span>
      </p>
      <p className="market-pnl muted" style={{ marginTop: 4 }}>
        All-time sold <strong>{log.soldPlat}p</strong>
        <span> · </span>
        Bought <strong>{log.boughtPlat}p</strong>
        <span> · </span>
        Net{' '}
        <strong className={log.netPlat >= 0 ? 'market-pnl--pos' : 'market-pnl--neg'}>
          {log.netPlat >= 0 ? '+' : ''}
          {log.netPlat}p
        </strong>
      </p>
      <p className="muted" style={{ fontSize: '0.78rem', marginTop: 6 }}>
        Safe undercut reprice: use <strong>Orders → Reprice pass</strong> (floor − 1, respects min).
      </p>
      <div className="market-create market-create--panel">
        <div className="vl-segment" role="group" aria-label="Trade side">
          <button
            type="button"
            className={`vl-segment__btn ${side === 'sell' ? 'is-on' : ''}`}
            onClick={() => setSide('sell')}
          >
            Sold
          </button>
          <button
            type="button"
            className={`vl-segment__btn ${side === 'buy' ? 'is-on' : ''}`}
            onClick={() => setSide('buy')}
          >
            Bought
          </button>
        </div>
        <div className="market-create-row">
          <input
            value={nameDraft}
            placeholder="Item name"
            onChange={(e) => setNameDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void add()
            }}
          />
          <input
            type="number"
            min={1}
            value={platDraft}
            onChange={(e) => setPlatDraft(e.target.value)}
            placeholder="Plat"
            aria-label="Platinum"
            style={{ maxWidth: 88 }}
          />
          <input
            type="number"
            min={1}
            value={qtyDraft}
            onChange={(e) => setQtyDraft(e.target.value)}
            placeholder="Qty"
            aria-label="Quantity"
            style={{ maxWidth: 64 }}
          />
          <button className="btn primary" type="button" disabled={busy} onClick={() => void add()}>
            {busy ? '…' : 'Log'}
          </button>
        </div>
      </div>
      {log.entries.length === 0 ? (
        <EmptyState
          title="No trades logged"
          body="Use Sold on an order, or log buys/sells here for a running plat total."
        />
      ) : (
        <ul className="market-card-list">
          {log.entries.map((e: MarketTradeEntry) => (
            <li key={e.id} className="market-card">
              <div className="market-card__body">
                <div className="market-card__title">
                  <span className={`market-chip market-chip--${e.side}`}>
                    {e.side === 'sell' ? 'Sold' : 'Bought'}
                  </span>
                  <strong>{e.itemName}</strong>
                </div>
                <div className="market-card__meta muted">
                  <span className="market-plat">
                    {e.platinum}p{e.quantity > 1 ? ` ×${e.quantity}` : ''}
                  </span>
                  <span>{formatWhen(e.at)}</span>
                </div>
              </div>
              <div className="market-actions">
                <button className="btn ghost" type="button" onClick={() => void remove(e.id)}>
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  )
}
