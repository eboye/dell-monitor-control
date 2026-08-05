# Dell Monitor Control

A GNOME Shell (50+) top-bar extension to control a DDC/CI Dell monitor via
[`ddcutil`](https://www.ddcutil.com/): switch input source (DisplayPort / HDMI /
USB-C), adjust brightness and contrast, pick a color preset or display mode, and
power the panel off.

Built for and tested with a **Dell P3421W** on Arch Linux / GNOME 50 / Wayland.

## Requirements

- GNOME Shell 50+
- `ddcutil` on `PATH`, working without `sudo`:
  ```bash
  sudo pacman -S ddcutil
  # log out/in so the i2c udev rule + group membership apply
  ddcutil detect          # should list your monitor
  ```
- DDC/CI enabled in the monitor's OSD (Menu → Others → DDC/CI → On).

## Install

### One-liner (recommended)

```bash
curl -fsSL https://raw.githubusercontent.com/eboye/dell-monitor-control/main/install.sh | bash
```

This checks your dependencies (GNOME version, `ddcutil`, `i2c` group), copies
the extension into `~/.local/share/gnome-shell/extensions/`, and enables it.
Re-run it to update. **On Wayland you must log out and back in** for GNOME to
load the extension, then:

```bash
gnome-extensions enable dell-monitor-control@eboye.github
```

Uninstall with `curl ... | bash -s -- --uninstall` (or `./install.sh --uninstall`
from a clone).

### From a release zip

Download the latest `*.shell-extension.zip` from the
[Releases page](https://github.com/eboye/dell-monitor-control/releases), then:

```bash
gnome-extensions install --force dell-monitor-control@eboye.github.shell-extension.zip
# log out/in (Wayland), then enable as above
```

### From a clone (development)

```bash
git clone https://github.com/eboye/dell-monitor-control ~/GitHub/dell-monitor-control
UUID=dell-monitor-control@eboye.github
ln -sfn ~/GitHub/dell-monitor-control ~/.local/share/gnome-shell/extensions/$UUID
# Log out and back in (Wayland), then:
gnome-extensions enable $UUID
```

Editing a linked clone updates the extension live (after a shell reload) — no
reinstall needed.

## Usage

Click the display icon in the top bar. Sliders apply on release; input/preset/
mode changes apply immediately and mark the active choice with a dot. Power off
requires a confirmation click.

> **USB-C caveat:** switching to an input with no active source can leave the
> screen on "No signal". If DDC stops responding over the old cable, use the
> monitor's physical OSD button to switch back.

## Development

Pure logic (parsers, model, service queue) is unit-tested without the shell:

```bash
gjs -m tests/run.js
```

The UI (`extension.js`) is verified in a live GNOME session.

Build a distributable zip locally with `scripts/pack.sh`. Pushing a `v*` tag
(e.g. `git tag v1 && git push origin v1`) triggers the GitHub Actions workflow
in `.github/workflows/release.yml`, which builds the zip and attaches it to a
new Release automatically.
