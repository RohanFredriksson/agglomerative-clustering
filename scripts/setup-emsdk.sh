#!/usr/bin/env bash
# Installs the Emscripten version CI builds with, so `npm run build` and `npm test` work from a fresh clone.
#   scripts/setup-emsdk.sh [dir]      (dir: default $EMSDK_DIR, else ~/.local/share/emsdk)
# then, in each shell that builds:   source <dir>/emsdk_env.sh
# The version is read from the workflows (`version:` under mymindstorm/setup-emsdk), so it can't drift from CI; they
# must all pin the same one. Safe to run again: when that version is already active in <dir>, it changes nothing.
set -euo pipefail

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
versions="$(grep -h -A3 'mymindstorm/setup-emsdk' "$root"/.github/workflows/*.yml | sed -n 's/^ *version: *\([0-9][0-9.]*\).*/\1/p' | sort -u)"
if [ -z "$versions" ] || [ "$(printf '%s\n' "$versions" | wc -l)" -ne 1 ]; then
    echo "setup-emsdk: the workflows should pin one Emscripten version, found: ${versions:-none}" >&2
    exit 1
fi
version="$versions"
dir="${1:-${EMSDK_DIR:-$HOME/.local/share/emsdk}}"

if [ ! -x "$dir/emsdk" ]; then
    echo "Cloning emsdk into $dir"
    git clone --depth 1 https://github.com/emscripten-core/emsdk.git "$dir"
fi

if "$dir/upstream/emscripten/em++" --version 2>/dev/null | head -1 | grep -q " $version "; then
    echo "Emscripten $version is already active in $dir."
else
    # An older emsdk checkout doesn't know newer versions, so update it first (offline, carry on with what it has).
    git -C "$dir" pull --ff-only --quiet || echo "setup-emsdk: couldn't update $dir; trying with the checkout as it is" >&2
    (cd "$dir" && ./emsdk install "$version" && ./emsdk activate "$version")
fi

echo
echo "To build in this shell:  source \"$dir/emsdk_env.sh\""
