#!/usr/bin/env bash
#
# Dell Monitor Control — installer.
#
# Usage:
#   Remote (one-liner):
#     curl -fsSL https://raw.githubusercontent.com/eboye/dell-monitor-control/main/install.sh | bash
#   Local (from a clone):
#     ./install.sh
#
# Re-running updates an existing install. Uninstall with:
#   ./install.sh --uninstall
#
set -euo pipefail

UUID="dell-monitor-control@eboye.github"
REPO="https://github.com/eboye/dell-monitor-control.git"
DEST="${XDG_DATA_HOME:-$HOME/.local/share}/gnome-shell/extensions/$UUID"
RUNTIME_FILES=(metadata.json extension.js ddcutil.js monitor.js stylesheet.css README.md)

c_reset='\033[0m'; c_red='\033[31m'; c_yellow='\033[33m'; c_green='\033[32m'; c_dim='\033[2m'
info() { printf '%b==>%b %s\n' "$c_green" "$c_reset" "$*"; }
warn() { printf '%b warn:%b %s\n' "$c_yellow" "$c_reset" "$*" >&2; }
err()  { printf '%berror:%b %s\n' "$c_red" "$c_reset" "$*" >&2; }
note() { printf '%b      %s%b\n' "$c_dim" "$*" "$c_reset"; }

uninstall() {
    if [ -L "$DEST" ]; then
        warn "$DEST is a dev symlink; removing the link only (your clone is untouched)."
        rm -f "$DEST"
    elif [ -e "$DEST" ]; then
        rm -rf "$DEST"
    else
        info "Nothing installed at $DEST"
        return 0
    fi
    gnome-extensions disable "$UUID" 2>/dev/null || true
    info "Uninstalled. Log out and back in (Wayland) to fully unload."
}

if [ "${1:-}" = "--uninstall" ]; then
    uninstall
    exit 0
fi

# --- Dependency checks (warn, don't hard-fail — the extension can install and
# --- the user can fix runtime deps before reloading the shell). --------------

if command -v gnome-shell >/dev/null 2>&1; then
    gnome_ver="$(gnome-shell --version 2>/dev/null | grep -oE '[0-9]+' | head -1)"
    if [ -n "$gnome_ver" ] && [ "$gnome_ver" -lt 45 ]; then
        warn "GNOME Shell $gnome_ver detected; this extension targets 45+ (built for 50)."
    fi
else
    warn "gnome-shell not found on PATH — is this a GNOME session?"
fi

if command -v ddcutil >/dev/null 2>&1; then
    if ! id -nG 2>/dev/null | tr ' ' '\n' | grep -qx i2c; then
        warn "You are not in the 'i2c' group; ddcutil will need sudo until you are."
        note "Fix: install ddcutil's udev rule (comes with the package) and log out/in."
    fi
else
    warn "ddcutil not found on PATH. Install it, e.g.:"
    note "Arch: sudo pacman -S ddcutil   |   Debian/Ubuntu: sudo apt install ddcutil"
    note "Then log out/in so the i2c group + udev rule apply."
fi

# --- Locate the source: local clone next to this script, else clone remote. --

cleanup_tmp=""
trap '[ -n "$cleanup_tmp" ] && rm -rf "$cleanup_tmp"' EXIT

self_dir=""
if [ -n "${BASH_SOURCE[0]:-}" ] && [ -f "${BASH_SOURCE[0]}" ]; then
    self_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
fi

if [ -n "$self_dir" ] && [ -f "$self_dir/metadata.json" ]; then
    src="$self_dir"
    info "Installing from local clone: $src"
else
    command -v git >/dev/null 2>&1 || { err "git is required to install remotely."; exit 1; }
    cleanup_tmp="$(mktemp -d)"
    info "Cloning $REPO ..."
    git clone --depth 1 "$REPO" "$cleanup_tmp/repo" >/dev/null 2>&1
    src="$cleanup_tmp/repo"
fi

# --- Install: copy runtime files into the extensions directory. --------------

if [ -L "$DEST" ]; then
    info "Dev symlink already present at $DEST — leaving it as-is."
    note "You're running from a linked working copy; edits are already live."
else
    mkdir -p "$DEST"
    for f in "${RUNTIME_FILES[@]}"; do
        [ -f "$src/$f" ] && cp -f "$src/$f" "$DEST/$f"
    done
    info "Installed to $DEST"
fi

# --- Enable + report. --------------------------------------------------------

if gnome-extensions enable "$UUID" 2>/dev/null; then
    info "Enabled."
else
    warn "Could not enable yet (the running shell hasn't rescanned)."
fi

echo
info "Done. On Wayland you must log out and back in to load the extension."
note "After re-login: gnome-extensions enable $UUID"
note "Check for load errors: journalctl --user -b -o cat /usr/bin/gnome-shell | grep -i dell-monitor"
