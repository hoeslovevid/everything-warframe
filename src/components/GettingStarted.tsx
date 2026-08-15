import { AppSettings, InventoryStatus } from '../../shared/types'
import { prettyHotkey } from '../lib/hotkey'
import './onboarding.css'

type Props = {
  settings: AppSettings
  inventory?: InventoryStatus | null
  onUpdate: (partial: Partial<AppSettings>) => void
  onGoModules: () => void
  onGoLayout: () => void
  onGoInventory: () => void
  onGoSettings: () => void
  onStartTour: () => void
  onDetectEeLog?: () => void
  onSyncInventory?: () => void
}

/**
 * First-run health gate: Borderless, OCR monitor, EE.log, inventory consent.
 * Replaces the older “getting started” checklist with readiness checks.
 */
export function GettingStarted({
  settings,
  inventory,
  onUpdate,
  onGoModules,
  onGoLayout,
  onGoInventory,
  onGoSettings,
  onStartTour,
  onDetectEeLog,
  onSyncInventory,
}: Props) {
  const ob = settings.onboarding
  if (ob.checklistDismissed) return null

  const eeLogReady = Boolean(settings.eeLogPath?.trim()) || ob.eeLogAck
  const ocrReady = ob.ocrMonitorAck
  const inventoryReady =
    Boolean(settings.inventoryConsent) ||
    Boolean(inventory?.consent) ||
    ob.inventoryTouched

  const steps = [
    {
      key: 'borderlessAck' as const,
      label: 'Warframe is Borderless Windowed',
      detail: 'Exclusive fullscreen breaks OCR and overlay click-through.',
      done: ob.borderlessAck,
      actionLabel: 'I use Borderless',
      onAction: () => onUpdate({ onboarding: { ...ob, borderlessAck: true } }),
    },
    {
      key: 'ocrMonitorAck' as const,
      label: 'OCR / Game monitor confirmed',
      detail: 'Settings → Appearance → Game / OCR monitor must match Warframe’s screen.',
      done: ocrReady,
      actionLabel: 'Open Settings',
      onAction: () => {
        onGoSettings()
        onUpdate({ onboarding: { ...ob, ocrMonitorAck: true } })
      },
    },
    {
      key: 'eeLogAck' as const,
      label: 'EE.log path set',
      detail: 'Needed for auto relic / riven / arbitration detect.',
      done: eeLogReady,
      actionLabel: settings.eeLogPath ? 'Confirm' : 'Detect',
      onAction: () => {
        if (settings.eeLogPath) {
          onUpdate({ onboarding: { ...ob, eeLogAck: true } })
        } else {
          onDetectEeLog?.()
          onUpdate({ onboarding: { ...ob, eeLogAck: true } })
        }
      },
    },
    {
      key: 'inventoryConsent' as const,
      label: 'Inventory consent (optional)',
      detail: 'Enables needed-for-set tags and Foundry / Sets progress.',
      done: inventoryReady,
      actionLabel: inventory?.warframeRunning ? 'Sync now' : 'Open Inventory',
      onAction: () => {
        if (onSyncInventory && inventory?.warframeRunning) onSyncInventory()
        else onGoInventory()
        onUpdate({ onboarding: { ...ob, inventoryTouched: true } })
      },
    },
    {
      key: 'modulesTouched' as const,
      label: 'Pick which modules to show',
      detail: 'Toggle overlay panels for your play style.',
      done: ob.modulesTouched,
      actionLabel: 'Open Modules',
      onAction: onGoModules,
    },
    {
      key: 'layoutVisited' as const,
      label: 'Arrange overlay layout',
      detail: `Unlock drag with ${prettyHotkey(settings.hotkeys.editLayout)}.`,
      done: ob.layoutVisited,
      actionLabel: 'Open Layout',
      onAction: onGoLayout,
    },
    ...(typeof navigator !== 'undefined' && /linux/i.test(navigator.userAgent)
      ? [
          {
            key: 'linuxCaptureAck' as const,
            label: 'Authorize Linux screen capture',
            detail: 'PipeWire share once so relic/riven OCR can see the game.',
            done: ob.linuxCaptureAck,
            actionLabel: 'Open wizard',
            onAction: () => {
              document
                .querySelector('[data-tour="linux-capture"]')
                ?.scrollIntoView({ behavior: 'smooth', block: 'center' })
            },
          },
        ]
      : []),
  ]

  const required = steps.filter((s) => s.key !== 'inventoryConsent' && s.key !== 'modulesTouched' && s.key !== 'layoutVisited')
  const requiredDone = required.every((s) => s.done)
  const doneCount = steps.filter((s) => s.done).length
  const allDone = doneCount === steps.length

  return (
    <section className="getting-started" data-tour="getting-started">
      <div className="getting-started__header">
        <div>
          <h3 className="getting-started__title">
            {requiredDone ? 'You’re ready' : 'First-run health gate'}
          </h3>
          <p className="getting-started__sub">
            {allDone
              ? 'Core setup looks good. Dismiss anytime — or replay the tour.'
              : requiredDone
                ? `${doneCount}/${steps.length} · optional polish left`
                : `${doneCount}/${steps.length} · confirm Borderless, OCR monitor, and EE.log before farming`}
          </p>
        </div>
        <button
          className="btn ghost"
          onClick={() => onUpdate({ onboarding: { ...ob, checklistDismissed: true } })}
        >
          Dismiss
        </button>
      </div>

      <ul className="getting-started__list">
        {steps.map((step) => (
          <li key={step.key} className={`getting-started__item ${step.done ? 'is-done' : ''}`}>
            <span className="getting-started__check" aria-hidden>
              ✓
            </span>
            <div>
              <p className="getting-started__label">{step.label}</p>
              {step.detail ? (
                <p className="getting-started__sub" style={{ margin: '2px 0 0' }}>
                  {step.detail}
                </p>
              ) : null}
            </div>
            {step.done ? (
              <span className="muted">Done</span>
            ) : (
              <button className="btn ghost" onClick={step.onAction}>
                {step.actionLabel}
              </button>
            )}
          </li>
        ))}
      </ul>

      <div className="getting-started__actions">
        <button className="btn primary" onClick={onStartTour} data-tour="start-tour">
          {ob.tourCompleted ? 'Replay quick tour' : 'Start quick tour'}
        </button>
        {requiredDone ? (
          <button
            className="btn"
            onClick={() => onUpdate({ onboarding: { ...ob, checklistDismissed: true } })}
          >
            Finish checklist
          </button>
        ) : null}
      </div>
    </section>
  )
}
