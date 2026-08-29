import { useCallback, useEffect, useState } from 'react'
import type { MarketPriceHistory } from '../../shared/types'
import { Panel } from './Panel'

type Props = {
  itemName: string
  onClose?: () => void
}

function Spark({
  points,
  valueKey = 'avg',
}: {
  points: Array<{ at: number; avg: number; min: number; max: number }>
  valueKey?: 'avg' | 'min' | 'max'
}) {
  if (points.length < 2) return <p className="muted">Not enough points.</p>
  const vals = points.map((p) => p[valueKey])
  const min = Math.min(...vals)
  const max = Math.max(...vals)
  const span = Math.max(1, max - min)
  return (
    <div className="economy-spark" aria-hidden>
      {vals.map((v, i) => (
        <span
          key={i}
          style={{
            height: `${Math.max(8, Math.round(((v - min) / span) * 100))}%`,
          }}
        />
      ))}
    </div>
  )
}

export function MarketPriceHistoryPanel({ itemName, onClose }: Props) {
  const [hist, setHist] = useState<MarketPriceHistory | null>(null)
  const [busy, setBusy] = useState(false)
  const [range, setRange] = useState<'48h' | '90d'>('48h')

  const load = useCallback(async () => {
    if (!window.voidlens?.getMarketPriceHistory || !itemName.trim()) return
    setBusy(true)
    try {
      setHist(await window.voidlens.getMarketPriceHistory(itemName.trim()))
    } finally {
      setBusy(false)
    }
  }, [itemName])

  useEffect(() => {
    void load()
  }, [load])

  const points = range === '48h' ? hist?.points48h || [] : hist?.points90d || []
  const last = points[points.length - 1]

  return (
    <Panel
      title={`Price history · ${itemName}`}
      subtitle={busy ? 'Loading…' : hist?.error || 'warframe.market closed-order stats'}
      actions={
        <>
          <button
            className={`btn ghost ${range === '48h' ? 'active' : ''}`}
            type="button"
            onClick={() => setRange('48h')}
          >
            48h
          </button>
          <button
            className={`btn ghost ${range === '90d' ? 'active' : ''}`}
            type="button"
            onClick={() => setRange('90d')}
          >
            90d
          </button>
          <button className="btn ghost" type="button" onClick={() => void load()} disabled={busy}>
            Refresh
          </button>
          {onClose ? (
            <button className="btn ghost" type="button" onClick={onClose}>
              Close
            </button>
          ) : null}
        </>
      }
    >
      {last ? (
        <div className="economy-grid" style={{ marginBottom: 8 }}>
          <div>
            <div className="muted" style={{ fontSize: '0.72rem' }}>
              Avg
            </div>
            <strong>{Math.round(last.avg)}p</strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.72rem' }}>
              Min / max
            </div>
            <strong>
              {Math.round(last.min)}–{Math.round(last.max)}p
            </strong>
          </div>
          <div>
            <div className="muted" style={{ fontSize: '0.72rem' }}>
              Volume
            </div>
            <strong>{last.volume}</strong>
          </div>
        </div>
      ) : null}
      <Spark points={points} />
      <p className="muted" style={{ marginTop: 8, fontSize: '0.75rem' }}>
        {points.length} samples · local chart from market statistics API
      </p>
    </Panel>
  )
}
