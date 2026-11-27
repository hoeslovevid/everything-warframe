# Companion and recognition overhaul

The companion now has a persistent workspace bar, a simpler mission dashboard, and a dedicated Scan workspace. Existing crafting, inventory, market, LFG, layout, and settings features remain accessible. Colors follow the selected app theme; typography uses local system fonts.

## Recognition changes

- Relic preparation locates the label row before OCR, excluding rarity bars and ducat icons. Weak slots can try alternate theme masks without repeating the whole squad scan.
- Reward matching requires weapon/item identity, preserves explicit part names, and rejects ambiguous near ties. Match strength is a heuristic score, not an accuracy probability.
- Riven recovery uses a wider sparse-text crop and adaptive row slices. It selects one reading rather than merging conflicting numeric results from different passes.
- Parsing preserves decimal commas, split decimals, Unicode minus signs, and equal values on different stats. Incomplete readings withhold recommendations, estimates, and history entries.
- Dismissing a scan invalidates its pending results. Market enrichment cannot restore a dismissed popup.
- Companion scan buttons minimize the companion before capture. The Scan workspace offers a three-second countdown; hotkeys remain immediate.

## Resource changes

Heavy pages and the two window entry points load separately. Scan consumers share subscriptions. OCR warmup is deduplicated and can recover after initialization failure. Recognition requests omit unused output formats and cache a bounded number of identical crop readings. Screen-dismiss sampling runs every 800 ms instead of 400 ms; EE.log dismissal is unchanged. OCR uses normal process scheduling while active and returns to background priority afterward.

## Validation

Run `npm test`, `npm run typecheck`, and `npm run build`.

Offline replay uses the application's pixel preparation, real Tesseract workers, and the riven parser. Existing local failed-scan crops were used without adding those images to the repository.

| Saved sample | Replay result |
| --- | --- |
| Vectis current | Critical Damage +113.4%, Toxin +70.5%, Heat +70.6% |
| Vectis reroll | Heat +97.6%, Zoom +69.7%, Critical Damage +125.1%, Slash −95.3% |
| Four primary reward crops | Forma Blueprint; Burston Prime Stock; Gunsen Prime Blade; Burston Prime Receiver |

These are sample checks, not a general accuracy benchmark. Live capture, desktop layout, permission dialogs, game FPS, and Linux behavior require a desktop playtest. Electron could not launch in the execution environment, so visual verification remains outstanding. A clipped neighboring Forma crop still failed; its primary crop read correctly.

## Desktop playtest

1. Run `npm start`, open Scan workspace, and select the display running Warframe.
2. Use Layout & capture if the guides do not align with the game's UI scale.
3. At fissure selection, scan with the configured hotkey and verify each item, value, and slot against the game.
4. At riven comparison, verify every number and sign against both cards before accepting a roll.
5. Dismiss during a scan, then scan again; the dismissed result should stay dismissed.
6. Check the interface at a smaller window size and with another color theme.

To replay another saved crop without capturing the desktop:

```bash
npm run ocr:replay -- riven path/to/card-crop.png
npm run ocr:replay -- relic path/to/name-crop.png
```

OCR currently recognizes English item/stat labels. Its generic riven quality model remains an approximation; these changes improve reading and validation rather than providing a full weapon/disposition stat calculator.
