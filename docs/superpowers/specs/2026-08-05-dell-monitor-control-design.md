# Dell Monitor Control — GNOME Shell Extension

**Date:** 2026-08-05
**Status:** Approved design

## Purpose

A GNOME Shell panel (status bar) extension that controls a DDC/CI-capable Dell
monitor — primarily switching input source (DisplayPort / HDMI / USB-C laptop),
plus brightness, contrast, color preset, display mode, and power off. Wraps the
`ddcutil` CLI, which already works without `sudo` on this machine via the `i2c`
group.

## Environment (verified)

- GNOME Shell 50.3, Wayland session → modern GJS/ESM extension format,
  `metadata.json` `shell-version: ["50"]`.
- `ddcutil` 2.2.7 at `/usr/bin/ddcutil`, ~230 ms per call, no `sudo` required.
- One DDC-capable monitor: **Dell P3421W** on `DP-1`, i2c bus 6 (may vary).
- VCP features confirmed present on this unit (MCCS 2.1):
  - `0x10` Brightness (0–100)
  - `0x12` Contrast (0–100)
  - `0x14` Color preset — `05`=6500K, `08`=9300K, `0b`=User 1, `0c`=User 2
  - `0x60` Input source — `0x0F`=DisplayPort-1, `0x11`=HDMI-1, `0x1B`=USB-C
  - `0xDC` Display mode — `00`=Standard, `03`=Movie, `05`=Games
  - `0xD6` Power mode — `01`=On, `04`=Off, `05`=hard panel off
  - No `0x62` (volume) — the P3421W has line-out only, so no volume control.

## Hard constraint

GNOME's UI runs on a single JS thread. Every `ddcutil` invocation MUST be an
async `Gio.Subprocess`; blocking (synchronous spawn) would freeze the whole
shell for the duration of the call.

## Architecture — three isolated units

### 1. `ddcutil.js` — hardware service

The only unit that touches hardware. Public API returns Promises:

- `detect()` → discovers the first DDC display, returns `{ bus, model, ... }` or
  throws a typed error (`NO_DDCUTIL`, `NO_MONITOR`, `COMM_FAILED`).
- `getAll()` → reads brightness, contrast, input, preset, mode in one batch.
- `getVcp(code)` → single feature read.
- `setVcp(code, value)` → single feature write.

Implementation details:

- **Async spawn:** `Gio.Subprocess` with `communicate_utf8_async`.
- **Serial queue:** internal promise chain so only ONE `ddcutil` process runs at
  a time. Concurrent calls collide on the shared i2c bus. Callers await their
  turn.
- **Bus pinning:** `detect()` runs `ddcutil detect --terse` once; the resulting
  bus number is passed as `--bus N` on every later call, skipping the ~230 ms
  re-probe. If a later call returns `COMM_FAILED`, invalidate the pin and force a
  re-detect on next use.
- **Output parsing:** `--terse` machine format. `getvcp --terse 10` →
  `VCP 10 C <current> <max>`; input/preset/mode parse the `SL` value.
- **Fast writes:** `setvcp --noverify` skips the post-write read-back.

### 2. `monitor.js` — state model

Plain object holding last-known VCP state and the pinned bus:

```
{ bus, model, brightness, contrast, input, preset, mode, available, error }
```

The UI renders this instantly; the service refreshes it in the background. No
hardware access here.

### 3. `extension.js` — panel indicator + menu

A `PanelMenu.Button` with a `video-display-symbolic` icon in the status area
(right side). PopupMenu contents, top to bottom:

- **Input source** — three items DP-1 / HDMI-1 / USB-C, active one dot-marked
  (`setSensitive`/ornament). Selecting sends `setVcp(0x60, code)`.
- **Brightness** — `PopupSliderMenuItem` 0–100. Applies on drag-END only
  (debounced), one `setVcp(0x10, v)` per gesture with `--noverify`.
- **Contrast** — same pattern, `0x12`.
- **Color preset** — submenu: 6500K / 9300K / User 1 / User 2 → `setVcp(0x14)`.
- **Display mode** — submenu: Standard / Movie / Games → `setVcp(0xDC)`.
- **Power off** — two-step: first click swaps the label to "Confirm power off";
  second click within a few seconds sends `setVcp(0xD6, 0x04)`; otherwise reverts.
- **Refresh** — triggers `getAll()` and repaints.

## Data flow

1. Enable → `detect()`. On success, store bus in model; on failure, model
   `available=false` + `error`.
2. Menu open → render model instantly (last-known), then fire background
   `getAll()`; when it resolves, update sliders and active marks.
3. User action → optimistic UI update + `setVcp(...)`; on error, revert and show
   the error item.

## Error handling (no silent failures)

When `available=false`, the menu shows a single disabled explanatory line plus a
**Retry** item:

- `NO_DDCUTIL` — "ddcutil not found — install it."
- `NO_MONITOR` — "No DDC/CI monitor detected."
- `COMM_FAILED` — "Monitor not responding (check DDC/CI in OSD)."

Every rejected Promise is caught at the UI boundary; nothing is swallowed.

## Scope boundaries (YAGNI)

- **Single monitor** — targets the first detected DDC display. Code is
  structured so a monitor list could be added, but multi-monitor UI is out of
  scope now (only one DDC monitor exists here).
- **No preferences window** — nothing needs configuring yet.
- **No keyboard shortcuts** — can be added later.
- **Sliders apply on release**, not live-drag, to avoid flooding the i2c bus.

## Project layout

Developed in `~/GitHub/dell-monitor-control/`, then symlinked into
`~/.local/share/gnome-shell/extensions/<uuid>` so the git repo and the live
extension stay in sync.

```
dell-monitor-control/
  metadata.json      # uuid: dell-monitor-control@eboye.github, shell-version ["50"]
  extension.js       # Indicator + menu wiring
  ddcutil.js         # async service + serial queue + bus pinning
  monitor.js         # state model
  stylesheet.css     # minor slider/label styling
  README.md          # install / symlink / usage
  docs/superpowers/specs/2026-08-05-dell-monitor-control-design.md
```

## Testing / verification

- Manual: enable extension, verify icon appears, each control changes the
  monitor and reads back correctly (`ddcutil getvcp <code>` as ground truth).
- Input round-trip: DP → USB-C → DP without losing DDC.
- Failure path: rename `ddcutil` on PATH temporarily → menu shows the error +
  Retry.
- Shell responsiveness: confirm the UI never freezes during calls (async proof).
