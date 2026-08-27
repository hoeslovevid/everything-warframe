# Everything Warframe

Companion + transparent overlay for Warframe on **Windows** and **Linux (Steam/Proton)**: worldstate panels, Baro inventory, account inventory sync, and relic/riven OCR.

**Website:** [hoeslovevid.github.io/Warframe-Companion-Helper](https://hoeslovevid.github.io/Warframe-Companion-Helper/)  
**Downloads:** [GitHub Releases](https://github.com/hoeslovevid/everything-warframe/releases)

## Requirements

- **Windows** 10/11 (x64), or **Linux** x64 with Warframe via **Steam + Proton**
- Warframe in **Borderless Windowed** (exclusive fullscreen hides the overlay)
- Linux: X11 is the most reliable for overlays; Wayland may need XWayland / portal screen capture
- For development: Node.js 20+ recommended (18 may work for `npm start`)

## Download (users)

1. Open [Releases](https://github.com/hoeslovevid/everything-warframe/releases)
2. **Windows:** Setup `.exe` or portable · **Linux:** `.AppImage` or `.deb`
3. Install / run **Everything Warframe**
4. Keep Warframe in Borderless Windowed (Proton: same setting in-game)

### Auto-updates

Installed builds check [GitHub Releases](https://github.com/hoeslovevid/everything-warframe/releases) for newer versions.

- Automatic check shortly after launch (and every few hours)
- **Settings → Updates** → Check for updates / Restart & install
- Dev mode (`npm start`) does **not** auto-update
- Maintainers: see **[RELEASE.md](./RELEASE.md)** — tagging `vX.Y.Z` runs CI that publishes Win + Linux installers

## Development

```bash
npm install
npm start
```

**Windows / OneDrive:** Prefer day-to-day dev outside OneDrive sync:

```powershell
npm run dev:local
```

That copies the repo to `%LOCALAPPDATA%\EverythingWarframe-dev` and runs `npm start` there (avoids sync locks on `node_modules` / Vite). Vite’s cache already lives in the OS temp folder (`vite-everything-warframe`). If `npm start` still fails on a stale `.vite` folder inside the repo, delete `node_modules/.vite` once and retry.

This launches Vite, builds the Electron main/preload bundles, then opens:

- **Companion** — dashboard, module toggles, **Layout** mock preview, settings
- **Overlay** — always-on-top click-through panels

Use the companion **Layout** tab to drag every overlay panel (including Relic Rewards with sample cards) on a mock monitor. Positions save to the live overlay. The same preview shows **OCR scan areas** (Relic name band + Riven Cycle cards) — drag or resize those boxes so OCR reads the right part of the screen.

In-game (WFHelper-style): press `Ctrl+Tab` to unlock click-through, left- or right-drag panels, then `Ctrl+Tab` again to lock. A teaching chip appears until you move a panel once.

### Build a local installer

```bash
npm run dist        # Windows
npm run dist:linux  # Linux AppImage + deb
```

Outputs land in `release/`.

## Default hotkeys

| Action | Shortcut |
| --- | --- |
| Toggle overlay | `Alt+Shift+V` |
| Open companion | `Alt+Shift+C` |
| Refresh worldstate | `Alt+Shift+R` |
| Scan relic rewards | `Alt+Shift+F` |
| Dismiss relic popup | `Alt+Shift+D` |
| Scan riven compare | `Alt+Shift+G` |
| Dismiss riven popup | `Alt+Shift+H` |
| Unlock overlay drag (interaction) | `Ctrl+Tab` |

If a shortcut is taken, the app tries fallbacks. Change them under **Settings → Hotkeys**.

## Performance tips

Everything Warframe runs at below-normal process priority, pauses overlay clocks when the overlay is hidden, and loads OCR only on the first relic scan. For the lightest footprint while playing:

- Minimize or close the **Companion** window (hotkeys still work)
- Disable modules you do not need
- Toggle the overlay off (`Alt+Shift+V`) when you want zero on-screen cost

## Modules

- **World Cycles** — Cetus, Vallis, Cambion, Duviri, Zariman, Albrecht (when available)
- **Fissures** — filterable by tier
- **Baro Ki'Teer** — status, shop inventory, wishlist affordability from synced ducats/credits
- **Nightwave** — season / phase
- **Relics** — OCR reward overlay with plat/ducats, set progress, and copy-trade lines
- **Riven Grader** — OCR current vs reroll with grades, market plat, and copy-trade lines
- **Foundry Planner** — inventory-first list (owned + ready), crafting trees, material totals, relic drop sources
- **Relic Planner** — rank owned relics by missing parts and platinum
- **Mastery Helper** — next craftable / owned-unmastered gear for MR
- **Market** — warframe.market watchlist + scan prices
- **Themes** — 4 dark + 4 light presets, plus a Custom palette with color pickers
- **Per-overlay opacity** — individual opacity sliders under Settings → Appearance
- **Arbitration** — schedule now; run analytics later

## Inventory

In **Settings → Inventory**:

1. **Sync from running game** (permission required) via [warframe-api-helper](https://github.com/Sainan/warframe-api-helper)
2. **Find existing exports** — `inventory.json` / AlecaFrame `lastData.dat`
3. **Browse file…**

Data stays on your PC.

## Relic reward overlay

1. Sync inventory (recommended)
2. Enable **Relic Rewards**
3. Enable Item Labels in Warframe
4. On the reward pick screen, press **Alt+Shift+F** (or wait for EE.log `Got rewards`)

## Riven grader overlay

1. Enable **Riven Grader**
2. On the Kuva Cycle compare screen (current vs new), press **Alt+Shift+G**
3. The overlay grades both rolls and recommends keep / take / similar
4. EE.log may auto-detect; the hotkey is the reliable path. Dismiss with **Alt+Shift+H**

Scoring uses community preferences from the Megrim & Valkyrial sheet (based on 44Bananas) when the weapon name matches — preferred positives by slot/`>` rank, and listed negatives as desirable curses. Refresh the bundled data after updating the CSV:

```bash
npm run build:riven-prefs
```

## Linux / Proton

1. Install Warframe through Steam and launch it once (creates `compatdata/230410`)
2. Run the AppImage or `.deb` build of Everything Warframe
3. EE.log is auto-detected from the Proton prefix; process detection uses `pgrep` for `Warframe.x64.exe`
4. Overlay + OCR need **X11 / XWayland** above Warframe — the app forces XWayland when a Wayland session is detected (pure Wayland cannot pin always-on-top). Override with `ELECTRON_OZONE_PLATFORM_HINT=wayland` only if you know you need it
5. Toggle overlay (`Alt+Shift+V` by default) plays a system beep and shows a desktop notification plus tray tooltip (`Overlay ON/OFF`) so state is clear even if panels are hard to see
6. On **Wayland**, grant screen share once when prompted — Everything Warframe keeps that capture session open for relic/riven OCR so you are not asked again each scan
7. EE.log is auto-detected from Steam/Proton (`compatdata/230410`); if auto-scan never fires, set the path under Settings after launching Warframe once
8. Inventory sync from the game runs the Windows helper via Proton’s wine inside the Warframe prefix (or import `inventory.json` manually)
9. **Data location:** settings, catalogs, and OCR caches live under `~/.local/share/Everything Warframe` (not inside the AppImage mount, and not under `~/.config`). First launch migrates any older `~/.config/Everything Warframe` folder automatically.

## Foundry planner

1. Sync inventory under **Settings → Inventory**
2. Open the companion **Foundry** tab (companion-only — no overlay panel)
3. Search/filter craftable warframes and weapons
4. Select an item to expand its crafting tree and see missing leaf materials

## Publishing a new release (maintainers)

1. Bump `"version"` in `package.json` (e.g. `0.2.0`)
2. Commit and push to `master`
3. Create and push a tag matching that version:

```bash
git tag v0.2.0
git push origin v0.2.0
```

4. GitHub Actions builds Windows artifacts and publishes a Release
5. Installed apps pick up the update via electron-updater

You can also build/publish locally (needs a GitHub token with `repo` scope):

```bash
npm run release
```

## Scripts

| Script | Purpose |
| --- | --- |
| `npm start` | Dev companion + overlay |
| `npm run build` | Production renderer + electron bundles |
| `npm run build:riven-prefs` | Rebuild riven preference JSON from sheet CSV (rows 20+, A–F) |
| `npm run dist` | Build Windows installer + portable (no publish) |
| `npm run dist:linux` | Build Linux AppImage + deb (no publish) |
| `npm run release:win` | Build and publish Windows artifacts |
| `npm run release:linux` | Build and publish Linux artifacts |

## Data sources

- [warframestat.us](https://docs.warframestat.us) — worldstate / item catalog
- [warframe-api-helper](https://github.com/Sainan/warframe-api-helper) — inventory sync
- Warframe `EE.log` — relic reward / riven cycle detection
- [Megrim & Valkyrial riven preferences](https://docs.google.com/spreadsheets/d/1OQGKpWXeoPaN0Cy7mTvVZMRcwvZXgIC3EO1AIRAkwDg) (based on 44Bananas) — preferred riven stats

Unofficial and not affiliated with Digital Extremes.
