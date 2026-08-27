import { AppSettings, InventoryStatus } from '../../shared/types'
import './onboarding.css'

type Props = {
  settings: AppSettings
  inventory: InventoryStatus | null
  worldstateOk: boolean
  worldstateStale?: boolean
  onGoSettings?: () => void
  onGoModules?: () => void
  onToggleOverlay?: () => void
  onDetectEeLog?: () => void
  onRefreshWorldstate?: () => void
  /** Prefer sync when inventory is stale / empty and Warframe is running. */
  onSyncInventory?: () => void
  /** Live staged sync message (helper → launch → waiting → parsing). */
  inventoryProgress?: string | null
}

type Health = {
  id: string
  label: string
  detail: string
  state: 'ok' | 'warn' | 'off'
  onClick?: () => void
  title: string
}

export function StatusStrip({
  settings,
  inventory,
  worldstateOk,
  worldstateStale,
  onGoSettings,
  onToggleOverlay,
  onDetectEeLog,
  onRefreshWorldstate,
  onSyncInventory,
  inventoryProgress,
}: Props) {
  const eeOk = Boolean(settings.eeLogPath)
  const invOk = Boolean(inventory?.loaded)
  const invStale = Boolean(inventory?.stale || (inventory?.consent && !inventory?.loaded))
  const canSync =
    Boolean(onSyncInventory) &&
    Boolean(inventory?.consent) &&
    (invStale || !invOk) &&
    Boolean(inventory?.warframeRunning)
  const overlayOn = settings.overlayVisible

  const invDetail = inventoryProgress
    ? inventoryProgress.length > 28
      ? `${inventoryProgress.slice(0, 26)}…`
      : inventoryProgress
    : !inventory?.consent
      ? 'consent'
      : canSync
        ? 'sync now'
        : invOk
          ? inventory?.stale
            ? inventory.staleAgeMs != null
              ? `~${Math.max(1, Math.round(inventory.staleAgeMs / 60_000))}m`
              : 'stale'
            : inventory.helperVersion
              ? `ok · h${inventory.helperVersion}`
              : 'synced'
          : 'empty'

  const items: Health[] = [
    {
      id: 'overlay',
      label: 'Overlay',
      detail: overlayOn ? 'on' : 'off',
      state: overlayOn ? 'ok' : 'off',
      onClick: onToggleOverlay,
      title: 'Toggle overlay',
    },
    {
      id: 'worldstate',
      label: 'Worldstate',
      detail: worldstateStale ? 'stale' : worldstateOk ? 'live' : 'waiting',
      state: worldstateOk && !worldstateStale ? 'ok' : 'warn',
      onClick: onRefreshWorldstate,
      title: 'Refresh worldstate',
    },
    {
      id: 'ee',
      label: 'EE.log',
      detail: eeOk ? 'ready' : 'detect',
      state: eeOk ? 'ok' : 'warn',
      onClick: eeOk ? onGoSettings : onDetectEeLog,
      title: eeOk ? 'EE.log path in Settings' : 'Detect EE.log',
    },
    {
      id: 'inventory',
      label: 'Inventory',
      detail: invDetail,
      state: inventoryProgress
        ? 'warn'
        : !inventory?.consent
          ? 'off'
          : canSync || inventory?.stale
            ? 'warn'
            : invOk
              ? 'ok'
              : 'off',
      onClick: canSync ? onSyncInventory : onGoSettings,
      title: inventoryProgress
        ? inventoryProgress
        : canSync
          ? 'Sync inventory from Warframe'
          : inventory?.stale
            ? 'Inventory stale — open Settings or launch Warframe to sync'
            : 'Inventory settings',
    },
  ]

  if (!settings.onboarding.borderlessAck) {
    items.push({
      id: 'borderless',
      label: 'Display',
      detail: 'borderless?',
      state: 'warn',
      onClick: onGoSettings,
      title: 'Warframe must be Borderless Windowed',
    })
  }

  return (
    <div className="status-strip" data-tour="status-strip">
      {items.map((item) => (
        <button
          key={item.id}
          type="button"
          className={`status-chip is-${item.state}`}
          onClick={item.onClick}
          title={item.title}
        >
          <span className={`status-dot ${item.state === 'ok' ? '' : 'off'}`} data-state={item.state} />
          <span className="status-chip__text">
            <span className="status-chip__label">{item.label}</span>
            <span className="status-chip__detail">{item.detail}</span>
          </span>
        </button>
      ))}
    </div>
  )
}
