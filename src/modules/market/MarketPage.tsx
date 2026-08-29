import { useCallback, useEffect, useMemo, useState } from 'react'
import { AppSettings, MarketQuote, WfmContract, WfmOrder, WfmSession } from '../../../shared/types'
import { EmptyState } from '../../components/EmptyState'
import { InventoryStaleBanner } from '../../components/InventoryStaleBanner'
import { Panel } from '../../components/Panel'
import { useInventory } from '../../hooks/useInventory'
import { useRelicScan } from '../../hooks/useRelicScan'
import { useRivenScan } from '../../hooks/useRivenScan'
import { copyText } from '../../lib/tradeClipboard'
import { MarketSessionGuide } from '../../components/MarketSessionGuide'
import { MarketPriceHistoryPanel } from '../../components/MarketPriceHistoryPanel'
import { pushToast } from '../../lib/toast'
import { MarketBuysPanel } from './MarketBuysPanel'
import { MarketDealsPanel } from './MarketDealsPanel'
import { MarketRivenStockPanel } from './MarketRivenStockPanel'
import { MarketStockPanel } from './MarketStockPanel'
import { MarketTradeLogPanel } from './MarketTradeLogPanel'
import {
  flipSpread,
  formatTradeWhisper,
  itemMarketUrl,
  minSellFor,
  netAfterUndercut,
  orderHealth,
  suggestSellPrice,
} from './marketHelpers'
import './market.css'

type Props = {
  settings: AppSettings
  enabled: boolean
  onUpdate: (partial: Partial<AppSettings>) => void
  onOpenHelp?: () => void
  onOpenSettings?: () => void
  onSyncInventory?: () => void
  onFirstListCelebration?: () => void
  focusItem?: string | null
  onFocusItemConsumed?: () => void
}

type MarketTab =
  | 'watchlist'
  | 'buys'
  | 'deals'
  | 'stock'
  | 'rivens'
  | 'orders'
  | 'log'
  | 'contracts'
  | 'account'

const emptySession: WfmSession = {
  linked: false,
  ingameName: null,
  platform: null,
  reputation: null,
  status: null,
  error: null,
}

const TABS: Array<{ id: MarketTab; label: string }> = [
  { id: 'watchlist', label: 'Watchlist' },
  { id: 'buys', label: 'Buys' },
  { id: 'deals', label: 'Deals' },
  { id: 'stock', label: 'Stock' },
  { id: 'rivens', label: 'Rivens' },
  { id: 'orders', label: 'Orders' },
  { id: 'log', label: 'Log' },
  { id: 'contracts', label: 'Contracts' },
  { id: 'account', label: 'Account' },
]

function contractPriceLabel(c: WfmContract) {
  if (c.isDirectSell) {
    return `${c.buyoutPrice ?? c.startingPrice}p`
  }
  const bits = [`start ${c.startingPrice}p`]
  if (c.buyoutPrice != null) bits.push(`buyout ${c.buyoutPrice}p`)
  if (c.topBid != null) bits.push(`bid ${c.topBid}p`)
  return bits.join(' · ')
}

function contractKindLabel(kind: WfmContract['kind']) {
  if (kind === 'riven') return 'Riven'
  if (kind === 'lich') return 'Lich'
  if (kind === 'sister') return 'Sister'
  return 'Auction'
}

export function MarketPage({
  settings,
  enabled,
  onUpdate,
  onOpenHelp,
  onOpenSettings,
  onSyncInventory,
  onFirstListCelebration,
  focusItem,
  onFocusItemConsumed,
}: Props) {
  const { status: inventory } = useInventory()
  const [tab, setTabState] = useState<MarketTab>(
    (['watchlist', 'buys', 'deals', 'stock', 'rivens', 'orders', 'log', 'contracts', 'account'].includes(
      settings.marketLastTab,
    )
      ? settings.marketLastTab
      : 'watchlist') as MarketTab,
  )
  const setTab = useCallback(
    (next: MarketTab) => {
      setTabState(next)
      onUpdate({ marketLastTab: next })
    },
    [onUpdate],
  )
  const [draft, setDraft] = useState('')
  const [historyItem, setHistoryItem] = useState<string | null>(null)
  const [quotes, setQuotes] = useState<MarketQuote[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [session, setSession] = useState<WfmSession>(emptySession)
  const [jwtDraft, setJwtDraft] = useState('')
  const [authBusy, setAuthBusy] = useState(false)
  const [orders, setOrders] = useState<WfmOrder[]>([])
  const [ordersError, setOrdersError] = useState<string | null>(null)
  const [ordersLoading, setOrdersLoading] = useState(false)
  const [cancelBusyId, setCancelBusyId] = useState<string | null>(null)
  const [repriceBusyId, setRepriceBusyId] = useState<string | null>(null)
  const [repricePassBusy, setRepricePassBusy] = useState(false)
  const [soldBusyId, setSoldBusyId] = useState<string | null>(null)
  const [orderQuotes, setOrderQuotes] = useState<MarketQuote[]>([])
  const [whisperCopiedId, setWhisperCopiedId] = useState<string | null>(null)
  const [blacklistDraft, setBlacklistDraft] = useState('')
  const [contracts, setContracts] = useState<WfmContract[]>([])
  const [contractsError, setContractsError] = useState<string | null>(null)
  const [contractsLoading, setContractsLoading] = useState(false)
  const [cancelContractBusyId, setCancelContractBusyId] = useState<string | null>(null)
  const [showCreateOrder, setShowCreateOrder] = useState(false)
  const [showCreateContract, setShowCreateContract] = useState(false)
  const [orderItemQuery, setOrderItemQuery] = useState('')
  const [orderHints, setOrderHints] = useState<Array<{ id: string; slug: string; name: string }>>([])
  const [orderItemId, setOrderItemId] = useState('')
  const [orderType, setOrderType] = useState<'buy' | 'sell'>('sell')
  const [orderPlat, setOrderPlat] = useState('10')
  const [undercutBusy, setUndercutBusy] = useState(false)
  const [undercutHint, setUndercutHint] = useState<string | null>(null)
  const [orderQty, setOrderQty] = useState('1')
  const [orderVisible, setOrderVisible] = useState(true)
  const [orderBusy, setOrderBusy] = useState(false)
  const [orderMsg, setOrderMsg] = useState<string | null>(null)
  const [contractKind, setContractKind] = useState<'riven' | 'lich' | 'sister'>('riven')
  const [contractWeapon, setContractWeapon] = useState('')
  const [contractStart, setContractStart] = useState('100')
  const [contractBuyout, setContractBuyout] = useState('100')
  const [contractDirect, setContractDirect] = useState(true)
  const [contractVisible, setContractVisible] = useState(true)
  const [contractRivenName, setContractRivenName] = useState('')
  const [contractAttrs, setContractAttrs] = useState(
    '+critical_chance 100\n+critical_damage 100\n+multishot 90',
  )
  const [contractRank, setContractRank] = useState('0')
  const [contractRolls, setContractRolls] = useState('0')
  const [contractPolarity, setContractPolarity] = useState('madurai')
  const [contractElement, setContractElement] = useState('heat')
  const [contractDamage, setContractDamage] = useState('25')
  const [contractEphemera, setContractEphemera] = useState(false)
  const [contractQuirk, setContractQuirk] = useState('')
  const [contractBusy, setContractBusy] = useState(false)
  const [contractMsg, setContractMsg] = useState<string | null>(null)
  const { state: relics } = useRelicScan()
  const { state: rivens } = useRivenScan()

  const watchlist = settings.marketWatchlist

  const refreshContracts = useCallback(async () => {
    setContractsLoading(true)
    setContractsError(null)
    try {
      const res = await window.voidlens.getWfmContracts()
      setContracts(res.contracts)
      setContractsError(res.error)
    } catch (err) {
      setContracts([])
      setContractsError(err instanceof Error ? err.message : 'Failed to load contracts')
    } finally {
      setContractsLoading(false)
    }
  }, [])

  const refreshOrders = useCallback(async () => {
    setOrdersLoading(true)
    setOrdersError(null)
    try {
      const res = await window.voidlens.getWfmOrders()
      setOrders(res.orders)
      setOrdersError(res.error)
      const names = [...new Set(res.orders.map((o) => o.itemName).filter(Boolean))]
      if (names.length && window.voidlens.lookupMarketPrices) {
        try {
          const qs = await window.voidlens.lookupMarketPrices(names)
          setOrderQuotes(qs as MarketQuote[])
        } catch {
          setOrderQuotes([])
        }
      } else {
        setOrderQuotes([])
      }
    } catch (err) {
      setOrders([])
      setOrdersError(err instanceof Error ? err.message : 'Failed to load orders')
      setOrderQuotes([])
    } finally {
      setOrdersLoading(false)
    }
  }, [])

  const orderQuoteBy = useMemo(() => {
    const m = new Map<string, MarketQuote>()
    for (const q of orderQuotes) m.set(q.name.toLowerCase(), q)
    return m
  }, [orderQuotes])

  const staleMargin = settings.marketStaleMargin ?? 3
  const mins = settings.marketMinPrices || []

  const repriceOrder = async (o: WfmOrder) => {
    if (!window.voidlens?.updateWfmOrder) return
    const q = orderQuoteBy.get(o.itemName.toLowerCase())
    const health = orderHealth(o, q, staleMargin, minSellFor(o.itemName, mins))
    const plat = health.suggest
    if (plat == null) {
      setOrdersError('No live floor for this item')
      return
    }
    setRepriceBusyId(o.id)
    setOrdersError(null)
    try {
      const res = await window.voidlens.updateWfmOrder({
        orderId: o.id,
        platinum: plat,
        quantity: o.quantity,
        visible: o.visible,
      })
      if (!res.ok) {
        setOrdersError(res.error || 'Reprice failed')
        return
      }
      await refreshOrders()
    } finally {
      setRepriceBusyId(null)
    }
  }

  const repricePass = async () => {
    if (!window.voidlens?.updateWfmOrder) return
    const targets = orders.filter((o) => {
      if (o.orderType !== 'sell') return false
      const q = orderQuoteBy.get(o.itemName.toLowerCase())
      const health = orderHealth(o, q, staleMargin, minSellFor(o.itemName, mins))
      return health.suggest != null && health.suggest !== o.platinum && (health.undercut || health.stale)
    })
    if (!targets.length) {
      setOrdersError(null)
      return
    }
    setRepricePassBusy(true)
    setOrdersError(null)
    let ok = 0
    let fail = 0
    try {
      for (const o of targets) {
        const q = orderQuoteBy.get(o.itemName.toLowerCase())
        const health = orderHealth(o, q, staleMargin, minSellFor(o.itemName, mins))
        if (health.suggest == null) continue
        const res = await window.voidlens.updateWfmOrder({
          orderId: o.id,
          platinum: health.suggest,
          quantity: o.quantity,
          visible: o.visible,
        })
        if (res.ok) ok += 1
        else fail += 1
        await new Promise((r) => setTimeout(r, 350))
      }
      if (fail) setOrdersError(`Reprice pass: ${ok} updated, ${fail} failed`)
      await refreshOrders()
    } finally {
      setRepricePassBusy(false)
    }
  }

  const markSold = async (o: WfmOrder) => {
    if (!window.voidlens?.addMarketTrade) return
    setSoldBusyId(o.id)
    setOrdersError(null)
    try {
      await window.voidlens.addMarketTrade({
        side: o.orderType === 'buy' ? 'buy' : 'sell',
        itemName: o.itemName,
        platinum: o.platinum,
        quantity: o.quantity,
        note: 'From open order',
      })
      if (window.voidlens.deleteWfmOrder) {
        const res = await window.voidlens.deleteWfmOrder(o.id)
        if (!res.ok) {
          setOrdersError(res.error || 'Logged, but cancel on WFM failed')
          return
        }
      }
      await refreshOrders()
    } finally {
      setSoldBusyId(null)
    }
  }

  const copyOrderWhisper = async (o: WfmOrder) => {
    if (!(await copyText(formatTradeWhisper(o)))) return
    setWhisperCopiedId(o.id)
    window.setTimeout(() => setWhisperCopiedId(null), 1400)
  }

  const refreshSession = useCallback(async () => {
    try {
      const s = await window.voidlens.getWfmSession()
      setSession(s)
      if (s.linked) {
        void refreshOrders()
        void refreshContracts()
      } else {
        setOrders([])
        setOrdersError(null)
        setContracts([])
        setContractsError(null)
      }
    } catch {
      setSession(emptySession)
    }
  }, [refreshOrders, refreshContracts])

  const refresh = useCallback(async () => {
    if (!watchlist.length) {
      setQuotes([])
      return
    }
    setLoading(true)
    setError(null)
    try {
      const rows = await window.voidlens.lookupMarketPrices(watchlist)
      setQuotes(rows as MarketQuote[])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Market lookup failed')
    } finally {
      setLoading(false)
    }
  }, [watchlist])

  useEffect(() => {
    if (!enabled) return
    void refresh()
    void refreshSession()
  }, [enabled, refresh, refreshSession])

  useEffect(() => {
    if (!session.linked) return
    const q = orderItemQuery.trim()
    if (q.length < 2) {
      setOrderHints([])
      return
    }
    const handle = window.setTimeout(() => {
      void window.voidlens.searchWfmItems(q).then(setOrderHints).catch(() => setOrderHints([]))
    }, 250)
    return () => window.clearTimeout(handle)
  }, [orderItemQuery, session.linked])

  const quoteByName = useMemo(() => {
    const m = new Map<string, MarketQuote>()
    for (const q of quotes) m.set(q.name.toLowerCase(), q)
    return m
  }, [quotes])

  const addItem = () => {
    const name = draft.trim()
    if (!name) return
    if (watchlist.some((w) => w.toLowerCase() === name.toLowerCase())) {
      setDraft('')
      return
    }
    onUpdate({ marketWatchlist: [...watchlist, name] })
    setDraft('')
  }

  const removeItem = (name: string) => {
    onUpdate({ marketWatchlist: watchlist.filter((w) => w !== name) })
  }

  useEffect(() => {
    const name = focusItem?.trim()
    if (!name) return
    setTab('watchlist')
    const wl = settings.marketWatchlist
    if (!wl.some((w) => w.toLowerCase() === name.toLowerCase())) {
      onUpdate({ marketWatchlist: [...wl, name] })
    }
    onFocusItemConsumed?.()
    // Only react to new focus payloads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusItem])

  const linkJwt = async () => {
    setAuthBusy(true)
    try {
      const s = await window.voidlens.setWfmJwt(jwtDraft)
      setSession(s)
      if (s.linked) {
        setJwtDraft('')
        void refreshOrders()
        void refreshContracts()
      }
    } finally {
      setAuthBusy(false)
    }
  }

  const unlink = async () => {
    setAuthBusy(true)
    try {
      const s = await window.voidlens.clearWfmJwt()
      setSession(s)
      setOrders([])
      setOrdersError(null)
      setContracts([])
      setContractsError(null)
    } finally {
      setAuthBusy(false)
    }
  }

  const cancelOrder = async (id: string) => {
    setCancelBusyId(id)
    try {
      const res = await window.voidlens.deleteWfmOrder(id)
      if (!res.ok) {
        setOrdersError(res.error || 'Cancel failed')
        return
      }
      await refreshOrders()
    } finally {
      setCancelBusyId(null)
    }
  }

  const cancelContract = async (id: string) => {
    setCancelContractBusyId(id)
    try {
      const res = await window.voidlens.deleteWfmContract(id)
      if (!res.ok) {
        setContractsError(res.error || 'Cancel failed')
        pushToast(res.error || 'Cancel failed', 'error', 6000)
        return
      }
      pushToast('Contract cancelled', 'ok')
      await refreshContracts()
    } finally {
      setCancelContractBusyId(null)
    }
  }

  const submitOrder = async () => {
    setOrderBusy(true)
    setOrderMsg(null)
    try {
      const res = await window.voidlens.createWfmOrder({
        itemId: orderItemId || undefined,
        itemSlugOrName: orderItemId ? undefined : orderItemQuery,
        orderType,
        platinum: Number(orderPlat),
        quantity: Number(orderQty),
        visible: orderVisible,
      })
      if (!res.ok) {
        setOrderMsg(res.error || 'Create failed')
        return
      }
      setOrderMsg(`Listed ${orderType} order`)
      setOrderItemQuery('')
      setOrderItemId('')
      setShowCreateOrder(false)
      pushToast('Market order listed', 'ok')
      onFirstListCelebration?.()
      await refreshOrders()
    } finally {
      setOrderBusy(false)
    }
  }

  const applyUndercut = async () => {
    const name = orderItemQuery.trim()
    if (!name || !window.voidlens?.suggestMarketUndercut) return
    setUndercutBusy(true)
    setUndercutHint(null)
    try {
      const tip = await window.voidlens.suggestMarketUndercut(name)
      if (!tip) {
        setUndercutHint('No live sell orders found')
        return
      }
      const min = minSellFor(name, mins)
      const suggest = suggestSellPrice(tip.floor, min)
      setOrderPlat(String(suggest))
      const net = netAfterUndercut(suggest)
      setUndercutHint(
        `Listing assistant: floor ${tip.floor}p · median ~${tip.median}p · list ${suggest}p` +
          (min != null ? ` (min ${min}p)` : '') +
          ` · net after −1 undercut ~${net}p`,
      )
    } finally {
      setUndercutBusy(false)
    }
  }

  const submitContract = async () => {
    setContractBusy(true)
    setContractMsg(null)
    try {
      const res = await window.voidlens.createWfmContract({
        kind: contractKind,
        weaponUrlName: contractWeapon,
        startingPrice: Number(contractStart),
        buyoutPrice: contractBuyout.trim() ? Number(contractBuyout) : null,
        isDirectSell: contractDirect,
        visible: contractVisible,
        rivenName: contractRivenName,
        attributesText: contractAttrs,
        modRank: Number(contractRank),
        reRolls: Number(contractRolls),
        polarity: contractPolarity,
        element: contractElement,
        damage: Number(contractDamage),
        havingEphemera: contractEphemera,
        quirk: contractQuirk,
      })
      if (!res.ok) {
        setContractMsg(res.error || 'Create failed')
        return
      }
      setContractMsg('Contract created')
      setShowCreateContract(false)
      await refreshContracts()
    } finally {
      setContractBusy(false)
    }
  }

  const recentRelics = (relics.rewards || [])
    .filter((r) => r.platinum != null)
    .slice(0, 6)

  if (!enabled) {
    return (
      <Panel title="Market" subtitle="Module disabled">
        <EmptyState
          title="Module off"
          body="Enable Market under Modules to track platinum quotes and manage warframe.market listings."
        />
      </Panel>
    )
  }

  return (
    <div className="market-page">
      <header className="page-header">
        <h2 className="page-title">Market</h2>
        <div className="page-title-rule" />
        <p className="page-desc">
          Track platinum, manage warframe.market orders and contracts, and pull prices from the
          latest relic / riven scans.
        </p>
      </header>

      <section className={`market-session-bar ${session.linked ? 'is-linked' : ''}`}>
        {session.linked ? (
          <>
            <div className="market-session-bar__identity">
              <span className="market-session-bar__dot" aria-hidden />
              <div>
                <strong>{session.ingameName}</strong>
                <div className="muted">
                  {session.platform || 'pc'}
                  {session.reputation != null ? ` · ${session.reputation} rep` : ''}
                  {session.status ? ` · ${session.status}` : ''}
                  {` · ${orders.length} orders · ${contracts.length} contracts`}
                </div>
              </div>
            </div>
            <div className="market-actions">
              <button
                className="btn ghost"
                onClick={() =>
                  void window.voidlens.openExternal(
                    `https://warframe.market/profile/${encodeURIComponent(session.ingameName || '')}`,
                  )
                }
              >
                Profile
              </button>
              <button
                className="btn ghost"
                onClick={() => {
                  void refreshOrders()
                  void refreshContracts()
                }}
                disabled={ordersLoading || contractsLoading}
              >
                {ordersLoading || contractsLoading ? 'Refreshing…' : 'Refresh'}
              </button>
              <button className="btn ghost" onClick={() => void unlink()} disabled={authBusy}>
                Sign out
              </button>
            </div>
          </>
        ) : (
          <>
            <div>
              <strong>Not signed in</strong>
              <div className="muted">Watchlist works offline · listing needs a JWT link</div>
            </div>
            <button className="btn primary" onClick={() => setTab('account')}>
              Link account
            </button>
          </>
        )}
      </section>

      <MarketSessionGuide
        dismissed={settings.marketSessionGuideDismissed}
        onDismiss={() => onUpdate({ marketSessionGuideDismissed: true })}
        onGoTab={(id) => setTab(id as MarketTab)}
      />

      <InventoryStaleBanner
        inventory={inventory}
        onOpenInventory={onOpenSettings}
        onSyncInventory={onSyncInventory}
      />

      <div className="vl-segment vl-segment--wrap market-tabs" role="tablist" aria-label="Market sections">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={tab === t.id}
            className={`vl-segment__btn ${tab === t.id ? 'is-on' : ''}`}
            onClick={() => setTab(t.id)}
          >
            {t.label}
            {t.id === 'orders' && session.linked && orders.length > 0 ? (
              <span className="market-tab-count">{orders.length}</span>
            ) : null}
            {t.id === 'contracts' && session.linked && contracts.length > 0 ? (
              <span className="market-tab-count">{contracts.length}</span>
            ) : null}
            {t.id === 'watchlist' && watchlist.length > 0 ? (
              <span className="market-tab-count">{watchlist.length}</span>
            ) : null}
            {t.id === 'buys' && (settings.marketBuyTargets || []).length > 0 ? (
              <span className="market-tab-count">{(settings.marketBuyTargets || []).length}</span>
            ) : null}
          </button>
        ))}
      </div>

      <div className="market-layout">
        <div className="market-main">
          {tab === 'watchlist' ? (
            <>
              {historyItem ? (
                <div style={{ marginBottom: 12 }}>
                  <MarketPriceHistoryPanel
                    itemName={historyItem}
                    onClose={() => setHistoryItem(null)}
                  />
                </div>
              ) : null}
            <Panel
              title="Watchlist"
              subtitle="Live floor + median sell (PC) — no account needed"
              actions={
                <button className="btn ghost" onClick={() => void refresh()} disabled={loading}>
                  {loading ? 'Refreshing…' : 'Refresh prices'}
                </button>
              }
            >
              <div className="market-add">
                <input
                  value={draft}
                  placeholder="Item name (e.g. Nikana Prime Blade)"
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') addItem()
                  }}
                />
                <button className="btn primary" onClick={addItem}>
                  Add
                </button>
              </div>
              {error ? <p className="market-error">{error}</p> : null}

              {watchlist.length === 0 ? (
                <EmptyState
                  title="Watchlist empty"
                  body="Add prime parts or sets to track live floor and median platinum."
                />
              ) : (
                <div className="market-table market-table--watch" role="table">
                  <div className="market-table__head" role="row">
                    <span role="columnheader">Item</span>
                    <span role="columnheader">Floor</span>
                    <span role="columnheader">Median</span>
                    <span role="columnheader">Spread</span>
                    <span role="columnheader">Vol</span>
                    <span role="columnheader" className="market-table__actions-col">
                      Actions
                    </span>
                  </div>
                  {watchlist.map((name) => {
                    const q = quoteByName.get(name.toLowerCase())
                    const spread = flipSpread(q)
                    return (
                      <div className="market-table__row" role="row" key={name}>
                        <span className="market-table__name" role="cell">
                          {name}
                        </span>
                        <span className="market-plat" role="cell">
                          {q ? `${q.floor ?? q.platinum}p` : loading ? '…' : '—'}
                        </span>
                        <span className="muted" role="cell">
                          {q ? `~${q.platinum}p` : '—'}
                        </span>
                        <span
                          className={`muted${spread && spread.spread >= 5 ? ' market-spread--wide' : ''}`}
                          role="cell"
                          title="Median − floor (flip room)"
                        >
                          {spread ? spread.label : '—'}
                        </span>
                        <span className="muted" role="cell">
                          {q ? `${q.volume}` : '—'}
                        </span>
                        <span className="market-actions" role="cell">
                          <button
                            className="btn ghost"
                            type="button"
                            onClick={() => setHistoryItem(name)}
                          >
                            Chart
                          </button>
                          <button
                            className="btn ghost"
                            onClick={() => void window.voidlens.openExternal(itemMarketUrl(name))}
                          >
                            Open
                          </button>
                          <button className="btn ghost" onClick={() => removeItem(name)}>
                            Remove
                          </button>
                        </span>
                      </div>
                    )
                  })}
                </div>
              )}
            </Panel>
            </>
          ) : null}

          {tab === 'buys' ? (
            <MarketBuysPanel settings={settings} onUpdate={onUpdate} />
          ) : null}

          {tab === 'deals' ? (
            <MarketDealsPanel settings={settings} onUpdate={onUpdate} />
          ) : null}

          {tab === 'stock' ? (
            <MarketStockPanel
              settings={settings}
              orders={orders}
              linked={session.linked}
              onOpenAccount={() => setTab('account')}
              onUpdate={onUpdate}
              onOrdersChanged={() => void refreshOrders()}
            />
          ) : null}

          {tab === 'rivens' ? (
            <MarketRivenStockPanel settings={settings} onUpdate={onUpdate} />
          ) : null}

          {tab === 'log' ? <MarketTradeLogPanel /> : null}

          {tab === 'orders' ? (
            <Panel
              title="Buy / sell orders"
              subtitle="Live floor health · reprice to undercut · whisper copy"
              actions={
                session.linked ? (
                  <div className="market-actions">
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={ordersLoading}
                      onClick={() => void refreshOrders()}
                    >
                      {ordersLoading ? '…' : 'Refresh'}
                    </button>
                    <button
                      className="btn ghost"
                      type="button"
                      disabled={repricePassBusy || ordersLoading}
                      onClick={() => void repricePass()}
                      title="Reprice undercut & stale sells to floor − 1 (respects min)"
                    >
                      {repricePassBusy ? 'Repricing…' : 'Reprice pass'}
                    </button>
                    <button
                      className={`btn ${showCreateOrder ? 'ghost' : 'primary'}`}
                      onClick={() => setShowCreateOrder((v) => !v)}
                    >
                      {showCreateOrder ? 'Hide form' : 'New order'}
                    </button>
                  </div>
                ) : null
              }
            >
              {!session.linked ? (
                <EmptyState
                  title="Sign in required"
                  body="Link your warframe.market JWT under Account to create and manage orders."
                  actions={
                    <button className="btn primary" onClick={() => setTab('account')}>
                      Go to Account
                    </button>
                  }
                />
              ) : (
                <>
                  {showCreateOrder ? (
                    <div className="market-create market-create--panel">
                      <input
                        value={orderItemQuery}
                        placeholder="Item name (e.g. Nikana Prime Blade)"
                        onChange={(e) => {
                          setOrderItemQuery(e.target.value)
                          setOrderItemId('')
                        }}
                      />
                      {orderHints.length ? (
                        <ul className="market-hints">
                          {orderHints.map((h) => (
                            <li key={h.id}>
                              <button
                                type="button"
                                className="linkish"
                                onClick={() => {
                                  setOrderItemQuery(h.name)
                                  setOrderItemId(h.id)
                                  setOrderHints([])
                                }}
                              >
                                {h.name}
                              </button>
                            </li>
                          ))}
                        </ul>
                      ) : null}
                      <div className="market-create-row">
                        <div className="vl-segment" role="group" aria-label="Order type">
                          <button
                            type="button"
                            className={`vl-segment__btn ${orderType === 'sell' ? 'is-on' : ''}`}
                            onClick={() => setOrderType('sell')}
                          >
                            Sell
                          </button>
                          <button
                            type="button"
                            className={`vl-segment__btn ${orderType === 'buy' ? 'is-on' : ''}`}
                            onClick={() => setOrderType('buy')}
                          >
                            Buy
                          </button>
                        </div>
                        <input
                          type="number"
                          min={1}
                          value={orderPlat}
                          onChange={(e) => setOrderPlat(e.target.value)}
                          placeholder="Plat"
                          aria-label="Platinum"
                        />
                        <input
                          type="number"
                          min={1}
                          value={orderQty}
                          onChange={(e) => setOrderQty(e.target.value)}
                          placeholder="Qty"
                          aria-label="Quantity"
                        />
                        <label className="market-check">
                          <input
                            type="checkbox"
                            checked={orderVisible}
                            onChange={(e) => setOrderVisible(e.target.checked)}
                          />
                          Visible
                        </label>
                        <button
                          className="btn ghost"
                          type="button"
                          disabled={undercutBusy || !orderItemQuery.trim() || orderType !== 'sell'}
                          onClick={() => void applyUndercut()}
                          title="Listing assistant: set platinum to live floor − 1"
                        >
                          {undercutBusy ? '…' : 'Suggest'}
                        </button>
                        <button
                          className="btn primary"
                          disabled={orderBusy || (!orderItemId && !orderItemQuery.trim())}
                          onClick={() => void submitOrder()}
                        >
                          {orderBusy ? 'Listing…' : 'Create'}
                        </button>
                      </div>
                      {undercutHint ? <p className="muted">{undercutHint}</p> : null}
                      {orderMsg ? (
                        <p className={orderMsg.startsWith('Listed') ? 'muted' : 'market-error'}>
                          {orderMsg}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {ordersError ? <p className="market-error">{ordersError}</p> : null}

                  {orders.length === 0 && !ordersLoading ? (
                    <EmptyState
                      title="No open orders"
                      body="Create a buy or sell listing, or refresh after posting on the website."
                      actions={
                        !showCreateOrder ? (
                          <button className="btn primary" onClick={() => setShowCreateOrder(true)}>
                            New order
                          </button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <ul className="market-card-list">
                      {orders.map((o) => {
                        const q = orderQuoteBy.get(o.itemName.toLowerCase())
                        const health = orderHealth(
                          o,
                          q,
                          staleMargin,
                          minSellFor(o.itemName, mins),
                        )
                        return (
                          <li
                            key={o.id}
                            className={`market-card${health.undercut ? ' is-undercut' : ''}${health.stale ? ' is-stale' : ''}`}
                          >
                            <div className="market-card__body">
                              <div className="market-card__title">
                                <span className={`market-chip market-chip--${o.orderType}`}>
                                  {o.orderType === 'sell' ? 'Sell' : 'Buy'}
                                </span>
                                <strong>{o.itemName}</strong>
                                {health.undercut ? (
                                  <span className="market-chip market-chip--warn">Undercut</span>
                                ) : null}
                                {health.stale ? (
                                  <span className="market-chip market-chip--stale">Stale</span>
                                ) : null}
                              </div>
                              <div className="market-card__meta muted">
                                <span className="market-plat">{o.platinum}p</span>
                                <span>× {o.quantity}</span>
                                {!o.visible ? <span>Hidden</span> : null}
                                {health.label ? <span>{health.label}</span> : null}
                              </div>
                            </div>
                            <div className="market-actions">
                              <button
                                className="btn ghost"
                                type="button"
                                onClick={() => void copyOrderWhisper(o)}
                                title="Copy trade whisper"
                              >
                                {whisperCopiedId === o.id ? 'Copied' : 'Whisper'}
                              </button>
                              <button
                                className="btn ghost"
                                type="button"
                                disabled={soldBusyId === o.id}
                                onClick={() => void markSold(o)}
                                title="Log to trade log and cancel on WFM"
                              >
                                {soldBusyId === o.id
                                  ? '…'
                                  : o.orderType === 'sell'
                                    ? 'Sold'
                                    : 'Bought'}
                              </button>
                              {o.orderType === 'sell' &&
                              health.suggest != null &&
                              health.suggest !== o.platinum ? (
                                <button
                                  className="btn primary"
                                  type="button"
                                  disabled={repriceBusyId === o.id || repricePassBusy}
                                  onClick={() => void repriceOrder(o)}
                                  title={`Set to ${health.suggest}p`}
                                >
                                  {repriceBusyId === o.id ? '…' : `Reprice ${health.suggest}p`}
                                </button>
                              ) : null}
                              {o.itemUrlName ? (
                                <button
                                  className="btn ghost"
                                  onClick={() =>
                                    void window.voidlens.openExternal(
                                      `https://warframe.market/items/${o.itemUrlName}`,
                                    )
                                  }
                                >
                                  Open
                                </button>
                              ) : null}
                              <button
                                className="btn ghost danger"
                                disabled={cancelBusyId === o.id}
                                onClick={() => void cancelOrder(o.id)}
                              >
                                {cancelBusyId === o.id ? '…' : 'Cancel'}
                              </button>
                            </div>
                          </li>
                        )
                      })}
                    </ul>
                  )}
                </>
              )}
            </Panel>
          ) : null}

          {tab === 'contracts' ? (
            <Panel
              title="Contracts"
              subtitle="Riven, Kuva Lich, and Sister auctions"
              actions={
                session.linked ? (
                  <button
                    className={`btn ${showCreateContract ? 'ghost' : 'primary'}`}
                    onClick={() => setShowCreateContract((v) => !v)}
                  >
                    {showCreateContract ? 'Hide form' : 'New contract'}
                  </button>
                ) : null
              }
            >
              {!session.linked ? (
                <EmptyState
                  title="Sign in required"
                  body="Link your warframe.market JWT under Account to manage auctions."
                  actions={
                    <button className="btn primary" onClick={() => setTab('account')}>
                      Go to Account
                    </button>
                  }
                />
              ) : (
                <>
                  {showCreateContract ? (
                    <div className="market-create market-create--panel">
                      <div className="market-create-row">
                        <select
                          value={contractKind}
                          onChange={(e) =>
                            setContractKind(e.target.value as 'riven' | 'lich' | 'sister')
                          }
                        >
                          <option value="riven">Riven</option>
                          <option value="lich">Kuva Lich</option>
                          <option value="sister">Sister</option>
                        </select>
                        <input
                          value={contractWeapon}
                          onChange={(e) => setContractWeapon(e.target.value)}
                          placeholder="weapon_url_name (e.g. nikana)"
                        />
                      </div>
                      {contractKind === 'riven' ? (
                        <>
                          <input
                            value={contractRivenName}
                            onChange={(e) => setContractRivenName(e.target.value)}
                            placeholder="Riven name (e.g. crita-vis)"
                          />
                          <div className="market-create-row">
                            <input
                              type="number"
                              value={contractRank}
                              onChange={(e) => setContractRank(e.target.value)}
                              placeholder="Rank"
                              aria-label="Mod rank"
                            />
                            <input
                              type="number"
                              value={contractRolls}
                              onChange={(e) => setContractRolls(e.target.value)}
                              placeholder="Rolls"
                              aria-label="Rerolls"
                            />
                            <select
                              value={contractPolarity}
                              onChange={(e) => setContractPolarity(e.target.value)}
                            >
                              <option value="madurai">Madurai</option>
                              <option value="naramon">Naramon</option>
                              <option value="vazarin">Vazarin</option>
                              <option value="zenurik">Zenurik</option>
                              <option value="unairu">Unairu</option>
                            </select>
                          </div>
                          <textarea
                            rows={4}
                            value={contractAttrs}
                            onChange={(e) => setContractAttrs(e.target.value)}
                            placeholder={'+critical_chance 187.2\n-ammo_maximum 6'}
                          />
                        </>
                      ) : (
                        <div className="market-create-row">
                          <input
                            value={contractElement}
                            onChange={(e) => setContractElement(e.target.value)}
                            placeholder="element (heat, cold…)"
                          />
                          <input
                            type="number"
                            value={contractDamage}
                            onChange={(e) => setContractDamage(e.target.value)}
                            placeholder="Damage %"
                          />
                          {contractKind === 'sister' ? (
                            <input
                              value={contractQuirk}
                              onChange={(e) => setContractQuirk(e.target.value)}
                              placeholder="quirk_url_name"
                            />
                          ) : null}
                          <label className="market-check">
                            <input
                              type="checkbox"
                              checked={contractEphemera}
                              onChange={(e) => setContractEphemera(e.target.checked)}
                            />
                            Ephemera
                          </label>
                        </div>
                      )}
                      <div className="market-create-row">
                        <input
                          type="number"
                          min={1}
                          value={contractStart}
                          onChange={(e) => setContractStart(e.target.value)}
                          placeholder="Start plat"
                        />
                        <input
                          type="number"
                          min={1}
                          value={contractBuyout}
                          onChange={(e) => setContractBuyout(e.target.value)}
                          placeholder="Buyout plat"
                        />
                        <label className="market-check">
                          <input
                            type="checkbox"
                            checked={contractDirect}
                            onChange={(e) => setContractDirect(e.target.checked)}
                          />
                          Buyout listing
                        </label>
                        <label className="market-check">
                          <input
                            type="checkbox"
                            checked={contractVisible}
                            onChange={(e) => setContractVisible(e.target.checked)}
                          />
                          Visible
                        </label>
                        <button
                          className="btn primary"
                          disabled={contractBusy || !contractWeapon.trim()}
                          onClick={() => void submitContract()}
                        >
                          {contractBusy ? 'Creating…' : 'Create'}
                        </button>
                      </div>
                      {contractMsg ? (
                        <p
                          className={
                            contractMsg.includes('created') ? 'muted' : 'market-error'
                          }
                        >
                          {contractMsg}
                        </p>
                      ) : null}
                    </div>
                  ) : null}

                  {contractsError ? <p className="market-error">{contractsError}</p> : null}

                  {contracts.length === 0 && !contractsLoading ? (
                    <EmptyState
                      title="No open contracts"
                      body="Post a riven / lich / sister listing, or refresh after creating one on the site."
                      actions={
                        !showCreateContract ? (
                          <button
                            className="btn primary"
                            onClick={() => setShowCreateContract(true)}
                          >
                            New contract
                          </button>
                        ) : undefined
                      }
                    />
                  ) : (
                    <ul className="market-card-list">
                      {contracts.map((c) => (
                        <li key={c.id} className="market-card">
                          <div className="market-card__body">
                            <div className="market-card__title">
                              <span className={`market-chip market-chip--${c.kind}`}>
                                {contractKindLabel(c.kind)}
                              </span>
                              <strong>{c.title}</strong>
                            </div>
                            <div className="market-card__meta muted">
                              <span className="market-plat">{contractPriceLabel(c)}</span>
                              <span>{c.isDirectSell ? 'Buyout' : 'Auction'}</span>
                              {!c.visible ? <span>Hidden</span> : null}
                              {c.detail ? <span>{c.detail}</span> : null}
                            </div>
                          </div>
                          <div className="market-actions">
                            <button
                              className="btn ghost"
                              onClick={() => void window.voidlens.openExternal(c.marketUrl)}
                            >
                              Open
                            </button>
                            <button
                              className="btn ghost danger"
                              disabled={cancelContractBusyId === c.id}
                              onClick={() => void cancelContract(c.id)}
                            >
                              {cancelContractBusyId === c.id ? '…' : 'Cancel'}
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  )}
                </>
              )}
            </Panel>
          ) : null}

          {tab === 'account' ? (
            <Panel
              title="warframe.market account"
              subtitle="Paste your browser JWT — password never leaves the site"
            >
              {session.linked ? (
                <div className="market-account-linked">
                  <p>
                    Linked as <strong>{session.ingameName}</strong>
                    {session.reputation != null ? ` · ${session.reputation} rep` : ''}
                  </p>
                  <p className="muted market-jwt-note">
                    Token is stored encrypted on this PC when the OS allows it. In-game trade
                    completion still happens in Warframe.
                  </p>
                  <div className="market-actions">
                    <button
                      className="btn ghost"
                      onClick={() =>
                        void window.voidlens.openExternal(
                          `https://warframe.market/profile/${encodeURIComponent(session.ingameName || '')}`,
                        )
                      }
                    >
                      Open profile
                    </button>
                    <button className="btn ghost danger" onClick={() => void unlink()} disabled={authBusy}>
                      Sign out
                    </button>
                  </div>
                </div>
              ) : (
                <div className="market-jwt">
                  <ol className="market-jwt-steps muted">
                    <li>
                      Open{' '}
                      <button
                        type="button"
                        className="linkish"
                        onClick={() => void window.voidlens.openExternal('https://warframe.market/')}
                      >
                        warframe.market
                      </button>{' '}
                      and sign in
                    </li>
                    <li>DevTools → Application/Storage → Cookies → warframe.market → JWT</li>
                    <li>Copy the cookie value and paste it below</li>
                  </ol>
                  {onOpenHelp ? (
                    <p className="muted market-jwt-help">
                      Need screenshots-level detail?{' '}
                      <button type="button" className="linkish" onClick={onOpenHelp}>
                        Full steps in Help
                      </button>
                    </p>
                  ) : null}
                  <textarea
                    value={jwtDraft}
                    placeholder="Paste JWT cookie value…"
                    rows={3}
                    spellCheck={false}
                    autoComplete="off"
                    onChange={(e) => setJwtDraft(e.target.value)}
                  />
                  <div className="market-jwt-actions">
                    <button
                      className="btn primary"
                      onClick={() => void linkJwt()}
                      disabled={authBusy || !jwtDraft.trim()}
                    >
                      {authBusy ? 'Verifying…' : 'Link account'}
                    </button>
                  </div>
                  {session.error ? <p className="market-error">{session.error}</p> : null}
                  <p className="muted market-jwt-note">
                    Token is stored encrypted on this PC when the OS allows it. You can create and
                    cancel listings here; in-game trade completion still happens in Warframe.
                  </p>
                </div>
              )}
            </Panel>
          ) : null}

          {tab === 'account' ? (
            <Panel title="Listing assistant" subtitle="Stock blacklist + stale margin + alerts">
              <label className="market-check" style={{ marginBottom: 10 }}>
                <input
                  type="checkbox"
                  checked={settings.marketBuyAlertEnabled !== false}
                  onChange={(e) => onUpdate({ marketBuyAlertEnabled: e.target.checked })}
                />
                Desktop alerts for buy-target hits (every ~5 min)
              </label>
              <label className="field">
                <span>Stale margin (plat above floor)</span>
                <input
                  type="number"
                  min={0}
                  value={settings.marketStaleMargin ?? 3}
                  onChange={(e) =>
                    onUpdate({
                      marketStaleMargin: Math.max(0, Math.floor(Number(e.target.value) || 0)),
                    })
                  }
                />
              </label>
              <p className="muted" style={{ fontSize: '0.78rem' }}>
                Sell orders priced more than this above the live floor get a Stale badge. Per-item
                min prices are set on Stock rows.
              </p>
              {(settings.marketMinPrices || []).length > 0 ? (
                <p className="muted inventory-meta">
                  {(settings.marketMinPrices || []).length} min-price floor
                  {(settings.marketMinPrices || []).length === 1 ? '' : 's'} set on Stock
                </p>
              ) : null}
              <div className="market-add" style={{ marginTop: 12 }}>
                <input
                  value={blacklistDraft}
                  placeholder="Blacklist item name…"
                  onChange={(e) => setBlacklistDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      const name = blacklistDraft.trim()
                      if (!name) return
                      const list = settings.marketListBlacklist || []
                      if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) {
                        onUpdate({ marketListBlacklist: [...list, name] })
                      }
                      setBlacklistDraft('')
                    }
                  }}
                />
                <button
                  className="btn ghost"
                  type="button"
                  onClick={() => {
                    const name = blacklistDraft.trim()
                    if (!name) return
                    const list = settings.marketListBlacklist || []
                    if (!list.some((x) => x.toLowerCase() === name.toLowerCase())) {
                      onUpdate({ marketListBlacklist: [...list, name] })
                    }
                    setBlacklistDraft('')
                  }}
                >
                  Block
                </button>
              </div>
              {(settings.marketListBlacklist || []).length === 0 ? (
                <p className="muted">No blocked items — Stock won’t list these names.</p>
              ) : (
                <ul className="market-card-list">
                  {(settings.marketListBlacklist || []).map((name) => (
                    <li key={name} className="market-card">
                      <div className="market-card__body">
                        <strong>{name}</strong>
                      </div>
                      <button
                        type="button"
                        className="btn ghost"
                        onClick={() =>
                          onUpdate({
                            marketListBlacklist: (settings.marketListBlacklist || []).filter(
                              (x) => x !== name,
                            ),
                          })
                        }
                      >
                        Remove
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          ) : null}
        </div>

        <aside className="market-side">
          <Panel title="Latest relic scan" subtitle="From the reward popup">
            {recentRelics.length ? (
              <ul className="market-scan-list">
                {recentRelics.map((r) => (
                  <li key={`${r.slot}-${r.name}`}>
                    <span>
                      {r.name}
                      {r.bestPick ? <span className="market-best"> Best</span> : null}
                    </span>
                    <span className="market-plat">~{r.platinum}p</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted market-side-empty">No priced relic rewards yet.</p>
            )}
          </Panel>
          <Panel title="Latest riven scan" subtitle="Auction estimates">
            {rivens.current || rivens.reroll ? (
              <ul className="market-scan-list">
                {rivens.current ? (
                  <li>
                    <span>Current · {rivens.current.weapon}</span>
                    <span className="market-plat">
                      {rivens.current.platinum != null ? `~${rivens.current.platinum}p` : '—'}
                    </span>
                  </li>
                ) : null}
                {rivens.reroll ? (
                  <li>
                    <span>Reroll · {rivens.reroll.weapon}</span>
                    <span className="market-plat">
                      {rivens.reroll.platinum != null ? `~${rivens.reroll.platinum}p` : '—'}
                    </span>
                  </li>
                ) : null}
              </ul>
            ) : (
              <p className="muted market-side-empty">No riven scan yet.</p>
            )}
          </Panel>
        </aside>
      </div>
    </div>
  )
}
