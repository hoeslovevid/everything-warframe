import { AppSettings } from '../../shared/types'
import { Panel } from './Panel'
import './onboarding.css'

type Props = {
  settings: AppSettings
  onUpdate: (partial: Partial<AppSettings>) => void
  onGoLayout: () => void
  onEnableRelics: () => void
  onScanRelic?: () => void
}

/**
 * Short OCR calibration wizard: enable Relics → Layout OCR boxes → optional test scan → done.
 */
export function OcrCalibWizard({
  settings,
  onUpdate,
  onGoLayout,
  onEnableRelics,
  onScanRelic,
}: Props) {
  const ob = settings.onboarding
  if (ob.ocrCalibWizardAck || ob.checklistDismissed) return null

  const relicsOn = settings.modules.relics !== false

  return (
    <Panel
      title="OCR calibration"
      subtitle="3 steps so relic / riven crops hit the right text"
      actions={
        <button
          className="btn ghost"
          type="button"
          onClick={() => onUpdate({ onboarding: { ...ob, ocrCalibWizardAck: true } })}
        >
          Skip
        </button>
      }
    >
      <ol className="ocr-calib-steps" style={{ margin: 0, paddingLeft: 18 }}>
        <li style={{ marginBottom: 10 }}>
          <strong>Enable Relic Rewards</strong>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Module must be on for auto-detect and the hotkey.
          </div>
          <button
            className="btn primary"
            type="button"
            style={{ marginTop: 6 }}
            disabled={relicsOn}
            onClick={onEnableRelics}
          >
            {relicsOn ? 'Relics enabled' : 'Enable Relics'}
          </button>
        </li>
        <li style={{ marginBottom: 10 }}>
          <strong>Align OCR boxes on Layout</strong>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Drag the dashed Relic name strip (thin) and Riven card boxes over the UI text.
          </div>
          <button className="btn" type="button" style={{ marginTop: 6 }} onClick={onGoLayout}>
            Open Layout
          </button>
        </li>
        <li>
          <strong>Test on a reward screen</strong>
          <div className="muted" style={{ fontSize: '0.85rem' }}>
            Open a fissure reward pick (Item Labels on), press the Relic scan hotkey, then confirm.
          </div>
          <div className="toolbar" style={{ marginTop: 6 }}>
            {onScanRelic ? (
              <button className="btn" type="button" onClick={onScanRelic}>
                Scan now
              </button>
            ) : null}
            <button
              className="btn primary"
              type="button"
              onClick={() =>
                onUpdate({
                  onboarding: {
                    ...ob,
                    ocrCalibWizardAck: true,
                    firstRunRelicTestAck: true,
                  },
                })
              }
            >
              Looks good / done
            </button>
          </div>
        </li>
      </ol>
    </Panel>
  )
}
