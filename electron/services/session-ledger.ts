/**
 * Unified session ledger: haul + market trades + rivens + arbitration.
 */
import type { SessionLedgerSnapshot } from '../../shared/types'
import { getArbitrationAnalytics } from './arbitration-log'
import { getMarketTradeLog } from './market-trade-log'
import { getRivenHistory } from './riven-history'
import { getSessionHaul } from './session-haul'

export function getSessionLedger(): SessionLedgerSnapshot {
  const haul = getSessionHaul()
  const trades = getMarketTradeLog()
  const rivens = getRivenHistory()
  const arb = getArbitrationAnalytics()

  const sessionStart = new Date(haul.startedAt).getTime()
  const sessionRivenScans = rivens.entries.filter((e) => {
    const t = new Date(e.scannedAt).getTime()
    return !Number.isNaN(t) && t >= sessionStart
  }).length

  const sessionArbRuns = arb.runs.filter((r) => {
    const t = new Date(r.at).getTime()
    return !Number.isNaN(t) && t >= sessionStart
  })
  let vitus = 0
  let rareDrops = 0
  for (const run of sessionArbRuns) {
    for (const d of run.drops) {
      if (/vitus/i.test(d.displayName) || /vitus/i.test(d.uniqueName)) {
        vitus += Math.max(0, d.delta)
      }
      if (d.rare) rareDrops += 1
    }
  }

  return {
    startedAt: haul.startedAt,
    haul,
    trades: {
      soldPlat: trades.sessionSoldPlat,
      boughtPlat: trades.sessionBoughtPlat,
      netPlat: trades.sessionNetPlat,
      count: trades.entries.filter((e) => {
        const t = new Date(e.at).getTime()
        return !Number.isNaN(t) && t >= sessionStart
      }).length,
    },
    rivens: {
      scans: sessionRivenScans,
      lastWeapon: rivens.entries[0]?.weapon ?? null,
    },
    arbitration: {
      runs: sessionArbRuns.length,
      vitus,
      rareDrops,
    },
  }
}
