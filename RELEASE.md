# Release checklist (Everything Warframe)

Use this for every version that users should auto-update to.

## Before tag

1. [ ] Bump `package.json` + `package-lock.json` version (`X.Y.Z`)
2. [ ] Add bullets under that version in `src/lib/whatsNew.ts`
3. [ ] `npm run build` succeeds locally
4. [ ] Smoke: companion opens, overlay toggles, relic/riven OCR (if changed), inventory sync or import
5. [ ] Do **not** commit `scripts/list-abbrev.mjs` or hand-edited `release/latest.yml` (builder publishes that)

## Ship (triggers GitHub Actions → Win + Linux installers)

```bash
git add -A   # review; exclude junk
git commit -m "Release X.Y.Z: …"
git tag vX.Y.Z
git push origin master
git push origin vX.Y.Z
```

- Workflow: `.github/workflows/release.yml` on `push` tags `v*`
- Publishes to GitHub Releases (`hoeslovevid/everything-warframe`) for `electron-updater`
- Confirm Actions succeeded and the release has Setup `.exe` + Linux `.AppImage`/`.deb` + `latest.yml`

## After ship

1. [ ] Open the GitHub Release page — assets present, version matches tag
2. [ ] Optional: install from the release on a clean machine and check **Settings → Updates**
3. [ ] Local `release/latest.yml` may stay stale; **source of truth is the Release asset**, not the repo copy

## 1.0 cut (freeze candidate)

Track toward **1.0.0** when all are true:

- [ ] Release CI green for Win + Linux on every tag
- [ ] Inventory: helper version shown; clear import fallback when gruzzle fails
- [ ] Game performance mode + reward-HUD option validated in a long fissure session
- [ ] Linux parity matrix ([docs/LINUX_PARITY.md](./docs/LINUX_PARITY.md)) — EE.log, Proton, ptrace, capture, inventory all green on a Proton install
- [ ] Opt-in crash log → GitHub issue path documented (Help → Crash reports; Settings toggle)
- [ ] OCR edge cases bug-bashed (theme, 3/4 squad, multi-monitor)
- [ ] Optional: Windows code signing (`CSC_*` certs) — not required for 1.0 but recommended later

Until then stay on **0.9.x** with this checklist.
