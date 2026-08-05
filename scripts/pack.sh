#!/usr/bin/env bash
#
# Build a distributable extension zip compatible with `gnome-extensions install`.
# metadata.json must sit at the archive root, so the files are zipped from the
# repo root with no leading directory.
#
# Usage: scripts/pack.sh [output.zip]
#
set -euo pipefail

UUID="dell-monitor-control@eboye.github"
root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
out="${1:-$root/$UUID.shell-extension.zip}"

files=(metadata.json extension.js ddcutil.js monitor.js stylesheet.css README.md)

cd "$root"
for f in "${files[@]}"; do
    [ -f "$f" ] || { echo "missing required file: $f" >&2; exit 1; }
done

rm -f "$out"
zip -q -X "$out" "${files[@]}"
echo "$out"
