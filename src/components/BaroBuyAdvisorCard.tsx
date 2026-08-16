import { useMemo } from 'react'
import type { AppSettings, BaroInfo, BaroInventoryItem } from '../../shared/types'
import { Panel } from './Panel'
import { useNow } from '../hooks/useNow'
import './baro-buy-advisor.css'

type Props = {
  baro: BaroInfo | null
  wishlist: string[]
  playerDucats: number | null
  playerCredits: number | null
  dumpableDucats: number | null
  onToggleWish?: (item: string) => void
  onOpenInventory?: () => void
}

function isWished(item: string, wishlist: string[]) {
  const n = item.toLowerCase()
  return wishlist.some((w) => n.includes(w.toLowerCase()) || w.toLowerCase().includes(n))
}

function afford(
  entry: BaroInventoryItem,
  ducats: number | null,
  credits: number | null,
): 'ok' | 'partial' | 'no' | 'unknown' {
  if (ducats == null && credits == null) return 'unknown'
  const dOk = ducats == null ? true : ducats >= entry.ducats
  const cOk = credits == null ? true : credits >= entry.credits
  if (dOk && cOk) return 'ok'
  if (dOk || cOk) return 'partial'
  return 'no'
}

function fmt(n: number) {
  return n.toLocaleString('en-US')
}

type Ranked = {
  item: BaroInventoryItem
  afford: ReturnType<typeof afford>
  priority: number
}

export function BaroBuyAdvisorCard({
  baro,
  wishlist,
  playerDucats,
  playerCredits,
  dumpableDucats,
  onToggleWish,
  onOpenInventory,
}: Props) {
  const now = useNow()
  const inventory = baro?.inventory ?? []
  const wished = inventory.filter((i) => isWished(i.item, wishlist))

  const active = useMemo(() => {
    if (!baro) return false
    const a = baro.arrival ? new Date(baro.arrival).getTime() : NaN
    const d = baro.departure ? new Date(baro.departure).getTime() : NaN
    if (!Number.isNaN(a) && !Number.isNaN(d)) return now >= a && now < d
    return baro.active
  }, [baro, now])

  const ranked: Ranked[] = useMemo(() => {
    const rows = wished.map((item) => {
      const a = afford(item, playerDucats, playerCredits)
      const priority = a === 'ok' ? 0 : a === 'partial' ? 1 : a === 'unknown' ? 2 : 3
      return { item, afford: a, priority }
    })
    rows.sort((x, y) => {
      if (x.priority !== y.priority) return x.priority - y.priority
      return (x.item.ducats || 0) - (y.item.ducats || 0)
    })
    return rows
  }, [wished, playerDucats, playerCredits])

  const plan = useMemo(() => {
    if (!wished.length) return null
    const needD = wished.reduce((s, i) => s + (i.ducats || 0), 0)
    const needC = wished.reduce((s, i) => s + (i.credits || 0), 0)
    const haveD = playerDucats ?? 0
    const haveC = playerCredits ?? 0
    const shortD = Math.max(0, needD - haveD)
    const shortC = Math.max(0, needC - haveC)
    const dump = dumpableDucats ?? 0
    return { needD, needC, shortD, shortC, dump, canCover: shortD <= 0 || dump >= shortD }
  }, [wished, playerDucats, playerCredits, dumpableDucats])

  if (!wishlist.length && !wished.length) {
    return (
      <Panel title="Baro buy advisor" subtitle="Star items in the Baro panel" className="baro-buy-advisor">
        <p className="muted" style={{ margin: 0 }}>
          Wishlist items that are in stock appear here ranked by what you can afford first.
        </p>
      </Panel>
    )
  }

  return (
    <Panel
      title="Baro buy advisor"
      subtitle={
        active
          ? wished.length
            ? `${wished.length} wishlist in stock · buy order below`
            : 'Arrived — no wishlist hits this visit'
          : wished.length
            ? 'Prep for next visit'
            : 'Waiting for stock overlap'
      }
      className="baro-buy-advisor"
    >
      {playerDucats != null || playerCredits != null ? (
        <p className="baro-buy-advisor__wallet">
          Wallet:{' '}
          {playerDucats != null ? <strong>{fmt(playerDucats)} ⓓ</strong> : null}
          {playerDucats != null && playerCredits != null ? ' · ' : null}
          {playerCredits != null ? <strong>{fmt(playerCredits)} ₡</strong> : null}
          {dumpableDucats != null && dumpableDucats > 0 ? (
            <span className="muted"> · ~{fmt(dumpableDucats)} ⓓ dumpable</span>
          ) : null}
        </p>
      ) : (
        <p className="muted" style={{ marginTop: 0 }}>
          Sync inventory for wallet + dump math.
          {onOpenInventory ? (
            <>
              {' '}
              <button type="button" className="btn ghost" onClick={onOpenInventory}>
                Inventory
              </button>
            </>
          ) : null}
        </p>
      )}

      {plan && wished.length ? (
        <div className="baro-buy-advisor__plan">
          <div>
            Wishlist total: <strong>{fmt(plan.needD)} ⓓ</strong>
            {plan.needC > 0 ? (
              <>
                {' '}
                · <strong>{fmt(plan.needC)} ₡</strong>
              </>
            ) : null}
          </div>
          {plan.shortD > 0 || plan.shortC > 0 ? (
            <div className="is-warn">
              Short {plan.shortD > 0 ? `${fmt(plan.shortD)} ⓓ` : ''}
              {plan.shortD > 0 && plan.shortC > 0 ? ' · ' : ''}
              {plan.shortC > 0 ? `${fmt(plan.shortC)} ₡` : ''}
              {plan.shortD > 0 && dumpableDucats != null
                ? plan.canCover
                  ? ` — dump extras covers the ducat gap`
                  : ` — dumpables cover ~${fmt(plan.dump)} ⓓ`
                : ''}
            </div>
          ) : (
            <div className="is-ok">Can afford full wishlist</div>
          )}
        </div>
      ) : null}

      {ranked.length ? (
        <ol className="baro-buy-advisor__list">
          {ranked.map((row, i) => (
            <li key={row.item.item} className={`baro-buy-advisor__row is-${row.afford}`}>
              <span className="baro-buy-advisor__rank">{i + 1}</span>
              <div className="baro-buy-advisor__main">
                <div className="baro-buy-advisor__name">{row.item.item}</div>
                <div className="muted">
                  {fmt(row.item.ducats)} ⓓ · {fmt(row.item.credits)} ₡
                  {row.afford === 'ok'
                    ? ' · buy now'
                    : row.afford === 'partial'
                      ? ' · partial'
                      : row.afford === 'no'
                        ? ' · need more'
                        : ''}
                </div>
              </div>
              {onToggleWish ? (
                <button
                  type="button"
                  className="btn ghost"
                  title="Remove from wishlist"
                  onClick={() => onToggleWish(row.item.item)}
                >
                  Unstar
                </button>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="muted" style={{ marginBottom: 0 }}>
          {active
            ? 'None of your wishlist is in this shop. Check back next visit.'
            : 'When Baro arrives, overlapping wishlist items will rank here.'}
        </p>
      )}

      {!active && wishlist.length && !wished.length ? (
        <p className="muted" style={{ marginBottom: 0, marginTop: 8 }}>
          Watching {wishlist.length} wishlisted name{wishlist.length === 1 ? '' : 's'} (
          {(wishlist as AppSettings['baroWishlist']).slice(0, 4).join(', ')}
          {wishlist.length > 4 ? '…' : ''}).
        </p>
      ) : null}
    </Panel>
  )
}
