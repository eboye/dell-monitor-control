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

files=(metadata.json extension.js prefs.js ddcutil.js monitor.js menu.js stylesheet.css README.md)

cd "$root"
for f in "${files[@]}"; do
    [ -f "$f" ] || { echo "missing required file: $f" >&2; exit 1; }
done

# Ship both the schema source and the compiled binary: `gnome-extensions
# install` copies the zip verbatim without compiling anything.
command -v glib-compile-schemas >/dev/null 2>&1 || {
    echo "glib-compile-schemas is required to pack (ships with glib2)" >&2; exit 1
}
glib-compile-schemas schemas
files+=(schemas/org.gnome.shell.extensions.dell-monitor-control.gschema.xml schemas/gschemas.compiled)

rm -f "$out"
zip -q -X "$out" "${files[@]}"
echo "$out"
