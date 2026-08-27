/** Shown once per version when lastSeenVersion differs. */
export const WHATS_NEW: Record<string, string[]> = {
  '0.6.0': [
    'First-run checklist, Help tour, and hotkey cheat sheet',
    'AlecaFrame-style relic popup as a horizontal under-card strip',
    'Layout presets scale to your primary monitor',
    'Nightwave challenges + fixed Arbitration empty state',
  ],
  '0.7.0': [
    'warframe.market platinum on relic rewards + best-pick highlight',
    'Play profiles, quiet mode, and What’s new after updates',
    'Invasions, Archon Hunt, and Deep Archimedea modules',
    'Baro wishlist, Steel Path fissure filter, Nightwave done marks',
    'Smarter relic auto-detect (Warframe focused) + dismiss hotkey',
  ],
  '0.8.0': [
    'Riven Grader popup: OCR current vs reroll, tier grades, keep/take tip',
    'Hotkeys Alt+Shift+G (scan) and Alt+Shift+H (dismiss)',
    'EE.log best-effort auto-detect for Kuva Cycle screens',
    'Layout preview + presets include the riven compare panel',
  ],
  '0.9.0': [
    'Foundry Planner tab: browse recipes with owned / ready / vaulted filters',
    'Recursive crafting trees with leaf material totals vs local inventory',
    'Eight color themes (4 dark, 4 light) for companion and overlay',
    'Visual polish: nav sections, status pills, and clearer empty states',
  ],
  '0.9.1': [
    'Riven Grader overlay defaults beside the Cycle compare cards (slim side panel)',
    'Per-overlay opacity sliders in Settings → Appearance',
    'Foundry defaults to My inventory (owned + ready) for much faster lists',
  ],
  '0.9.2': [
    'Custom theme palette: pick background, text, muted, and accent colors',
    'Start from any preset, then tune — applies to companion and overlay',
  ],
  '0.9.12': [
    'Fissure filters: Normal / Steel Path / Both path mode',
    'Toggle Railjack / Void Storm fissures on or off',
  ],
  '0.9.13': [
    'Riven grader: fix Critical Chance vs Slide Critical mix-ups',
    'Faction damage shows as x1.5 multiplier (not a wrong %)',
    'Wider riven OCR crops + pick which monitor OCR/overlay uses',
    'Relic OCR: read reward names under the cards (not the icon art)',
    'Help → Report a bug opens a prefilled GitHub Issue',
    'Fissure filters: can’t clear all tiers; empty tier lists reset to defaults',
  ],
  '0.9.15': [
    'Riven OCR: read faction multipliers (x1.64 Damage to Infested) more reliably',
    'Relic OCR: ignore garbage unmatched text; clearer multi-monitor Linux hint',
  ],
  '0.9.16': [
    'Riven grader: warframe.market platinum estimates for current vs reroll',
  ],
  '0.9.17': [
    'Riven grader polish: polarity, market links, plat-aware keep/take tips',
    'New Market tab: watchlist platinum quotes + latest scan prices',
    'Sound packs for relic/riven chimes + stronger EE.log auto-detect',
    'Linux screen-capture onboarding wizard for PipeWire OCR',
    'OBS widget server: localhost Browser Source panels for external overlays',
  ],
  '0.9.18': [
    'Relic OCR: WFInfo-style UI theme text isolation (much cleaner on Linux)',
    'Relic prices from local WFInfo DB first — no market round-trip on every scan',
    'Reward crop geometry aligned to WFInfo / wfinfo-ng layout math',
  ],
  '0.9.19': [
    'Relic OCR polish: UI theme override, 3-vs-4 squad detect, better Forma matching',
    'Needed-for-set + vaulted tags on relic reward cards',
    'Today dashboard: Nightwave, Archon, Baro, fissures, invasions at a glance',
    'Session profiles: Relic / Riven / Open world / Baro / Nightwave presets',
    'Scan chimes when relic or riven OCR finishes (on by default)',
  ],
  '0.9.20': [
    'Linux/AppImage: store settings + caches under ~/.local/share (not ~/.config) so API/catalog writes succeed',
    'Auto-migrate existing Linux data from ~/.config on first launch',
  ],
  '0.9.21': [
    'Linux inventory sync: sanitize AppImage/Wine env so Fontconfig no longer breaks the helper HTTPS download',
  ],
  '0.9.22': [
    'Foundry reloads automatically after inventory sync (and ignores stale Wine inventory.json)',
    'Recipe catalog retries after a failed first fetch so Foundry can populate post-sync',
  ],
  '0.9.23': [
    'Relic Planner: rank owned relics by missing parts and platinum',
    'Foundry: relic drop sources on missing parts',
    'Mastery Helper: next craftable / owned-unmastered gear',
    'Copy trade chat lines from relic and riven scans',
    'Baro wishlist affordability using synced ducats and credits',
  ],
  '0.9.24': [
    'Overlay option: only show while Warframe is focused (hides over other apps)',
    'Companion UI modernization: quieter chrome, Relic Planner hero, Today brief',
  ],
  '0.9.25': [
    'Help + tray: uninstall the app, open data folder, or delete local settings',
    'Windows Setup uninstaller can remove app data when you choose',
  ],
  '0.9.26': [
    'Linux: fix freeze when screen-share opened twice (PipeWire portal deadlock)',
    'Linux: only prompt for capture after Authorize / after setup is acknowledged',
  ],
  '0.9.27': [
    'Fix Linux quit crash: restore missing disposePersistentCapture import',
  ],
  '0.9.28': [
    'Hotkey Alt+Shift+W: hide / restore all worldstate overlay panels',
    'Optional per-panel toggle hotkeys under Settings → Hotkeys',
  ],
  '0.9.29': [
    'Foundry & Mastery: warframe/weapon/part thumbnails from warframestat art',
    'Foundry & Relic Planner: parts checklist with owned vs missing',
    'Show which owned relics drop missing set parts (plus other/vaulted sources)',
  ],
  '0.9.30': [
    'Inventory: count stacked prime parts correctly (Blueprint ↔ Component paths)',
    'Arbitration: show current node and upcoming hours in the rotation',
  ],
  '0.9.31': [
    'Foundry: dedicated All / Prime / Non-Prime filter under search',
  ],
  '0.9.32': [
    'Relic Planner: All / Prime / Non-Prime filter for relics and set search',
  ],
  '0.9.33': [
    'Linux: inventory no longer treats Everything Warframe AppImage as the game running',
    'Warframe Running / Not running status refreshes while Inventory settings are open',
  ],
  '0.9.34': [
    'Relics: fix inventory ownership — reward counts no longer use relic Projection IDs',
    'Item catalog: map short warframestat part names to full relic reward names',
  ],
  '0.9.35': [
    'Relic overlay: recover after item-catalog fetch failures (no more sticky red error)',
    'Fall back to on-disk item catalog when warframestat is briefly unreachable',
  ],
  '0.9.36': [
    'Settings: press-to-record hotkey inputs (no more typing accelerators by hand)',
    'Relics: fix false owned counts from crafted warframes / doubled relic stacks',
    'Relics: companion primes (Carrier, Shade, Helios, Kavasa, …) back in the catalog',
  ],
  '0.9.37': [
    'Foundry: uncrafted part blueprints no longer count as built components (Ready / craft trees)',
  ],
  '0.9.38': [
    'Layout: edit Relic and Riven OCR scan areas on the mock monitor (drag / resize)',
    'In-game layout unlock also shows OCR crop guides so you can align them over Warframe',
    'Custom OCR regions scale as screen fractions across resolutions',
  ],
  '0.9.39': [
    'Fix overlay vanishing while rearranging panels (Warframe-focus gate no longer hides during Ctrl+Tab edit)',
    'Layout unlock always starts locked on launch; OCR pause no longer leaves the overlay stuck hidden',
  ],
  '0.9.40': [
    'Performance: faster riven OCR (fewer passes unless a weak read), lighter Warframe-focus polling, snappier catalog matches',
    'Performance: countdown clock only re-renders timer panels; worldstate expiry checks on demand; less settings IPC chatter',
    'Companion: scroll inside module panels + polished theme scrollbars',
  ],
  '0.9.41': [
    'Riven OCR: fix glitchy reads from stats-band merge; deep-OCR only weak cards',
    'Relic OCR: much faster — parallel slots, primary band first, show results before live market lookup',
    'Foundry / Relic Planner: scroll list and detail panes instead of the whole page',
  ],
  '0.9.42': [
    'Market: link warframe.market with a browser JWT cookie (no password stored)',
    'Market: view and cancel your buy/sell orders from the companion',
    'Help: Chrome/Firefox steps for the JWT cookie, linked from the Market tab',
  ],
  '0.9.43': [
    'Market: fix JWT linking — use warframe.market API v2 (v1 profile was deprecated)',
    'Market: watchlist platinum quotes use the v2 orders endpoint',
    'Market: pull your riven / lich / sister contracts (auctions) when linked',
  ],
  '0.9.44': [
    'Inventory browser tab: search stacks with blueprint vs component labels and stale warnings',
    'Inventory auto-sync reacts faster when Warframe starts (still ~10 min between syncs)',
    'Market: create buy/sell orders and riven/lich/sister contracts from the companion',
    'Inventory browser: show WFCD / recipe catalog names instead of raw path leaves',
  ],
  '0.9.45': [
    'Companion sidebar can collapse to icons only (persists across restarts)',
    'App / tray / installer icon matches the companion brand mark',
    'OCR: warm Paddle at idle, in-memory detects (no temp files), priority boost while scanning',
    'OCR: fewer relic band / riven passes unless the first read is weak',
  ],
  '0.9.46': [
    'Scroll indicators are floating light-beams (no scrollbar rail/chrome)',
  ],
  '0.9.47': [
    'Foundry: owned part blueprints count toward Ready / missing (Component↔Blueprint match)',
    'Foundry: “Has blueprint” when you own the main recipe BP but not the finished item',
    'Inventory browser: hide raw /Lotus path under item names',
  ],
  '0.9.48': [
    'Relic Planner: sort by ducats, star farm favorites, Send filters to Relic Recommend overlay',
    'Relic Recommend overlay: top owned relics to run next (from planner filters)',
    'Relic reward OCR: Best pick modes — balanced / needed / platinum / ducats (Settings)',
    'Inventory Sellables: duplicate parts with prices + one-click warframe.market sell list',
  ],
  '0.9.49': [
    'Faster companion: idle-warmup catalogs; Inventory skips price lookups unless Sellables',
    'Inventory search debounced; lighter list rendering',
    'Relic Planner builds only matching relics; search debounced; result cache',
    'Layout tab: enabled modules by default, lighter preview stubs, deferred OCR guides',
    'Relic Planner + Layout stay mounted after first visit for snappier tab switches',
  ],
  '0.9.50': [
    'Sets hub: Prime set % complete, missing parts, farm favorites',
    'Inventory Ducat dump + WTS dump copy; diff since last sync',
    'Baro overlay: can-afford with inventory ducats/credits + wishlist hits',
    'Market undercut suggest (floor − 1); Relic Recommend ↔ open fissures by tier',
    'Relic Planner refinement counts (I/E/F/R); trade clipboard Best pick / recommend list',
    'Today: Sortie + Alerts from worldstate',
  ],
  '0.9.51': [
    'Relic OCR: Forma never Best-picked; clearer theme/slot diagnostics on failed scans',
    'Baro buy plan: wishlist ducat/credit totals, shortfall, dumpable extras to cover the gap',
    'Riven history: last recommended picks + platinum trend on the companion grader',
  ],
  '0.9.52': [
    'Market: live floor on watchlist; order health (undercut/stale) + one-click reprice',
    'Market Stock: inventory extras vs open listings, listing assistant (floor − 1), blacklist',
    'Market Buys: target max plat alerts when live floor drops',
    'Trade whisper copy from orders/stock; edit order via WFM PATCH',
  ],
  '0.9.53': [
    'Market: per-item min sell floors; Stock bulk list top 10; Orders soft reprice pass',
    'Market: Sold/Bought → local trade log with plat P&L; watchlist spread (median − floor)',
    'Buy-target desktop notifications (~5 min poll) when floor hits your max',
  ],
  '0.9.54': [
    'Riven grader: disposition, MR, avg roll %, keep/reroll/godroll verdicts',
    'Relic Planner: upgrade ROI sorts (plat/ducats per void trace to Radiant)',
    'Sets: live fissure path for missing parts; stale inventory banners on farm loops',
    'Dashboard economy snapshots (credits/ducats/plat); Market Deals flip scan + Riven stock',
    'Buy targets quantity; list assistant shows net after −1 undercut',
  ],
  '0.9.55': [
    'LFG tab: hosted squad board — post/join queues, whisper copy, local or remote hub',
    'Deployable lfg-api server for community matchmaking (npm run lfg:serve)',
  ],
  '0.9.56': [
    'LFG: SQLite persistence + Railway volume support so community boards survive redeploys',
    'LFG Hub URL defaults to the official hosted board (set to local for a private hub)',
  ],
  '0.9.57': [
    'LFG hub: Railway-friendly SQLite via built-in node:sqlite (no native build deps)',
  ],
  '0.9.58': [
    'LFG: fix HTTP 429 on hosted hub — per-client rate limits and gentler board polling',
  ],
  '0.9.59': [
    'LFG: auto-fall back to local hub when Railway edge blocks the public domain (429)',
  ],
  '0.9.60': [
    'LFG polish: searchable relic/mission pickers, presets, whisper preview, and smarter board UX',
    'LFG: My squads pin, slot dots, invite copy, hub status pill, and toast feedback',
  ],
  '0.9.61': [
    'LFG: warm hub/relic options on startup; keep tab mounted; lighter relic typeahead',
  ],
  '0.9.62': [
    'Linux inventory sync: use Warframe’s Proton (config_info / version / CompatToolMapping) instead of Hotfix-first wine',
    'Run warframe-api-helper via `proton run` with matching STEAM_COMPAT_* env; fail fast with clearer gruzzle errors',
  ],
  '0.9.63': [
    'UX pass: Ctrl+K jump palette, session profile cards, inventory sync from status chip, global toasts',
    'Overlay mission strip; relic OCR recovery (retry / slots / monitor); Best-pick Copy WTS + Market',
    'Market session guide; Baro arrival notify; Linux health card; settings export/import; Today “What next”',
    'Jump palette solid contrast; Relic Planner list scrolls while search/filters stay pinned',
  ],
  '0.9.64': [
    'Linux inventory sync: block overlapping helper runs, kill stale Wine processes, pulse Enter so Proton does not hang for 90s',
    'Prefer matching Proton wine64 (keeps cwd) over proton run; pick up inventory.json from alternate Wine write paths',
  ],
  '0.9.65': [
    'LFG: sticky Your squad bar, filter chip + Show all, open-seats filter, card hierarchy, expiry urgency, skeletons',
    'LFG: host +10m extend, join desktop notify, owned-relic badge, copy squad IGNs, Relic Recommend form prefill',
    'Overlay mission strip shows open LFG seat count for your region/platform',
    'Sets: scrollable list with pinned filters; Incomplete / Complete / All completion filter',
  ],
  '0.9.66': [
    'Linux health: detect YAMA ptrace_scope, copy fix command for gruzzle failures, clearer inventory sync tips',
    'Gruzzle / open-process errors on Linux point at Memory access instead of running the AppImage as root',
  ],
  '0.9.67': [
    'Market: fix cancelling warframe.market contracts (use auction /close API; clearer cancel toasts)',
  ],
  '0.9.68': [
    'Linux AppImage: bake PipeWire persistent capture flags (auto-select screen + fake UI); no-sandbox by default for AppImages',
    'Linux inventory sync: detach Wine/Proton from the AppImage, scrub Electron env, safer helper cleanup so sync cannot take down the app',
  ],
  '0.9.69': [
    'Relic overlay strip: Retry / Force 3–4 slots / Reset monitor when OCR is weak or fails',
    'Today: live checklist from near-done sets, Baro wishlist, and LFG seats for owned relics',
    'Overlay mission strip: I’m hosting chip with seats, Whisper, +10m extend, and Close',
    'Inventory sync: staged progress (helper → launch → waiting → parsing) in Settings, toasts, and overlay',
  ],
  '0.9.70': [
    'OCR speed: raw RGBA prep (no PNG round-trip), dual PaddleOCR instances for concurrent slots',
    'OCR speed: persistent screen stream on Windows too; warmup starts ~0.5s after launch',
    'OCR speed: readiness polling for relic/riven log triggers instead of fixed animation delays',
  ],
  '0.9.71': [
    'Fix relic OCR re-scanning after the pick screen closes (EE.log close/select was treated as a new open) (#8)',
    'Faster EE.log poll on Windows; ignore reward-end while a scan is still running',
    'Reset stale OCR monitor IDs when Windows remaps displays after GPU/driver changes',
    'Companion window: scroll the whole tab page when the window is short (not only inside panels)',
    'Companion layout: flex + absolute fill so Dashboard/Settings scroll reliably in windowed mode',
    'Fix Help/Settings panel crush: parked Relic Planner no longer locks companion-main to overflow:hidden',
  ],
  '0.9.72': [
    'Riven hotkey: show grader overlay immediately (“Reading…”) and force-show on manual scan',
    'Riven scan perf: shorter settle/retry, warm capture stream in parallel, skip off-screen park hitch',
    'Cap desktopCapturer thumbs at 1440p; warm relic + riven OCR together at startup',
  ],
  '0.9.73': [
    'OCR status chip on overlay (idle / reading / done) + dim worldstate panels while scanning',
    'Tonight’s haul on Dashboard: relic hits, needed parts, plat seen, inventory gains',
    'Relic rewards deep-link to Sets / Foundry / Market / LFG',
    'Inventory sync toast shows item deltas (+2 Forma…)',
    'Remember last confident OCR theme + slot count for faster Auto scans',
    'Hotkey conflict warning in Settings; display remount wizard when monitor IDs change',
  ],
  '0.9.74': [
    'Quiet focus: Alt+Shift+Q / mission-strip toggle — fissures + OCR only (restores modules)',
    'First-run health gate: Borderless, OCR monitor, EE.log, inventory consent',
    'List Best pick on warframe.market from relic strip (floor − 1)',
    'Stale inventory banners on Foundry, Sets, Market, and Relic Recommend',
    'OCR chip actions: Retry / Dismiss / open Settings',
  ],
  '0.9.75': [
    'Loadout coaching tab: owned gear rank + Forma tips for Steel Path (not live equipped)',
    'Weekly reset Dashboard card: Sortie, Archon, Nightwave weeklies, Circuit, Baro',
    'Arbitration haul log: rare inventory gains after extract/sync this session',
    'Worldstate: Steel Path / Circuit rotation from warframestat when available',
  ],
  '0.9.76': [
    'Circuit / Incarnon tracker: this week’s rotation vs owned inventory',
    'Baro buy advisor: wishlist ranked by affordability + dump gap',
    'Session goals: live counters for relic scans, needed parts, plat, inventory gains',
  ],
  '0.9.77': [
    'Game performance mode (on by default): less overlay lag vs Warframe',
    'Defer OCR/capture warmup; release screen capture ~45s after scans',
    'Tight overlay bounds + 3s countdown clock; single OCR worker by default',
    'Fix inventory sync crash (write after end on helper stdin)',
  ],
  '0.9.78': [
    'RELEASE.md checklist + 1.0 freeze path; Vite cache moved off OneDrive (fixes EPERM)',
    'Inventory: helper version + clearer gruzzle → import fallback; age on status strip',
    'Reward-screen HUD only (optional): hide worldstate until relic/riven OCR',
    'Market trade log: session P/L + pointer to safe Reprice pass',
    'Linux parity matrix: Steam / Wine / Proton / ptrace / capture / inventory',
    'Opt-in crash log → offer GitHub bug report on next launch',
  ],
  '0.9.79': [
    'Near-instant OCR: EE.log fs.watch, dual Paddle workers by default, faster readiness/retries',
    'Relic OCR robustness: alt UI-theme retry, squad/monitor remount, Proton capture tips',
    'Defaults: reward-screen HUD + dual OCR on (with game performance mode)',
    'Cloud settings sync: Dropbox/OneDrive/Google Drive folder (auto pull on launch)',
    'OneDrive-safe day-to-day dev: npm run dev:local → %LOCALAPPDATA%\\EverythingWarframe-dev',
  ],
  '0.9.80': [
    'Fix relic OCR missing reward names on 1440p (and similar) end-of-mission screens (#9)',
    'Recalibrated name-band crop Y so OCR hits item labels, not empty space under the strip',
    'OCR captures use PNG again for sharper relic/riven crops',
  ],
  '0.9.81': [
    'Fix relic OCR still failing when a tall custom Layout OCR strip overrides name crops (#9)',
    'Ignore card-tall Relic OCR boxes (use built-in geometry); weak scans also fall back',
    'Layout tip: keep Relic OCR box thin over item names — Reset OCR areas clears a bad strip',
  ],
}

export function getWhatsNewBullets(version: string): string[] {
  return WHATS_NEW[version] || [
    `Updated to ${version}`,
    'Bug fixes and quality-of-life improvements',
  ]
}
