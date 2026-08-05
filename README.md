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

```bash
git clone https://github.com/eboye/dell-monitor-control ~/GitHub/dell-monitor-control
UUID=dell-monitor-control@eboye.github
ln -sfn ~/GitHub/dell-monitor-control ~/.local/share/gnome-shell/extensions/$UUID
# Log out and back in (Wayland), then:
gnome-extensions enable $UUID
```

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
