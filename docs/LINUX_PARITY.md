# Linux / Proton parity matrix

Use this before tagging a release that claims Linux support. Run on a **Steam + Proton** Warframe install (X11 or XWayland preferred).

| Area | Check | Pass? |
| --- | --- | --- |
| **Install** | AppImage or `.deb` launches; data under `~/.local/share/Everything Warframe` | ☐ |
| **EE.log** | Settings → detect EE.log finds `compatdata/230410/.../EE.log` while Warframe runs | ☐ |
| **Overlay** | Overlay toggles above Borderless Warframe; tray tooltip shows ON/OFF | ☐ |
| **Capture** | Relic/riven OCR: grant portal share once; scans return names (not empty) | ☐ |
| **Ptrace** | Linux health → Memory access: permissive or documented fix works | ☐ |
| **Inventory** | Sync from game via Proton wine **or** import `inventory.json` / AlecaFrame | ☐ |
| **Worldstate** | Cycles / fissures / Baro refresh without errors | ☐ |
| **Updates** | `latest-linux.yml` on GitHub Release matches tagged version | ☐ |

## Quick commands

```bash
# ptrace (if helper cannot read session memory)
sudo sysctl -w kernel.yama.ptrace_scope=0

# Force XWayland for Electron if overlay cannot stay on top
# (app usually sets this; override only if needed)
ELECTRON_OZONE_PLATFORM_HINT=x11 ./Everything-Warframe-*.AppImage
```

## Companion UI

**Settings → Linux health** (when `process.platform === 'linux'`) surfaces Steam, Proton prefix, wine launcher, and ptrace status. Use **Linux capture wizard** once for Wayland portal persistence.

## Release gate

`RELEASE.md` 1.0 checklist: this matrix must be green on at least one Proton install before calling Linux “supported” for that cut.
