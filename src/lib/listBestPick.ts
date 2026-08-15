import { suggestSellPrice } from '../modules/market/marketHelpers'
import { pushToast } from './toast'

/** Draft a warframe.market sell order for a Best pick (floor − 1). */
export async function listBestPickOnMarket(itemName: string): Promise<boolean> {
  const name = itemName.trim()
  if (!name || !window.voidlens) return false

  const session = await window.voidlens.getWfmSession?.()
  if (!session?.linked) {
    pushToast('Link warframe.market in Market → Account first', 'warn', 6000)
    void window.voidlens.navigateCompanion?.('market')
    return false
  }

  pushToast(`Listing ${name}…`, 'info', 2500)
  try {
    const tip = await window.voidlens.suggestMarketUndercut?.(name)
    if (!tip?.floor || tip.floor < 1) {
      pushToast(`No market floor for ${name}`, 'warn', 5000)
      return false
    }
    const platinum = tip.suggest || suggestSellPrice(tip.floor, null)
    const res = await window.voidlens.createWfmOrder({
      itemSlugOrName: name,
      orderType: 'sell',
      platinum,
      quantity: 1,
      visible: true,
    })
    if (!res.ok) {
      pushToast(res.error || 'List failed', 'error', 7000)
      return false
    }
    pushToast(`Listed ${name} @ ${platinum}p`, 'ok', 6000)
    return true
  } catch (err) {
    pushToast(err instanceof Error ? err.message : 'List failed', 'error', 7000)
    return false
  }
}
