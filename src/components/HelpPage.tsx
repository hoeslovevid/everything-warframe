import { useEffect } from 'react'
import { AppSettings } from '../../shared/types'
import { BugReportPanel } from './BugReportPanel'
import { Panel } from './Panel'
import { UninstallPanel } from './UninstallPanel'
import { prettyHotkey } from '../lib/hotkey'
import { resolveUiLocale, t } from '../lib/i18n'
import './onboarding.css'

type Props = {
  settings: AppSettings
  onStartTour: () => void
  onShowHotkeys: () => void
  onResetChecklist: () => void
  onGoMarket?: () => void
  /** Scroll to a help block id when opening from another tab (e.g. `help-wfm-jwt`). */
  scrollToId?: string | null
  onScrollToConsumed?: () => void
}

export function HelpPage({
  settings,
  onStartTour,
  onShowHotkeys,
  onResetChecklist,
  onGoMarket,
  scrollToId,
  onScrollToConsumed,
}: Props) {
  const hk = settings.hotkeys
  const locale = resolveUiLocale(settings.uiLocale || 'system')

  useEffect(() => {
    if (!scrollToId) return
    const el = document.getElementById(scrollToId)
    el?.scrollIntoView({ behavior: 'smooth', block: 'start' })
    onScrollToConsumed?.()
  }, [scrollToId, onScrollToConsumed])

  return (
    <>
      <header className="page-header">
        <h2 className="page-title">{t(locale, 'page.help')}</h2>
        <div className="page-title-rule" />
        <p className="page-desc">{t(locale, 'page.helpDesc')}</p>
      </header>

      <div className="toolbar">
        <button className="btn primary" onClick={onStartTour}>
          Replay quick tour
        </button>
        <button className="btn" onClick={onShowHotkeys}>
          Hotkey cheat sheet
        </button>
        <button className="btn ghost" onClick={onResetChecklist}>
          Show getting started again
        </button>
      </div>

      <Panel title="How to use">
        <div className="help-block">
          <h3>1. Borderless Windowed</h3>
          <p>
            Set Warframe to Borderless Windowed. Exclusive fullscreen hides the overlay behind the
            game.
          </p>
        </div>
        <div className="help-block">
          <h3>2. Pick modules</h3>
          <p>
            Under Modules, enable Cycles, Fissures, Baro, Relics, and anything else you want on
            screen.
          </p>
        </div>
        <div className="help-block">
          <h3>3. Place panels</h3>
          <p>
            Use the Layout tab to drag panels on a mock monitor, or unlock in-game with{' '}
            <strong>{prettyHotkey(hk.editLayout)}</strong>, drag, then press it again to lock.
            On Layout (or while unlocked in-game), drag the dashed OCR boxes so they cover Relic
            reward names and Riven Cycle cards — scans only read those crops.
          </p>
        </div>
        <div className="help-block">
          <h3>4. Relic rewards</h3>
          <p>
            With the Relics module on, a horizontal strip pops up under the four reward cards when
            a fissure pick screen is detected (EE.log), or when you press{' '}
            <strong>{prettyHotkey(hk.scanRelics)}</strong>. Place that strip in the Layout tab. It
            auto-hides after you leave the pick screen or after ~45s. Sync inventory for “needed
            for set” tags. If names miss, nudge the gold Relic OCR box on Layout.
          </p>
        </div>
        <div className="help-block">
          <h3>5. Riven grader</h3>
          <p>
            On the Kuva Cycle compare screen (current vs new), press{' '}
            <strong>{prettyHotkey(hk.scanRivens)}</strong>. A slim grader panel appears beside the
            in-game cards with tiers and a keep/take tip. EE.log may auto-detect; the hotkey is the
            reliable path. Dismiss with <strong>{prettyHotkey(hk.dismissRivens)}</strong>. Resize
            the teal/blue Riven OCR boxes on Layout if stats are cut off. Reset Layout if your panel
            still sits over the cards from an older default.
          </p>
        </div>
        <div className="help-block">
          <h3>6. Foundry planner</h3>
          <p>
            Open the <strong>Foundry</strong> tab in the companion (not an overlay). Sync inventory,
            then browse <strong>My inventory</strong> (owned gear + ready-to-build) by default. Use
            Browse all only for the full catalog. Expand a recipe for crafting trees and missing
            materials.
          </p>
        </div>
        <div className="help-block" id="help-wfm-jwt">
          <h3>7. Link warframe.market (JWT)</h3>
          <p>
            The Market tab can show and cancel your buy/sell orders. You paste a browser session
            cookie — your password never enters Everything Warframe.
          </p>
          <p>
            <strong>Chrome / Edge</strong>
          </p>
          <ol>
            <li>
              Open{' '}
              <a href="https://warframe.market/" target="_blank" rel="noreferrer">
                warframe.market
              </a>{' '}
              and sign in
            </li>
            <li>Press F12 (or right-click → Inspect) for DevTools</li>
            <li>
              Go to <strong>Application</strong> → <strong>Cookies</strong> →{' '}
              <code>https://warframe.market</code>
            </li>
            <li>
              Select the cookie named <strong>JWT</strong>
            </li>
            <li>Copy the Value field (long string starting with eyJ…)</li>
            <li>
              Paste it under Market → warframe.market account → Link account
            </li>
          </ol>
          <p>
            <strong>Firefox</strong>
          </p>
          <ol>
            <li>Same site, signed in</li>
            <li>
              F12 → <strong>Storage</strong> → <strong>Cookies</strong> → warframe.market
            </li>
            <li>
              Copy the <strong>JWT</strong> cookie value, then paste on the Market tab
            </li>
          </ol>
          <p>
            Tokens expire or reset when you sign out of the site — grab a fresh JWT if linking
            fails. You can cancel listings here; completing a trade still happens in Warframe.
          </p>
          {onGoMarket ? (
            <p>
              <button type="button" className="btn primary" onClick={onGoMarket}>
                Open Market tab
              </button>
            </p>
          ) : null}
        </div>
      </Panel>

      <div className="section-gap" />

      <Panel title="Crash reports" subtitle="Opt-in · local only until you submit">
        <div className="help-block" id="help-crash-reports">
          <h3>How it works</h3>
          <ol style={{ margin: '0 0 8px', paddingLeft: 18 }}>
            <li>
              Enable <strong>Settings → Opt-in crash log</strong> (off by default).
            </li>
            <li>
              If the main process crashes, a note is written under the app data folder (
              <code>crash.log</code> / <code>crash-pending.json</code>).
            </li>
            <li>
              On the next companion launch, a banner offers <strong>Open GitHub issue</strong> with a
              prefilled title and log tail. Nothing is uploaded until you click submit on GitHub.
            </li>
            <li>You can dismiss the banner or use the Bug report form below anytime.</li>
          </ol>
          <p className="muted" style={{ marginBottom: 0 }}>
            Renderer-only freezes are not captured yet. Prefer reproducing once, then opening the
            issue with diagnostics attached.
          </p>
        </div>
      </Panel>

      <div className="section-gap" />

      <BugReportPanel />

      <div className="section-gap" />

      <UninstallPanel />

      <div className="section-gap" />

      <Panel title="Common questions">
        <div className="help-block">
          <h3>Where did the companion go?</h3>
          <p>
            Closing the window leaves the app in the system tray. Press{' '}
            <strong>{prettyHotkey(hk.openCompanion)}</strong> or click the tray icon.
          </p>
        </div>
        <div className="help-block">
          <h3>I see an FPS / Frame Time widget</h3>
          <p>
            That’s usually Xbox Game Bar, NVIDIA overlay, or RTSS — not Everything Warframe. Turn it
            off in that app’s settings.
          </p>
        </div>
        <div className="help-block">
          <h3>How do I uninstall?</h3>
          <p>
            Use the Uninstall section above, or Windows Settings → Apps → Everything Warframe. The
            Setup installer also adds a Start Menu uninstall entry. Portable builds: delete the
            .exe; Linux AppImage: delete the file; .deb: remove via your package manager.
          </p>
        </div>
        <div className="help-block">
          <h3>How do I hide panels mid-mission?</h3>
          <p>
            Press <strong>{prettyHotkey(hk.toggleWorldstatePanels)}</strong> to clear/restore all
            worldstate panels (Cycles, Fissures, Baro, …) without turning off relic/riven popups.
            Assign optional per-panel hotkeys under Settings → Hotkeys. Global overlay on/off remains{' '}
            <strong>{prettyHotkey(hk.toggleOverlay)}</strong>.
          </p>
        </div>
        <div className="help-block">
          <h3>How do I link warframe.market?</h3>
          <p>
            See <strong>7. Link warframe.market (JWT)</strong> above for Chrome/Edge and Firefox
            steps, then paste the cookie on the{' '}
            {onGoMarket ? (
              <button type="button" className="linkish" onClick={onGoMarket}>
                Market
              </button>
            ) : (
              'Market'
            )}{' '}
            tab. Never paste your password.
          </p>
        </div>
        <div className="help-block">
          <h3>Downloads &amp; updates</h3>
          <ul>
            <li>
              Website:{' '}
              <a
                href="https://hoeslovevid.github.io/Warframe-Companion-Helper/"
                target="_blank"
                rel="noreferrer"
              >
                hoeslovevid.github.io/Warframe-Companion-Helper
              </a>
            </li>
            <li>In-app updates: Settings → Updates</li>
          </ul>
        </div>
      </Panel>
    </>
  )
}
