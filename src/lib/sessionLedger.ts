import type { SessionLedgerSnapshot } from '../../shared/types'

function fmt(n: number) {
  return n.toLocaleString()
}

/** Plain-text summary for clipboard / session end. */
export function formatSessionLedgerSummary(ledger: SessionLedgerSnapshot): string {
  const started = ledger.startedAt
    ? new Date(ledger.startedAt).toLocaleString()
    : 'unknown'
  const lines = [
    `Everything Warframe — session since ${started}`,
    `Relics: ${ledger.haul.relicScans} scans · ${ledger.haul.neededParts} needed · ~${fmt(ledger.haul.platEstimate)}p seen`,
    `Trades: ${ledger.trades.count} · net ${ledger.trades.netPlat >= 0 ? '+' : ''}${fmt(ledger.trades.netPlat)}p (sold ${fmt(ledger.trades.soldPlat)} / bought ${fmt(ledger.trades.boughtPlat)})`,
    `Rivens: ${ledger.rivens.scans}${ledger.rivens.lastWeapon ? ` · last ${ledger.rivens.lastWeapon}` : ''}`,
    `Arbitration: ${ledger.arbitration.runs} runs · ${ledger.arbitration.vitus} Vitus · ${ledger.arbitration.rareDrops} rare`,
  ]
  const hits = ledger.haul.relicHits.slice(0, 8)
  if (hits.length) {
    lines.push(
      'Relic hits: ' +
        hits
          .map((h) => {
            const plat = h.platinum != null ? ` ${Math.round(h.platinum)}p` : ''
            const need = h.needed ? ' (needed)' : ''
            return `${h.name}${plat}${need}`
          })
          .join(' · '),
    )
  }
  return lines.join('\n')
}
