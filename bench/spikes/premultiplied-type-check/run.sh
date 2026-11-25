#!/usr/bin/env bash
# premultiplied: true on a format without alpha, as a run-time error (A, as shipped) or also a compile error (B).
# Compiles callers.ts (realistic callers) and fixes.ts (the fixes B would need) against dist/index.d.ts as built (A),
# and against a copy with `premultiplied?: false | undefined` on the formats without alpha (B).
#   npm run build:js && bench/spikes/premultiplied-type-check/run.sh > bench/spikes/premultiplied-type-check/results.txt
set -euo pipefail
here=$(cd "$(dirname "$0")" && pwd); root=$(cd "$here/../../.." && pwd); work=$(mktemp -d); trap 'rm -rf "$work"' EXIT
for v in A B; do
  mkdir -p "$work/$v"; cp "$here/callers.ts" "$here/fixes.ts" "$work/$v/"; cp "$root/dist/index.d.ts" "$work/$v/index.d.ts"
  if [ "$v" = B ]; then
    perl -0pi -e 's/(interface RawImageWithoutAlpha.*?premultiplied\?: )boolean \| undefined/$1false | undefined/s' "$work/$v/index.d.ts"
    grep -q 'premultiplied?: false | undefined' "$work/$v/index.d.ts"
  fi
  for f in callers fixes; do
    echo "== $v $f.ts"
    (cd "$root" && npx tsc --noEmit --strict --module nodenext --moduleResolution nodenext --skipLibCheck "$work/$v/$f.ts" 2>&1 || true) \
      | grep 'error TS' | sed -E 's#^.*/##; s/(.{150}).*/\1…/' || echo "no errors"
  done
done
