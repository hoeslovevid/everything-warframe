import type { InventoryStatus } from '../../shared/types'

/** ~45 min — inventory drifts fast in infinite fissures. */
const FISSURE_STALE_MS = 45 * 60_000

type Props = {
  inventory: InventoryStatus
  onOpenInventory?: () => void
  onSyncInventory?: () => void
  /** Tighter threshold for fissure / farm loops. */
  fissureMode?: boolean
}

export function InventoryStaleBanner({
  inventory,
  onOpenInventory,
  onSyncInventory,
  fissureMode,
}: Props) {
  if (!inventory.loaded || !inventory.consent) return null
  const age = inventory.staleAgeMs
  const stale =
    inventory.stale ||
    (fissureMode && age != null && age >= FISSURE_STALE_MS)
  if (!stale) return null

  const mins = age != null ? Math.max(1, Math.round(age / 60_000)) : null
  const canSync = Boolean(onSyncInventory && inventory.warframeRunning)
  return (
    <p className="market-buy-hit" role="status" style={{ marginBottom: 12 }}>
      Inventory looks stale{mins != null ? ` (~${mins}m old)` : ''}
      {inventory.helperVersion ? ` · helper v${inventory.helperVersion}` : ''}. Sync after
      extraction so ownership / recommend stay accurate — or import AlecaFrame /
      inventory.json if live sync fails (gruzzle).
      {canSync ? (
        <>
          {' '}
          <button type="button" className="linkish" onClick={onSyncInventory}>
            Sync now
          </button>
        </>
      ) : onOpenInventory ? (
        <>
          {' '}
          <button type="button" className="linkish" onClick={onOpenInventory}>
            Inventory settings
          </button>
        </>
      ) : null}
    </p>
  )
}
