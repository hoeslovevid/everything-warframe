import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AppSettings, FissureInfo, LfgListing } from '../../../shared/types'
import { EmptyState } from '../../components/EmptyState'
import { Panel } from '../../components/Panel'
import { ToggleRow } from '../../components/ToggleRow'
import { useWorldstate } from '../../hooks/useVoidLens'
import { pushToast } from '../../lib/toast'
import { copyText } from '../../lib/tradeClipboard'
import '../market/market.css'
import './lfg.css'
import { LfgSearchSelect, type LfgSearchOption } from './LfgSearchSelect'
import { catalogMissionOptions } from './lfgMissionCatalog'

type ActivityId = 'relic' | 'fissure' | 'farm' | 'boss' | 'custom'

export type LfgPrefill = {
  relicKey: string
  title?: string
  shareType?: 'radshare' | 'intactshare' | 'any'
  activity?: ActivityId
}

type Props = {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
  /** When false (parked tab), pause board polling to save hub traffic. */
  active?: boolean
  /** One-shot form fill from Relic Recommend (etc.). */
  prefill?: LfgPrefill | null
  onPrefillConsumed?: () => void
}

function etaMs(expiresAt: string, nowMs: number) {
  const ms = Date.parse(expiresAt) - nowMs
  return Number.isFinite(ms) ? ms : 0
}

function etaLabel(expiresAt: string, nowMs: number) {
  const ms = etaMs(expiresAt, nowMs)
  if (ms <= 0) return 'expired'
  const m = Math.ceil(ms / 60_000)
  return m < 60 ? `${m}m` : `${Math.floor(m / 60)}h ${m % 60}m`
}

function etaUrgency(expiresAt: string, nowMs: number): 'ok' | 'soon' | 'urgent' | 'expired' {
  const ms = etaMs(expiresAt, nowMs)
  if (ms <= 0) return 'expired'
  if (ms < 3 * 60_000) return 'urgent'
  if (ms < 8 * 60_000) return 'soon'
  return 'ok'
}

function SlotDots({ filled, total }: { filled: number; total: number }) {
  const n = Math.min(4, Math.max(2, total))
  return (
    <span className="lfg-slots" title={`${filled}/${n} seats`} aria-label={`${filled} of ${n} seats`}>
      {Array.from({ length: n }, (_, i) => (
        <span key={i} className={`lfg-slots__dot ${i < filled ? 'is-filled' : ''}`} />
      ))}
    </span>
  )
}

function buildWhisperPreview(input: {
  ign: string
  title: string
  relicKey: string
  shareType: string | null
  steelPath: boolean
  missionHint: string
  members: number
  slotsTotal: number
  platform: string
  region: string
}) {
  const bits = [`LFG ${input.title}`.trim()]
  if (input.relicKey) bits.push(input.relicKey)
  if (input.shareType) bits.push(input.shareType)
  if (input.steelPath) bits.push('SP')
  if (input.missionHint) bits.push(input.missionHint)
  bits.push(`${input.members}/${input.slotsTotal}`)
  bits.push(input.platform.toUpperCase())
  bits.push(input.region.toUpperCase())
  const ign = input.ign.trim() || 'YourIGN'
  return `/w ${ign} ${bits.join(' · ')}`.replace(/\s+/g, ' ').trim()
}

const PRESETS: Array<{
  id: string
  label: string
  apply: () => {
    activity: ActivityId
    title: string
    relicKey?: string
    shareType?: 'radshare' | 'intactshare' | 'any'
    refinement?: string
    steelPath?: boolean
    missionHint?: string
  }
}> = [
  {
    id: 'axi-rad',
    label: 'Axi radshare',
    apply: () => ({
      activity: 'relic',
      title: 'Axi radshare',
      relicKey: '',
      shareType: 'radshare',
      refinement: 'radiant',
      steelPath: false,
    }),
  },
  {
    id: 'lith-fis',
    label: 'Lith fissure',
    apply: () => ({
      activity: 'fissure',
      title: 'Lith Fissure',
      steelPath: false,
      missionHint: '',
    }),
  },
  {
    id: 'profit-taker',
    label: 'Profit Taker',
    apply: () => ({
      activity: 'boss',
      title: 'Profit Taker',
      steelPath: false,
      missionHint: 'Profit Taker · Orb Vallis',
    }),
  },
  {
    id: 'eidolons',
    label: 'Eidolons',
    apply: () => ({
      activity: 'boss',
      title: 'Eidolon hunt',
      steelPath: false,
      missionHint: 'Eidolons · Plains of Eidolon',
    }),
  },
  {
    id: 'index',
    label: 'Index',
    apply: () => ({
      activity: 'farm',
      title: 'Index credits',
      steelPath: false,
      missionHint: 'The Index · Neptune',
    }),
  },
  {
    id: 'sp-surv',
    label: 'SP survival',
    apply: () => ({
      activity: 'farm',
      title: 'SP Survival',
      steelPath: true,
      missionHint: 'Survival',
    }),
  },
  {
    id: 'eso',
    label: 'ESO',
    apply: () => ({
      activity: 'farm',
      title: 'ESO',
      steelPath: false,
      missionHint: 'Elite Sanctuary Onslaught',
    }),
  },
]

function regionLabel(r: string) {
  return r.toUpperCase()
}

function platformLabel(p: string) {
  const map: Record<string, string> = {
    pc: 'PC',
    psn: 'PlayStation',
    xbox: 'Xbox',
    switch: 'Switch',
    mobile: 'Mobile',
  }
  return map[p] || p.toUpperCase()
}

export function LfgPage({
  settings,
  onUpdate,
  active = true,
  prefill = null,
  onPrefillConsumed,
}: Props) {
  const { data } = useWorldstate()
  const titleInputRef = useRef<HTMLInputElement | null>(null)
  const memberSnapshotRef = useRef<Map<string, string[]>>(new Map())
  const [listings, setListings] = useState<LfgListing[]>([])
  const [baseUrl, setBaseUrl] = useState('')
  const [hubOk, setHubOk] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [copied, setCopied] = useState<string | null>(null)
  const [copiedInvite, setCopiedInvite] = useState<string | null>(null)
  const [copiedIgns, setCopiedIgns] = useState<string | null>(null)
  const [hubAdvanced, setHubAdvanced] = useState(false)
  const [nowMs, setNowMs] = useState(() => Date.now())
  const [openSeatsOnly, setOpenSeatsOnly] = useState(true)

  const [filterActivity, setFilterActivity] = useState('all')
  const [filterRegion, setFilterRegion] = useState<string>(() => settings.lfgRegion || 'all')
  const [filterPlatform, setFilterPlatform] = useState<string>(() => settings.lfgPlatform || 'all')
  const [qInput, setQInput] = useState('')
  const [qDebounced, setQDebounced] = useState('')

  const [activity, setActivity] = useState<ActivityId>('relic')
  const [title, setTitle] = useState('Radshare')
  const [relicKey, setRelicKey] = useState('')
  const [shareType, setShareType] = useState<'radshare' | 'intactshare' | 'any'>('radshare')
  const [refinement, setRefinement] = useState('radiant')
  const [steelPath, setSteelPath] = useState(false)
  const [missionHint, setMissionHint] = useState('')
  const [notes, setNotes] = useState('')
  const [slotsTotal, setSlotsTotal] = useState(4)
  const [ttlMin, setTtlMin] = useState(15)
  const [relicOptions, setRelicOptions] = useState<LfgSearchOption[]>([])
  const [relicsLoading, setRelicsLoading] = useState(false)

  const clientId = settings.lfgClientId?.trim() || ''
  const hostTokens = settings.lfgHostTokens || {}

  const showToast = useCallback((msg: string) => {
    setToast(msg)
    window.setTimeout(() => setToast(null), 2200)
  }, [])

  const ownedRelicKeys = useMemo(() => {
    const set = new Set<string>()
    for (const o of relicOptions) {
      if (Number(o.meta?.owned) > 0 && o.value) set.add(String(o.value).toLowerCase())
    }
    return set
  }, [relicOptions])

  const ownsRelic = useCallback(
    (key: string | null | undefined) => {
      if (!key) return false
      return ownedRelicKeys.has(key.trim().toLowerCase())
    },
    [ownedRelicKeys],
  )

  useEffect(() => {
    if (settings.lfgClientId?.trim()) return
    const id =
      typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `ew-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    onUpdate({ lfgClientId: id })
  }, [settings.lfgClientId, onUpdate])

  useEffect(() => {
    const t = window.setInterval(() => setNowMs(Date.now()), 15_000)
    return () => window.clearInterval(t)
  }, [])

  useEffect(() => {
    const t = window.setTimeout(() => setQDebounced(qInput.trim()), 300)
    return () => window.clearTimeout(t)
  }, [qInput])

  useEffect(() => {
    if (!prefill?.relicKey) return
    setActivity(prefill.activity || 'relic')
    setRelicKey(prefill.relicKey)
    setShareType(prefill.shareType || 'radshare')
    setRefinement('radiant')
    setTitle(prefill.title?.trim() || `${prefill.relicKey} radshare`)
    setSteelPath(false)
    onPrefillConsumed?.()
    window.setTimeout(() => {
      titleInputRef.current?.focus()
      titleInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }, 80)
  }, [prefill, onPrefillConsumed])

  useEffect(() => {
    if (!window.voidlens?.getLfgRelicOptions) return
    let cancelled = false
    setRelicsLoading(true)
    void window.voidlens
      .getLfgRelicOptions()
      .then((rows) => {
        if (cancelled) return
        setRelicOptions(
          (rows || []).map((r) => ({
            id: r.id,
            label: r.label,
            value: r.value,
            detail: r.detail,
            meta: { owned: r.owned },
          })),
        )
      })
      .catch(() => {
        if (!cancelled) setRelicOptions([])
      })
      .finally(() => {
        if (!cancelled) setRelicsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const openFissures = useMemo(() => {
    return (data.fissures || []).filter((f) => !steelPath || f.isHard)
  }, [data.fissures, steelPath])

  const missionOptions = useMemo((): LfgSearchOption[] => {
    const live: LfgSearchOption[] = []
    for (const f of openFissures) {
      const hint = `${f.missionType} · ${f.node}`
      live.push({
        id: `fis-${f.id}`,
        label: `${f.tier} · ${f.node}`,
        value: hint,
        detail: [
          'Live fissure',
          f.missionType,
          f.enemy,
          f.isHard ? 'Steel Path' : null,
          f.eta ? `ETA ${f.eta}` : null,
        ]
          .filter(Boolean)
          .join(' · '),
        meta: {
          kind: 'fissure',
          node: f.node,
          missionType: f.missionType,
          isHard: f.isHard,
          tier: f.tier,
        },
      })
    }
    const arb = data.arbitration
    if (arb?.node) {
      const hint = `${arb.type || 'Arbitration'} · ${arb.node}`
      live.push({
        id: 'arb',
        label: `Arbitration · ${arb.node}`,
        value: hint,
        detail: ['Live', arb.enemy || 'Arbitration'].filter(Boolean).join(' · '),
        meta: { kind: 'arbitration', node: arb.node, missionType: arb.type },
      })
    }
    const sortie = data.sortie
    if (sortie?.missions?.length) {
      sortie.missions.forEach((m, i) => {
        const hint = `${m.missionType || 'Sortie'} · ${m.node}`
        live.push({
          id: `sortie-${i}`,
          label: `Sortie ${i + 1} · ${m.node}`,
          value: hint,
          detail: ['Live sortie', m.missionType, m.modifier].filter(Boolean).join(' · '),
          meta: { kind: 'sortie', node: m.node, missionType: m.missionType },
        })
      })
    }
    const catalog = catalogMissionOptions(activity)
    // Live first, then catalog (dedupe by value)
    const seen = new Set(live.map((o) => o.value.toLowerCase()))
    const merged = [...live]
    for (const o of catalog) {
      if (seen.has(o.value.toLowerCase())) continue
      seen.add(o.value.toLowerCase())
      merged.push(o)
    }
    return merged
  }, [openFissures, data.arbitration, data.sortie, activity])

  const quickFissures = useMemo(() => openFissures.slice(0, 6), [openFissures])

  const whisperPreview = useMemo(
    () =>
      buildWhisperPreview({
        ign: settings.lfgIgn,
        title: title.trim() || 'LFG',
        relicKey: activity === 'relic' ? relicKey.trim() : '',
        shareType: activity === 'relic' ? shareType : null,
        steelPath,
        missionHint: missionHint.trim(),
        members: 1,
        slotsTotal,
        platform: settings.lfgPlatform,
        region: settings.lfgRegion,
      }),
    [
      settings.lfgIgn,
      settings.lfgPlatform,
      settings.lfgRegion,
      title,
      activity,
      relicKey,
      shareType,
      steelPath,
      missionHint,
      slotsTotal,
    ],
  )

  const hubMode = useMemo(() => {
    const configured = String(settings.lfgApiBaseUrl || '').trim().toLowerCase()
    if (configured === 'local') return 'local' as const
    if (/127\.0\.0\.1|localhost/i.test(baseUrl)) return 'local' as const
    return 'community' as const
  }, [settings.lfgApiBaseUrl, baseUrl])

  const filtersNarrowed = useMemo(() => {
    const regionMine = filterRegion === settings.lfgRegion
    const platformMine = filterPlatform === settings.lfgPlatform
    return (
      (filterRegion !== 'all' && regionMine) ||
      (filterPlatform !== 'all' && platformMine) ||
      filterRegion !== 'all' ||
      filterPlatform !== 'all' ||
      filterActivity !== 'all' ||
      openSeatsOnly
    )
  }, [
    filterRegion,
    filterPlatform,
    filterActivity,
    openSeatsOnly,
    settings.lfgRegion,
    settings.lfgPlatform,
  ])

  const showingMineScope =
    filterRegion === settings.lfgRegion && filterPlatform === settings.lfgPlatform

  const detectJoins = useCallback(
    (next: LfgListing[]) => {
      const prev = memberSnapshotRef.current
      const nextMap = new Map<string, string[]>()
      for (const l of next) {
        const isHost = Boolean(hostTokens[l.id])
        const igns = l.members.map((m) => m.ign)
        nextMap.set(l.id, igns)
        if (!isHost) continue
        const before = prev.get(l.id)
        if (!before) continue
        const newcomers = igns.filter((ign) => !before.includes(ign))
        for (const ign of newcomers) {
          const msg = `${ign} joined “${l.title}”`
          showToast(msg)
          pushToast(msg, 'ok', 5000)
          void window.voidlens?.desktopNotify?.({
            title: 'LFG — squad join',
            body: msg,
          })
        }
      }
      memberSnapshotRef.current = nextMap
    },
    [hostTokens, showToast],
  )

  const sortedListings = useMemo(() => {
    const mine = (l: LfgListing) =>
      Boolean(hostTokens[l.id]) || l.members.some((m) => m.clientId === clientId)
    let rows = [...listings]
    if (openSeatsOnly) rows = rows.filter((l) => l.slotsOpen > 0 || mine(l))
    return rows.sort((a, b) => {
      const am = mine(a) ? 0 : 1
      const bm = mine(b) ? 0 : 1
      if (am !== bm) return am - bm
      return Date.parse(b.createdAt) - Date.parse(a.createdAt)
    })
  }, [listings, hostTokens, clientId, openSeatsOnly])

  const mySquads = useMemo(() => {
    return listings.filter(
      (l) => Boolean(hostTokens[l.id]) || l.members.some((m) => m.clientId === clientId),
    )
  }, [listings, hostTokens, clientId])

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!window.voidlens?.listLfg) return false
    setLoading(true)
    try {
      const res = await window.voidlens.listLfg({
        region: filterRegion,
        activity: filterActivity,
        q: qDebounced || undefined,
        platform: filterPlatform === 'all' ? undefined : filterPlatform,
      })
      setListings(res.listings)
      detectJoins(res.listings)
      setBaseUrl(res.baseUrl)
      setHubOk(!res.error)
      if (res.error) {
        setError(res.error)
        return /rate|429/i.test(res.error)
      }
      setError(res.warning || null)
      return Boolean(res.warning && /rate|429|Railway edge/i.test(res.warning))
    } catch (err) {
      setHubOk(false)
      const msg = err instanceof Error ? err.message : 'LFG failed'
      setError(msg)
      return /rate|429/i.test(msg)
    } finally {
      setLoading(false)
    }
  }, [filterActivity, filterRegion, filterPlatform, qDebounced, detectJoins])

  useEffect(() => {
    if (!active) return
    let cancelled = false
    let timer: number | undefined
    let delay = 20_000

    const tick = async () => {
      if (cancelled) return
      const rateLimited = await refresh()
      delay = rateLimited ? Math.min(90_000, Math.round(delay * 1.6)) : 20_000
      if (!cancelled) timer = window.setTimeout(() => void tick(), delay)
    }

    void tick()
    return () => {
      cancelled = true
      if (timer) window.clearTimeout(timer)
    }
  }, [refresh, active])

  const saveProfile = (partial: Partial<AppSettings>) => onUpdate(partial)

  const focusPostForm = () => {
    titleInputRef.current?.focus()
    titleInputRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  const showAllFilters = () => {
    setFilterRegion('all')
    setFilterPlatform('all')
    setFilterActivity('all')
    setOpenSeatsOnly(false)
    setQInput('')
  }

  const applyPreset = (id: string) => {
    const preset = PRESETS.find((p) => p.id === id)
    if (!preset) return
    const next = preset.apply()
    setActivity(next.activity)
    setTitle(next.title)
    if (next.relicKey !== undefined) setRelicKey(next.relicKey)
    if (next.shareType) setShareType(next.shareType)
    if (next.refinement) setRefinement(next.refinement)
    if (next.steelPath !== undefined) setSteelPath(next.steelPath)
    if (next.missionHint !== undefined) setMissionHint(next.missionHint)
  }

  const create = async () => {
    const ign = settings.lfgIgn.trim()
    if (!ign) {
      setError('Set your in-game name in the profile panel')
      return
    }
    const cid =
      clientId ||
      (typeof crypto !== 'undefined' && crypto.randomUUID
        ? crypto.randomUUID()
        : `ew-${Date.now()}`)
    if (!clientId) onUpdate({ lfgClientId: cid })
    if (!window.voidlens?.createLfg) return
    setBusyId('create')
    setError(null)
    try {
      const res = await window.voidlens.createLfg({
        hostIgn: ign,
        clientId: cid,
        platform: settings.lfgPlatform,
        region: settings.lfgRegion,
        language: settings.lfgLanguage || 'en',
        activity,
        title: title.trim() || 'LFG',
        notes: notes.trim(),
        relicKey: relicKey.trim() || null,
        refinement: activity === 'relic' ? refinement : null,
        shareType: activity === 'relic' ? shareType : null,
        steelPath,
        missionHint: missionHint.trim() || null,
        slotsTotal,
        ttlMs: ttlMin * 60_000,
      })
      if (!res.ok || !res.listing) {
        setError(res.error || 'Create failed')
        return
      }
      if (res.hostToken) {
        onUpdate({
          lfgHostTokens: { ...hostTokens, [res.listing.id]: res.hostToken },
        })
      }
      setNotes('')
      setMissionHint('')
      await refresh()
      if (res.listing.whisper) {
        await copyText(res.listing.whisper)
        setCopied(res.listing.id)
        window.setTimeout(() => setCopied(null), 1600)
      }
      showToast('Squad posted · whisper copied')
    } finally {
      setBusyId(null)
    }
  }

  const join = async (listing: LfgListing) => {
    const ign = settings.lfgIgn.trim()
    if (!ign) {
      setError('Set your in-game name first')
      return
    }
    setBusyId(listing.id)
    try {
      const res = await window.voidlens.joinLfg({ id: listing.id, ign, clientId })
      if (!res.ok || !res.listing) {
        setError(res.error || 'Join failed')
        return
      }
      await copyText(res.listing.whisper)
      setCopied(listing.id)
      window.setTimeout(() => setCopied(null), 1600)
      showToast(`Joined ${listing.hostIgn} · whisper copied`)
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const closeListing = async (listing: LfgListing) => {
    const token = hostTokens[listing.id]
    if (!token || !window.voidlens?.deleteLfg) return
    if (!window.confirm(`Close “${listing.title}”?`)) return
    setBusyId(listing.id)
    try {
      await window.voidlens.deleteLfg({ id: listing.id, hostToken: token })
      const next = { ...hostTokens }
      delete next[listing.id]
      onUpdate({ lfgHostTokens: next })
      showToast('Listing closed')
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const extendListing = async (listing: LfgListing) => {
    const token = hostTokens[listing.id]
    if (!token || !window.voidlens?.extendLfg) return
    setBusyId(`extend-${listing.id}`)
    try {
      const res = await window.voidlens.extendLfg({
        id: listing.id,
        hostToken: token,
        addMs: 10 * 60_000,
      })
      if (!res.ok) {
        setError(res.error || 'Extend failed')
        return
      }
      showToast('Extended +10m')
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const leave = async (listing: LfgListing) => {
    setBusyId(listing.id)
    try {
      await window.voidlens.leaveLfg({ id: listing.id, clientId })
      showToast('Left squad')
      await refresh()
    } finally {
      setBusyId(null)
    }
  }

  const copyIgns = async (listing: LfgListing) => {
    const line = listing.members.map((m) => m.ign).join(', ')
    const ok = await copyText(line)
    if (!ok) return
    setCopiedIgns(listing.id)
    window.setTimeout(() => setCopiedIgns(null), 1400)
    showToast('Squad IGNs copied')
  }

  const applyFissure = (f: FissureInfo) => {
    setSteelPath(f.isHard)
    setMissionHint(`${f.missionType} · ${f.node}`)
    setActivity('fissure')
    setTitle(f.isHard ? `SP ${f.tier} Fissure` : `${f.tier} Fissure`)
  }

  const onPickMission = (option: LfgSearchOption) => {
    const kind = String(option.meta?.kind || '')
    const hard = Boolean(option.meta?.isHard)
    if (kind === 'fissure') {
      setSteelPath(hard)
      setActivity('fissure')
      const tier = String(option.meta?.tier || '')
      setTitle(hard ? `SP ${tier} Fissure`.trim() : `${tier} Fissure`.trim() || 'Fissure')
      return
    }
    if (kind === 'arbitration') {
      setActivity('farm')
      setTitle('Arbitration')
      return
    }
    if (kind === 'sortie') {
      setActivity('farm')
      setTitle('Sortie')
    }
  }

  const onPickRelic = (option: LfgSearchOption) => {
    setActivity('relic')
    if (!title.trim() || title === 'Radshare' || title === 'LFG') {
      setTitle(`${option.value} radshare`)
    }
  }

  const renderCardActions = (l: LfgListing) => {
    const isHost = Boolean(hostTokens[l.id])
    const inSquad = l.members.some((m) => m.clientId === clientId)
    return (
      <div className="market-actions">
        <button
          className="btn ghost"
          type="button"
          onClick={() =>
            void copyText(l.whisper).then((ok) => {
              if (!ok) return
              setCopied(l.id)
              window.setTimeout(() => setCopied(null), 1400)
              showToast('Whisper copied')
            })
          }
        >
          {copied === l.id ? 'Copied' : 'Whisper'}
        </button>
        <button
          className="btn ghost"
          type="button"
          onClick={() =>
            void copyText(l.inviteHint || `/invite ${l.hostIgn}`).then((ok) => {
              if (!ok) return
              setCopiedInvite(l.id)
              window.setTimeout(() => setCopiedInvite(null), 1400)
              showToast('Invite line copied')
            })
          }
        >
          {copiedInvite === l.id ? 'Copied' : 'Invite'}
        </button>
        <button className="btn ghost" type="button" onClick={() => void copyIgns(l)}>
          {copiedIgns === l.id ? 'Copied' : 'IGNs'}
        </button>
        {!inSquad && l.slotsOpen > 0 ? (
          <button
            className="btn primary"
            type="button"
            disabled={busyId === l.id}
            onClick={() => void join(l)}
          >
            {busyId === l.id ? '…' : 'Join'}
          </button>
        ) : null}
        {inSquad && !isHost ? (
          <button
            className="btn ghost"
            type="button"
            disabled={busyId === l.id}
            onClick={() => void leave(l)}
          >
            Leave
          </button>
        ) : null}
        {isHost ? (
          <>
            <button
              className="btn ghost"
              type="button"
              disabled={busyId === `extend-${l.id}`}
              onClick={() => void extendListing(l)}
              title="Add 10 minutes"
            >
              {busyId === `extend-${l.id}` ? '…' : '+10m'}
            </button>
            <button
              className="btn ghost danger"
              type="button"
              disabled={busyId === l.id}
              onClick={() => void closeListing(l)}
            >
              Close
            </button>
          </>
        ) : null}
      </div>
    )
  }

  const renderListingCard = (l: LfgListing) => {
    const isHost = Boolean(hostTokens[l.id])
    const inSquad = l.members.some((m) => m.clientId === clientId)
    const isMine = isHost || inSquad
    const activityClass = ['relic', 'fissure', 'farm', 'boss', 'custom'].includes(l.activity)
      ? l.activity
      : 'custom'
    const urgency = etaUrgency(l.expiresAt, nowMs)
    const owned = ownsRelic(l.relicKey)
    return (
      <li
        key={l.id}
        className={`market-card lfg-card ${isMine ? 'lfg-card--mine' : ''} ${
          urgency === 'urgent' || urgency === 'expired' ? 'lfg-card--urgent' : ''
        } ${owned ? 'lfg-card--owned' : ''}`}
      >
        <div className="market-card__body lfg-card__body">
          <div className="lfg-card__head">
            <div className="market-card__title">
              <span className={`market-chip market-chip--${activityClass}`}>{l.activity}</span>
              <strong>{l.title}</strong>
              {l.steelPath ? <span className="market-chip market-chip--warn">SP</span> : null}
              {owned ? <span className="lfg-owned-badge">Owned</span> : null}
              {isMine ? <span className="lfg-you-badge">You</span> : null}
            </div>
            <div className="lfg-card__primary">
              <span className="lfg-card__host" title="Host">
                {l.hostIgn}
              </span>
              <SlotDots filled={l.members.length} total={l.slotsTotal} />
              <span className={`lfg-eta lfg-eta--${urgency}`}>{etaLabel(l.expiresAt, nowMs)}</span>
            </div>
          </div>
          <div className="lfg-card__meta muted">
            <span>{platformLabel(l.platform)}</span>
            <span>{regionLabel(l.region)}</span>
            {l.relicKey ? <span>{l.relicKey}</span> : null}
            {l.shareType ? <span>{l.shareType}</span> : null}
            {l.refinement ? <span>{l.refinement}</span> : null}
            {l.missionHint ? <span>{l.missionHint}</span> : null}
          </div>
          {l.notes ? <p className="lfg-card__notes muted">{l.notes}</p> : null}
          <p className="lfg-card__members muted">{l.members.map((m) => m.ign).join(' · ')}</p>
        </div>
        {renderCardActions(l)}
      </li>
    )
  }

  return (
    <>
      <header className="page-header">
        <h2 className="page-title">LFG</h2>
        <div className="page-title-rule" />
        <p className="page-desc lfg-page-desc">
          Post a squad or join open queues — whisper / invite copy in one click.
          <span
            className={`lfg-hub-pill ${hubOk ? 'is-ok' : 'is-bad'}`}
            title={baseUrl || undefined}
          >
            {hubMode === 'local' ? 'Local' : 'Community'}
            {' · '}
            {hubOk ? 'OK' : 'Offline'}
          </span>
        </p>
      </header>

      {toast ? (
        <div className="lfg-toast" role="status">
          {toast}
        </div>
      ) : null}

      {mySquads.length ? (
        <div className="lfg-sticky-bar" role="region" aria-label="Your active squads">
          {mySquads.map((l) => {
            const isHost = Boolean(hostTokens[l.id])
            const urgency = etaUrgency(l.expiresAt, nowMs)
            return (
              <div key={l.id} className="lfg-sticky-bar__row">
                <div className="lfg-sticky-bar__info">
                  <span className="lfg-you-badge">{isHost ? 'Hosting' : 'Joined'}</span>
                  <strong>{l.title}</strong>
                  <SlotDots filled={l.members.length} total={l.slotsTotal} />
                  <span className={`lfg-eta lfg-eta--${urgency}`}>{etaLabel(l.expiresAt, nowMs)}</span>
                </div>
                <div className="lfg-sticky-bar__actions">
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() =>
                      void copyText(l.whisper).then((ok) => {
                        if (ok) showToast('Whisper copied')
                      })
                    }
                  >
                    Whisper
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={() =>
                      void copyText(l.inviteHint || `/invite ${l.hostIgn}`).then((ok) => {
                        if (ok) showToast('Invite line copied')
                      })
                    }
                  >
                    Invite
                  </button>
                  {isHost ? (
                    <>
                      <button
                        type="button"
                        className="btn ghost"
                        disabled={busyId === `extend-${l.id}`}
                        onClick={() => void extendListing(l)}
                      >
                        +10m
                      </button>
                      <button
                        type="button"
                        className="btn ghost danger"
                        disabled={busyId === l.id}
                        onClick={() => void closeListing(l)}
                      >
                        Close
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      className="btn ghost"
                      disabled={busyId === l.id}
                      onClick={() => void leave(l)}
                    >
                      Leave
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      ) : null}

      <div className="lfg-layout">
        <aside className="lfg-side">
          <Panel
            title="Your profile"
            subtitle={
              settings.lfgIgn.trim()
                ? `${settings.lfgIgn} · ${platformLabel(settings.lfgPlatform)} · ${regionLabel(settings.lfgRegion)}`
                : 'Set your IGN so others can whisper you'
            }
          >
            {!settings.lfgIgn.trim() ? (
              <label className="field">
                <span>In-game name</span>
                <input
                  value={settings.lfgIgn}
                  placeholder="Warframe IGN"
                  onChange={(e) => saveProfile({ lfgIgn: e.target.value })}
                />
              </label>
            ) : (
              <div className="lfg-profile-compact">
                <label className="field" style={{ margin: 0, flex: 1 }}>
                  <span>IGN</span>
                  <input
                    value={settings.lfgIgn}
                    placeholder="Warframe IGN"
                    onChange={(e) => saveProfile({ lfgIgn: e.target.value })}
                  />
                </label>
                <label className="field" style={{ margin: 0, flex: 1 }}>
                  <span>Platform</span>
                  <select
                    value={settings.lfgPlatform}
                    onChange={(e) =>
                      saveProfile({
                        lfgPlatform: e.target.value as AppSettings['lfgPlatform'],
                      })
                    }
                  >
                    <option value="pc">PC</option>
                    <option value="psn">PlayStation</option>
                    <option value="xbox">Xbox</option>
                    <option value="switch">Switch</option>
                    <option value="mobile">Mobile</option>
                  </select>
                </label>
                <label className="field" style={{ margin: 0, flex: 1 }}>
                  <span>Region</span>
                  <select
                    value={settings.lfgRegion}
                    onChange={(e) =>
                      saveProfile({ lfgRegion: e.target.value as AppSettings['lfgRegion'] })
                    }
                  >
                    <option value="na">NA</option>
                    <option value="eu">EU</option>
                    <option value="asia">Asia</option>
                    <option value="sa">SA</option>
                    <option value="oce">OCE</option>
                  </select>
                </label>
              </div>
            )}
            {!settings.lfgIgn.trim() ? (
              <>
                <label className="field">
                  <span>Platform</span>
                  <select
                    value={settings.lfgPlatform}
                    onChange={(e) =>
                      saveProfile({
                        lfgPlatform: e.target.value as AppSettings['lfgPlatform'],
                      })
                    }
                  >
                    <option value="pc">PC</option>
                    <option value="psn">PlayStation</option>
                    <option value="xbox">Xbox</option>
                    <option value="switch">Switch</option>
                    <option value="mobile">Mobile</option>
                  </select>
                </label>
                <label className="field">
                  <span>Region</span>
                  <select
                    value={settings.lfgRegion}
                    onChange={(e) =>
                      saveProfile({ lfgRegion: e.target.value as AppSettings['lfgRegion'] })
                    }
                  >
                    <option value="na">NA</option>
                    <option value="eu">EU</option>
                    <option value="asia">Asia</option>
                    <option value="sa">SA</option>
                    <option value="oce">OCE</option>
                  </select>
                </label>
              </>
            ) : null}
            <button
              type="button"
              className="btn ghost lfg-advanced-toggle"
              onClick={() => setHubAdvanced((v) => !v)}
            >
              {hubAdvanced ? 'Hide hub settings' : 'Advanced hub settings'}
            </button>
            {hubAdvanced ? (
              <div className="lfg-advanced">
                <label className="field">
                  <span>Hub URL</span>
                  <input
                    value={settings.lfgApiBaseUrl}
                    placeholder="Official community board (default)"
                    onChange={(e) => saveProfile({ lfgApiBaseUrl: e.target.value })}
                  />
                </label>
                <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
                  Defaults to the public board. Set to <code>local</code> for a private hub, or paste
                  another hosted URL. On Railway edge 429 the app falls back to local automatically.
                </p>
                <ToggleRow
                  label="Discord notify on post"
                  description="Send your new squads to a Discord channel via webhook (your server only)."
                  checked={settings.lfgDiscordNotifyOnCreate}
                  onChange={(next) => saveProfile({ lfgDiscordNotifyOnCreate: next })}
                />
                <label className="field">
                  <span>Discord webhook URL</span>
                  <input
                    type="password"
                    autoComplete="off"
                    value={settings.lfgDiscordWebhookUrl}
                    placeholder="https://discord.com/api/webhooks/…"
                    onChange={(e) => saveProfile({ lfgDiscordWebhookUrl: e.target.value })}
                    disabled={!settings.lfgDiscordNotifyOnCreate}
                  />
                </label>
                <p className="muted" style={{ fontSize: '0.75rem', margin: 0 }}>
                  Discord → channel settings → Integrations → Webhooks. Stored locally; never sent to
                  the LFG hub.
                </p>
              </div>
            ) : null}
          </Panel>

          <Panel title="Post a squad" subtitle="Pick a preset or fill the form — then post">
            <div className="lfg-presets" role="group" aria-label="Quick presets">
              {PRESETS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="btn ghost lfg-preset-chip"
                  onClick={() => applyPreset(p.id)}
                >
                  {p.label}
                </button>
              ))}
            </div>
            <p className="lfg-form-hint muted">What are you running?</p>
            <div className="vl-segment vl-segment--wrap" role="group" aria-label="Activity">
              {(
                [
                  ['relic', 'Relic'],
                  ['fissure', 'Fissure'],
                  ['farm', 'Farm'],
                  ['boss', 'Boss'],
                  ['custom', 'Custom'],
                ] as const
              ).map(([id, label]) => (
                <button
                  key={id}
                  type="button"
                  className={`vl-segment__btn ${activity === id ? 'is-on' : ''}`}
                  onClick={() => setActivity(id)}
                >
                  {label}
                </button>
              ))}
            </div>
            <label className="field">
              <span>Title</span>
              <input
                ref={titleInputRef}
                value={title}
                placeholder="Short squad title"
                onChange={(e) => setTitle(e.target.value)}
              />
            </label>
            {activity === 'relic' ? (
              <>
                <LfgSearchSelect
                  label="Relic"
                  value={relicKey}
                  options={relicOptions}
                  placeholder={relicsLoading ? 'Loading relics…' : 'Search e.g. Axi A1'}
                  emptyHint={relicsLoading ? 'Loading…' : 'No relics match — type a custom name'}
                  onChange={setRelicKey}
                  onSelect={onPickRelic}
                />
                <div className="lfg-inline-fields">
                  <label className="field" style={{ margin: 0, flex: 1 }}>
                    <span>Share</span>
                    <select
                      value={shareType}
                      onChange={(e) => setShareType(e.target.value as typeof shareType)}
                    >
                      <option value="radshare">Radshare</option>
                      <option value="intactshare">Intactshare</option>
                      <option value="any">Any</option>
                    </select>
                  </label>
                  <label className="field" style={{ margin: 0, flex: 1 }}>
                    <span>Refinement</span>
                    <select value={refinement} onChange={(e) => setRefinement(e.target.value)}>
                      <option value="radiant">Radiant</option>
                      <option value="flawless">Flawless</option>
                      <option value="exceptional">Exceptional</option>
                      <option value="intact">Intact</option>
                    </select>
                  </label>
                </div>
              </>
            ) : null}
            <label className="field lfg-steel-row">
              <input
                type="checkbox"
                checked={steelPath}
                onChange={(e) => setSteelPath(e.target.checked)}
              />
              <span>Steel Path</span>
            </label>
            <LfgSearchSelect
              label="Mission / node"
              value={missionHint}
              options={missionOptions}
              placeholder="Profit Taker, Index, live fissures…"
              emptyHint="Type a custom mission, or pick a suggestion"
              onChange={setMissionHint}
              onSelect={onPickMission}
            />
            {quickFissures.length ? (
              <div className="lfg-fissure-chips" aria-label="Quick fissure picks">
                <span className="lfg-chip-label muted">Live fissures</span>
                {quickFissures.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    className="btn ghost lfg-preset-chip"
                    onClick={() => applyFissure(f)}
                  >
                    {f.tier} {f.node}
                    {f.isHard ? ' SP' : ''}
                  </button>
                ))}
              </div>
            ) : null}
            <label className="field">
              <span>Notes (optional)</span>
              <input
                value={notes}
                maxLength={160}
                placeholder="MR, frame prefs, etc."
                onChange={(e) => setNotes(e.target.value)}
              />
            </label>
            <div className="market-create-row lfg-inline-fields">
              <label className="field" style={{ margin: 0, flex: 1 }}>
                <span>Slots</span>
                <input
                  type="number"
                  min={2}
                  max={4}
                  value={slotsTotal}
                  onChange={(e) =>
                    setSlotsTotal(Math.min(4, Math.max(2, Number(e.target.value) || 4)))
                  }
                />
              </label>
              <label className="field" style={{ margin: 0, flex: 1 }}>
                <span>Expires (min)</span>
                <input
                  type="number"
                  min={5}
                  max={120}
                  value={ttlMin}
                  onChange={(e) =>
                    setTtlMin(Math.min(120, Math.max(5, Number(e.target.value) || 15)))
                  }
                />
              </label>
            </div>
            <div className="lfg-whisper-preview">
              <span className="lfg-whisper-preview__label">Whisper preview</span>
              <code>{whisperPreview}</code>
            </div>
            <button
              className="btn primary"
              type="button"
              disabled={busyId === 'create' || !settings.lfgIgn.trim()}
              onClick={() => void create()}
              style={{ width: '100%', marginTop: 8 }}
            >
              {busyId === 'create'
                ? 'Posting…'
                : !settings.lfgIgn.trim()
                  ? 'Set your IGN to post'
                  : 'Post squad'}
            </button>
          </Panel>
        </aside>

        <section className="lfg-main">
          <Panel
            title="Open queues"
            subtitle="Join copies a whisper — roster updates live with Discord joins too"
            actions={
              <button
                className="btn ghost"
                type="button"
                disabled={loading}
                onClick={() => void refresh()}
              >
                {loading ? '…' : 'Refresh'}
              </button>
            }
          >
            <div className="market-add lfg-filters" style={{ marginBottom: 10 }}>
              <input
                value={qInput}
                placeholder="Search title / relic / host…"
                onChange={(e) => setQInput(e.target.value)}
              />
              <select value={filterActivity} onChange={(e) => setFilterActivity(e.target.value)}>
                <option value="all">All activities</option>
                <option value="relic">Relic</option>
                <option value="fissure">Fissure</option>
                <option value="farm">Farm</option>
                <option value="boss">Boss</option>
                <option value="custom">Custom</option>
              </select>
              <select value={filterRegion} onChange={(e) => setFilterRegion(e.target.value)}>
                <option value="all">All regions</option>
                <option value="na">NA</option>
                <option value="eu">EU</option>
                <option value="asia">Asia</option>
                <option value="sa">SA</option>
                <option value="oce">OCE</option>
              </select>
              <select value={filterPlatform} onChange={(e) => setFilterPlatform(e.target.value)}>
                <option value="all">All platforms</option>
                <option value="pc">PC</option>
                <option value="psn">PlayStation</option>
                <option value="xbox">Xbox</option>
                <option value="switch">Switch</option>
                <option value="mobile">Mobile</option>
              </select>
              <label className="lfg-open-seats">
                <input
                  type="checkbox"
                  checked={openSeatsOnly}
                  onChange={(e) => setOpenSeatsOnly(e.target.checked)}
                />
                Open seats
              </label>
            </div>

            {filtersNarrowed ? (
              <div className="lfg-filter-chip" role="status">
                <span>
                  Showing
                  {showingMineScope
                    ? ` ${regionLabel(settings.lfgRegion)} · ${platformLabel(settings.lfgPlatform)}`
                    : [
                        filterRegion !== 'all' ? regionLabel(filterRegion) : null,
                        filterPlatform !== 'all' ? platformLabel(filterPlatform) : null,
                        filterActivity !== 'all' ? filterActivity : null,
                      ]
                        .filter(Boolean)
                        .map((x) => ` ${x}`)
                        .join(' ·') || ' filtered'}
                  {openSeatsOnly ? ' · open seats' : ''}
                </span>
                <button type="button" className="btn ghost" onClick={showAllFilters}>
                  Show all
                </button>
              </div>
            ) : null}

            {error ? <p className="market-error">{error}</p> : null}

            {loading && listings.length === 0 ? (
              <ul className="market-card-list lfg-skeleton-list" aria-hidden>
                {[0, 1, 2].map((i) => (
                  <li key={i} className="market-card lfg-skeleton">
                    <div className="lfg-skeleton__line lfg-skeleton__line--title" />
                    <div className="lfg-skeleton__line" />
                    <div className="lfg-skeleton__line lfg-skeleton__line--short" />
                  </li>
                ))}
              </ul>
            ) : sortedListings.length === 0 ? (
              <EmptyState
                title="No open queues"
                body={
                  hubOk
                    ? showingMineScope
                      ? `Nothing for ${regionLabel(settings.lfgRegion)} · ${platformLabel(
                          settings.lfgPlatform,
                        )} right now — try Show all, or post a squad.`
                      : 'Be the first — post a squad and others can join from this board.'
                    : 'Hub unreachable. Check Advanced hub settings, or set Hub URL to local.'
                }
                actions={
                  <>
                    {hubOk && filtersNarrowed ? (
                      <button className="btn ghost" type="button" onClick={showAllFilters}>
                        Show all regions
                      </button>
                    ) : null}
                    {hubOk ? (
                      <button className="btn primary" type="button" onClick={focusPostForm}>
                        Post your first squad
                      </button>
                    ) : (
                      <button className="btn primary" type="button" onClick={() => void refresh()}>
                        Retry hub
                      </button>
                    )}
                  </>
                }
              />
            ) : (
              <ul className="market-card-list">{sortedListings.map(renderListingCard)}</ul>
            )}
          </Panel>
        </section>
      </div>
    </>
  )
}
