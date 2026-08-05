# Dell Monitor Control

A GNOME Shell (50+) top-bar extension to control a DDC/CI Dell monitor via
[`ddcutil`](https://www.ddcutil.com/): switch input source (DisplayPort / HDMI /
USB-C), adjust brightness and contrast, pick a color preset or display mode, and
power the panel off.

Built for and tested with a **Dell P3421W** on Arch Linux / GNOME 50 / Wayland.

## Requirements

- **GNOME Shell 45+** (built and tested on 50).
- **`ddcutil`** installed and usable without `sudo` (see below).
- **DDC/CI enabled** in the monitor's on-screen menu (e.g. Menu → Others →
  DDC/CI → On).

### 1. Install ddcutil

| Distro | Command |
| --- | --- |
| Arch / Manjaro / EndeavourOS | `sudo pacman -S ddcutil` |
| Debian / Ubuntu / Pop!_OS / Mint | `sudo apt install ddcutil` |
| Fedora / RHEL / CentOS Stream | `sudo dnf install ddcutil` |
| openSUSE (Leap / Tumbleweed) | `sudo zypper install ddcutil` |
| Gentoo | `sudo emerge app-misc/ddcutil` |

### 2. Grant i2c access (so it works without sudo)

ddcutil talks to the monitor over the i2c bus, which needs the `i2c-dev` kernel
module loaded and your user in the `i2c` group:

```bash
# Load i2c-dev now, and automatically on every boot
sudo modprobe i2c-dev
echo i2c-dev | sudo tee /etc/modules-load.d/i2c-dev.conf

# Add yourself to the i2c group. The ddcutil package ships the udev rule that
# assigns /dev/i2c-* to this group; some distros create the group on install.
sudo usermod -aG i2c "$USER"
```

Then **log out and back in** (or reboot) so the group membership and udev rule
take effect, and verify:

```bash
ddcutil detect          # should list your monitor
```

If `ddcutil detect` sees your monitor but reports *"DDC communication failed"*,
enable **DDC/CI** in the monitor's on-screen menu and try again.

> **Note:** on Debian/Ubuntu the `i2c` group and udev rule come from the
> `ddcutil` (or `i2c-tools`) package. If `/dev/i2c-*` still shows as
> `root:root` after re-login, reinstall `ddcutil` so its udev rule is applied,
> or check `ls -l /dev/i2c-*`.

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
